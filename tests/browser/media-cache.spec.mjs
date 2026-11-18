/* global createImageBitmap */
import { test, expect } from '@playwright/test';
import { PNG } from 'pngjs';
import { mediaFixture } from '../e2e/media-fixture.mjs';
import { requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';

// Non-loopback traffic is sent to a closed local proxy without disabling HTTP caching.
const localOnlyProxy = { server: 'http://127.0.0.1:9', bypass: '127.0.0.1,localhost,[::1]' };
test.use({ proxy: localOnlyProxy });

function imageBytes(seed) {
  const png = new PNG({ width: 1024, height: 576 }); let random = seed;
  for (let i = 0; i < png.data.length; i += 4) {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    png.data[i] = random & 255; png.data[i + 1] = random >>> 8 & 255; png.data[i + 2] = random >>> 16 & 255; png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
}

test('real immutable image HTTP cache and three prompt projector lookahead @media-cache', async ({ page, context, browser, baseURL }) => {
  // Do not use Playwright routing: interception disables the browser HTTP cache.
  const env = requireFullEmulatorEnvironment(process.env, 'Media cache benchmark');
  const f = await mediaFixture(); let projectorContext;
  try {
    const bytes = [1, 2, 3, 4, 5].map(imageBytes);
    const images = [];
    for (const image of bytes) images.push(await f.upload('image', image, 'image/png'));
    await f.update('image', { questionImage: images[0].reference, answerImage: images[4].reference });
    await f.update('audio', { backgroundImage: images[1].reference });
    await f.update('recap', { backgroundImage: images[2].reference });
    await f.update('end', { backgroundImage: images[3].reference });
    await f.lock(); const sessionId = await f.live();
    expect((await f.db.doc('publicSessions/' + sessionId).get()).get('upcomingImages')).toBeUndefined();
    await f.navigate(sessionId, 3);
    const publication = (await f.db.doc('publicSessions/' + sessionId).get()).data();
    expect(publication.upcomingImages).toEqual(images.slice(1, 4).map(image => image.reference));
    expect(JSON.stringify(publication)).not.toContain(images[4].reference);
    expect((await f.read(images[4].reference, { sessionId })).status).toBe(404);
    await page.goto('/admin/login');
    const cdp = await context.newCDPSession(page); await cdp.send('Network.enable');
    let gatewayRequests = 0, cacheHits = 0;
    const gatewayIds = new Set(), servedIds = new Set();
    const noteCacheHit = id => { if (gatewayIds.has(id) && !servedIds.has(id)) { servedIds.add(id); cacheHits++; } };
    cdp.on('Network.requestWillBeSent', event => {
      if (event.request.url.includes('/readQuizMedia?')) { gatewayRequests++; gatewayIds.add(event.requestId); }
    });
    cdp.on('Network.requestServedFromCache', event => noteCacheHit(event.requestId));
    cdp.on('Network.responseReceived', event => { if (event.response.fromDiskCache || event.response.fromPrefetchCache) noteCacheHit(event.requestId); });
    const endpoint = 'http://' + env.functionsEndpoint.host + ':' + env.functionsEndpoint.port + '/' + env.projectId + '/europe-west1/readQuizMedia';
    const before = [], after = [];
    for (const mode of ['before', 'after']) {
      for (let repeat = 0; repeat < 10; repeat++) {
        const requestsAt = gatewayRequests, hitsAt = cacheHits;
        const sample = await page.evaluate(async ({ endpoint, reference, upcoming, sessionId, mode }) => {
          const namespace = crypto.randomUUID().replaceAll('-', '');
          const source = reference => { const url = new URL(endpoint); url.searchParams.set('reference', reference); url.searchParams.set('sessionId', sessionId);
            if (mode === 'after') url.searchParams.set('cacheScope', namespace); return url.href; };
          const read = async url => { const started = performance.now(); const response = await fetch(url, { cache: mode === 'before' ? 'no-store' : 'default' });
            if (!response.ok) throw new Error('Synthetic gateway failed: ' + response.status);
            const blob = await response.blob(), bitmap = await createImageBitmap(blob); bitmap.close();
            return { ms: performance.now() - started, url: response.url, policy: response.headers.get('cache-control') }; };
          const first = await read(source(reference));
          const prefetched = mode === 'after' ? await read(source(upcoming)) : undefined;
          const cached = await read(mode === 'after' ? first.url : source(reference));
          const transition = await read(prefetched?.url ?? source(upcoming));
          return { first: first.ms, cached: cached.ms, transition: transition.ms, policy: cached.policy };
        }, { endpoint, reference: images[0].reference, upcoming: images[1].reference, sessionId, mode });
        (mode === 'before' ? before : after).push({ ...sample, requests: gatewayRequests - requestsAt, cacheHits: cacheHits - hitsAt });
      }
    }
    const stats = samples => Object.fromEntries(['first', 'cached', 'transition'].map(key => {
      const values = samples.map(sample => sample[key]).sort((a, b) => a - b);
      return [key, { median: (values[4] + values[5]) / 2, p95: values[9] }];
    }));
    const report = { format: 'PNG', width: 1024, height: 576, bytes: bytes[0].length, repeats: 10,
      before: stats(before), after: stats(after), beforeRequests: before.reduce((n, sample) => n + sample.requests, 0),
      afterRequests: after.reduce((n, sample) => n + sample.requests, 0), afterNetworkRequests: after.reduce((n, sample) => n + sample.requests - sample.cacheHits, 0), cacheHits: after.reduce((n, sample) => n + sample.cacheHits, 0) };
    console.log('MEDIA_CACHE_BENCHMARK ' + JSON.stringify(report));
    expect(after.every(sample => sample.policy === 'private,max-age=31536000,immutable')).toBe(true);
    expect(report.cacheHits).toBeGreaterThanOrEqual(20);
    expect(report.after.cached.p95).toBeLessThan(300);
    expect(report.after.transition.p95).toBeLessThan(300);
    projectorContext = await browser.newContext({ baseURL, proxy: localOnlyProxy });
    const projector = await projectorContext.newPage();
    const observed = new Set();
    projector.on('response', response => {
      const url = new URL(response.url()); if (url.pathname.endsWith('/readQuizMedia') && response.status() === 200) observed.add(url.searchParams.get('reference'));
    });
    await projector.goto('/projector/' + sessionId);
    await expect.poll(() => images.slice(0, 4).every(image => observed.has(image.reference))).toBe(true);
    expect(observed.has(images[4].reference)).toBe(false);
    const started = performance.now(); await f.navigate(sessionId, 4);
    await expect.poll(() => projector.locator('.slide-background img').evaluateAll(images => images.some(image => image.naturalWidth === 1024))).toBe(true);
    console.log('MEDIA_PROJECTOR_TRANSITION_MS ' + (performance.now() - started).toFixed(1));
    const active = (await f.db.doc('sessions/' + sessionId).get()).data();
    await f.admin.call('endLiveSession', { sessionId, expectedRevision: active.revision });
    expect((await f.db.doc('publicSessions/' + sessionId).get()).get('upcomingImages')).toBeUndefined();
    expect((await f.read(images[1].reference, { sessionId })).status).toBe(404);
    // Exercise the real AuthProvider epoch change, rather than claiming downloaded bytes can be recalled.
    await page.getByLabel('E-mail').fill(f.loginEmail); await page.getByLabel('Heslo').fill(f.loginPassword);
    await page.getByRole('button', { name: 'Přihlásit se' }).click(); await expect(page).toHaveURL(/\/admin$/u);
    const accessEpoch = await page.evaluate(async reference => {
      const { readQuizMediaBlob } = await import('/src/features/media/mediaApi.ts');
      const { quizMediaBlobCache } = await import('/src/features/media/mediaBlobCache.ts');
      await readQuizMediaBlob(reference, new AbortController().signal);
      return quizMediaBlobCache.epoch;
    }, images[0].reference);
    const uid = f.admin.auth.currentUser.uid, memberRef = f.db.doc('memberships/' + uid), member = (await memberRef.get()).data();
    await memberRef.update({ status: 'suspended', version: member.version + 1 });
    await expect.poll(() => page.evaluate(async () => (await import('/src/features/media/mediaBlobCache.ts')).quizMediaBlobCache.epoch)).toBeGreaterThan(accessEpoch);
    expect(await page.evaluate(async reference => {
      const media = await import('/src/features/media/mediaApi.ts');
      try { await media.readQuizMediaBlob(reference, new AbortController().signal); return 'unexpected-success'; }
      catch (error) { return media.quizMediaReadFailure(error); }
    }, images[0].reference)).toBe('not-found');
  } finally { await projectorContext?.close(); await f.dispose(); }
});
