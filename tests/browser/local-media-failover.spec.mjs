/* global document, window, MutationObserver */
import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout as wait } from 'node:timers/promises';
import { expect, test } from '@playwright/test';
import { mediaFixture, syntheticImage } from '../e2e/media-fixture.mjs';
import { localEmulatorEndpoint, requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';
import { allowListenAbort, isFirestoreListen } from './live-latency-resilience-fixture';

const projectId = 'demo-filmovy-kviz-v2';
const hosting = 'http://127.0.0.1:5000';
const functions = 'http://127.0.0.1:5001';
const prefix = `/${projectId}/europe-west1/`;
const gatewayPath = `${prefix}readQuizMedia`;
const authorityPath = `${prefix}readLocalProjectorMediaAuthority`;
const allowedOrigins = new Set([hosting, functions, 'http://127.0.0.1:8080', 'http://127.0.0.1:9099']);
const privateAnswer = 'Soukromá syntetická odpověď pro failover';
const injectedDelayMs = 3500;
const fallbackDeadlineMs = 1500;
const repeats = 10;

function requireEmulators(baseURL) {
  const env = requireFullEmulatorEnvironment(process.env, 'Local media failover');
  const storage = localEmulatorEndpoint(process.env.FIREBASE_STORAGE_EMULATOR_HOST, 'Local media failover Storage');
  if (baseURL !== hosting || env.projectId !== projectId || env.authEndpoint.port !== 9099 ||
    env.firestoreEndpoint.port !== 8080 || env.functionsEndpoint.port !== 5001 || storage.port !== 9199) {
    throw new Error('Local media failover requires its dedicated demo project and loopback emulator ports.');
  }
}

function gatewayFor(reference, sessionId) {
  return url => url.origin === functions && url.pathname === gatewayPath &&
    url.searchParams.get('reference') === reference && url.searchParams.get('sessionId') === sessionId;
}

const isAuthority = url => url.origin === functions && url.pathname === authorityPath;
const image = page => page.getByAltText('Obrázek k otázce', { exact: true });
const localImage = page => page.locator('img[data-local-media-source="local"]');
const backupControl = page => page.locator('[data-local-backup-control]');

async function localOnly(context) {
  await context.route('**/*', route => allowedOrigins.has(new URL(route.request().url()).origin)
    ? route.continue() : route.abort('blockedbyclient'));
  await context.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined });
  });
}

async function login(page, fixture) {
  await page.goto('/admin/login');
  await page.getByLabel('E-mail').fill(fixture.loginEmail);
  await page.getByLabel('Heslo').fill(fixture.loginPassword);
  await page.getByRole('button', { name: 'Přihlásit se', exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/u);
}

async function createCase(context, page, baseURL, testInfo, withBackup = true) {
  requireEmulators(baseURL);
  await localOnly(context);
  const fixture = await mediaFixture();
  try {
    const bytes = syntheticImage();
    const prompt = await fixture.upload('image', bytes, 'image/png');
    await fixture.update('image', { questionImage: prompt.reference, correctAnswer: privateAnswer });
    const snapshotId = await fixture.lock();
    await login(page, fixture);
    let backupPath;
    if (withBackup) {
      await page.goto(`/admin/events/${fixture.eventId}?backupPilot=1`);
      const status = page.locator('[data-local-event-media-status]');
      await page.getByRole('button', { name: 'Připravit místní zálohu', exact: true }).click();
      await expect(status).toHaveAttribute('data-local-event-media-status', 'prepared');
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: 'Uložit zkušební balíček', exact: true }).click(),
      ]);
      backupPath = testInfo.outputPath('verified-demo.justkvizbackup');
      await download.saveAs(backupPath);
      expect(await download.failure()).toBeNull();
      const stored = await readFile(backupPath);
      expect(stored.subarray(-bytes.length)).toEqual(bytes);
      expect(stored.includes(Buffer.from(privateAnswer))).toBe(false);
    }
    const sessionId = await fixture.live();
    await page.goto(`/admin/live/${sessionId}?backupPilot=1`);
    if (backupPath) {
      await page.getByLabel('Načíst místní zálohu', { exact: true }).setInputFiles(backupPath);
      await expect(backupControl(page)).toContainText('Místní záloha ověřena');
    }
    const [projector] = await Promise.all([
      page.waitForEvent('popup'),
      page.getByRole('button', { name: 'Otevřít projektor', exact: true }).click(),
    ]);
    await expect(projector.getByText('Čekáme na první slide', { exact: true })).toBeVisible();
    return { fixture, prompt, bytes, snapshotId, sessionId, projector, backupPath };
  } catch (error) {
    await fixture.dispose();
    throw error;
  }
}

async function decoded(page, source) {
  await expect(image(page)).toHaveJSProperty('naturalWidth', 8);
  await expect(image(page)).toHaveJSProperty('naturalHeight', 4);
  await expect(image(page)).toHaveAttribute('data-local-media-source', source);
  await expect(page.getByText(privateAnswer, { exact: true })).toHaveCount(0);
}

async function watchPrivateProjection(page) {
  await page.evaluate(secret => {
    const check = () => {
      if (document.querySelector('.projector-viewport')?.textContent?.includes(secret) || document.querySelector('.slide-answer')) {
        document.documentElement.dataset.privateFailoverLeak = 'true';
      }
    };
    new MutationObserver(check).observe(document, { childList: true, subtree: true, characterData: true });
    check();
  }, privateAnswer);
}

function summary(samples) {
  return Object.fromEntries([...new Set(samples.map(sample => sample.profile))].map(profile => {
    const attempts = samples.filter(sample => sample.profile === profile);
    const values = attempts.filter(sample => sample.status === 'decoded').map(sample => sample.decodeMs).sort((a, b) => a - b);
    const n = values.length;
    return [profile, {
      attempts: attempts.length, failures: attempts.filter(sample => sample.status === 'failed').length,
      decoded: n, medianMs: n ? (values[Math.floor((n - 1) / 2)] + values[Math.floor(n / 2)]) / 2 : null,
      p95Ms: values[Math.ceil(n * 0.95) - 1] ?? null, maxMs: values.at(-1) ?? null,
    }];
  }));
}

function recordTimings(moderator, projector) {
  const events = [];
  const cleanups = [];
  for (const [device, page] of [['moderator', moderator], ['projector', projector]]) {
    const describe = request => {
      const url = new URL(request.url());
      if (url.origin !== functions || !['GET', 'POST'].includes(request.method())) return undefined;
      return new Map([[gatewayPath, 'media-gateway'], [authorityPath, 'public-authority'],
        [`${prefix}readLocalEventMediaAuthorization`, 'operator-authorization']]).get(url.pathname);
    };
    const record = (event, request, status) => {
      const operation = describe(request);
      if (operation) events.push({ device, operation, event, atMs: performance.now(), ...(status === undefined ? {} : { status }) });
    };
    const request = value => record('request', value);
    const response = value => record('response', value.request(), value.status());
    const failed = value => record('failed', value);
    page.on('request', request); page.on('response', response); page.on('requestfailed', failed);
    cleanups.push(() => { page.off('request', request); page.off('response', response); page.off('requestfailed', failed); });
  }
  return { events, stop: () => cleanups.forEach(cleanup => cleanup()) };
}

test('measures healthy and delayed real PNG delivery with and without a verified disk backup', async ({ context, page, baseURL, browser }, testInfo) => {
  test.setTimeout(360_000);
  const samples = [];
  let active;
  try {
    for (const withBackup of [false, true]) {
      active = await createCase(context, page, baseURL, testInfo, withBackup);
      const { fixture, prompt, sessionId, projector } = active;
      const timings = recordTimings(page, projector);
      active.stopTimings = timings.stop;
      await watchPrivateProjection(projector);
      let delayMs = 0;
      let gatewayRequests = 0;
      await projector.route(gatewayFor(prompt.reference, sessionId), async route => {
        if (route.request().method() !== 'GET') return route.fallback();
        gatewayRequests++;
        if (delayMs) await wait(delayMs);
        return route.continue();
      });
      for (const delayed of [false, true]) {
        delayMs = delayed ? injectedDelayMs : 0;
        for (let pass = 0; pass < repeats; pass++) {
          await fixture.navigate(sessionId, 2);
          await expect(image(projector)).toHaveCount(0);
          const sample = { profile: `${delayed ? 'delayed' : 'healthy'}-${withBackup ? 'backup' : 'no-backup'}`, pass, status: 'pending', source: null, decodeMs: null };
          samples.push(sample);
          const started = performance.now();
          const firstEvent = timings.events.length;
          try {
            await fixture.navigate(sessionId, 3);
            const expected = delayed && withBackup ? 'local' : 'online';
            await decoded(projector, expected);
            sample.decodeMs = Math.round(performance.now() - started);
            sample.source = expected;
            sample.status = 'decoded';
            if (expected === 'local') {
              await expect(backupControl(page)).toContainText('Použita místní záloha');
              const localSrc = await image(projector).getAttribute('src');
              // The late successful network response must never replace this displayed local source.
              await wait(injectedDelayMs + 250 - sample.decodeMs);
              await expect(image(projector)).toHaveAttribute('src', localSrc);
              await decoded(projector, 'local');
            }
          } catch (error) {
            sample.status = 'failed';
            sample.source = await image(projector).getAttribute('data-local-media-source').catch(() => null);
            throw error;
          } finally {
            sample.timeline = timings.events.slice(firstEvent).map(({ atMs, ...event }) => ({ ...event, elapsedMs: Math.round(atMs - started) }));
          }
        }
      }
      expect(gatewayRequests).toBe(2 * repeats);
      await expect(projector.locator('html')).not.toHaveAttribute('data-private-failover-leak', 'true');
      await projector.close();
      timings.stop();
      await page.goto('/admin');
      await page.getByRole('button', { name: 'Odhlásit se', exact: true }).first().click();
      await expect(page).toHaveURL(/\/admin\/login/u);
      await fixture.dispose();
      active = undefined;
    }
  } finally {
    const report = {
      browser: browser.version(), firebaseProject: projectId, fallbackDeadlineMs, injectedDelayMs, repeats,
      measurement: 'Node monotonic clock immediately before real goToSlide callable through decoded 8×4 PNG in a browser popup. Routing disables HTTP cache. No physical projector measurement.',
      distribution: summary(samples), samples,
    };
    const path = testInfo.outputPath('local-media-failover-benchmark.json');
    await writeFile(path, JSON.stringify(report, null, 2));
    await testInfo.attach('local-media-failover-benchmark', { path, contentType: 'application/json' });
    console.log(`Local media failover benchmark: ${JSON.stringify(report.distribution)}`);
    active?.stopTimings?.();
    await active?.fixture.dispose();
  }
});

test('uses fresh direct projector authority after a permitted gateway transport failure', async ({ context, page, baseURL }, testInfo) => {
  const active = await createCase(context, page, baseURL, testInfo);
  const { fixture, prompt, sessionId, projector } = active;
  try {
    await watchPrivateProjection(projector);
    let authorityRequests = 0;
    let operatorAuthorizations = 0;
    page.on('request', request => {
      const url = new URL(request.url());
      if (request.method() === 'POST' && url.origin === functions && url.pathname === `${prefix}readLocalEventMediaAuthorization`) operatorAuthorizations++;
    });
    projector.on('request', request => { if (request.method() === 'POST' && isAuthority(new URL(request.url()))) authorityRequests++; });
    await projector.route(gatewayFor(prompt.reference, sessionId), route => route.request().method() === 'GET' ? route.abort('connectionfailed') : route.fallback());
    await fixture.navigate(sessionId, 3);
    await decoded(projector, 'local');
    expect(authorityRequests).toBeGreaterThan(0);
    await expect(backupControl(page)).toContainText('Použita místní záloha');
    const firstSrc = await image(projector).getAttribute('src');
    const preview = page.locator('.live-preview-stage').getByAltText('Obrázek k otázce', { exact: true });
    await expect(preview).toHaveJSProperty('naturalWidth', 8);
    const beforeRerender = (await fixture.db.doc(`publicSessions/${sessionId}`).get()).data();
    // An actual preview diagnostic updates LiveControl state without changing the public authority tuple.
    await preview.dispatchEvent('error');
    await expect(page.locator('.live-media-alert[data-media-issue="decode-failed"]')).toBeVisible();
    await expect(backupControl(page)).toContainText('Použita místní záloha');
    await expect(image(projector)).toHaveAttribute('src', firstSrc);
    const afterRerender = (await fixture.db.doc(`publicSessions/${sessionId}`).get()).data();
    expect([afterRerender.revision, afterRerender.mediaGeneration, afterRerender.slidePosition])
      .toEqual([beforeRerender.revision, beforeRerender.mediaGeneration, beforeRerender.slidePosition]);
    // Count actual operator checks: the initial transfer plus at least nine renewals.
    await expect.poll(() => operatorAuthorizations, { timeout: 40_000 }).toBeGreaterThanOrEqual(10);
    await decoded(projector, 'local');
    await expect(image(projector)).toHaveAttribute('src', firstSrc);
    await expect(projector.locator('html')).not.toHaveAttribute('data-private-failover-leak', 'true');
    const publicState = (await fixture.db.doc(`publicSessions/${sessionId}`).get()).data();
    expect(JSON.stringify(publicState)).not.toContain(privateAnswer);
    await testInfo.attach('local-media-direct-authority', { body: JSON.stringify({ directProjectorAuthorityRequests: authorityRequests, operatorAuthorizations, transportFailure: true, source: 'local', privateAnswerWithheld: true, sameSourceAfterParentRerender: true }), contentType: 'application/json' });
  } finally { await fixture.dispose(); }
});

test('authorizes only the exact current public prompt tuple without private metadata', async ({ baseURL }) => {
  requireEmulators(baseURL);
  const fixture = await mediaFixture();
  try {
    const prompt = await fixture.upload('image', syntheticImage(), 'image/png');
    await fixture.update('image', { questionImage: prompt.reference, correctAnswer: privateAnswer });
    await fixture.lock();
    const sessionId = await fixture.live();
    await fixture.navigate(sessionId, 3);
    const published = (await fixture.db.doc(`publicSessions/${sessionId}`).get()).data();
    const tuple = { sessionId, revision: published.revision, slidePosition: published.slidePosition,
      mediaGeneration: published.mediaGeneration, reference: prompt.reference };
    const authority = await fixture.anonymous.call('readLocalProjectorMediaAuthority', tuple);
    expect(authority).toMatchObject({ sessionId, revision: tuple.revision, slidePosition: tuple.slidePosition,
      mediaGeneration: tuple.mediaGeneration, media: { role: 'question-image', reference: prompt.reference } });
    expect(Object.keys(authority).sort()).toEqual(['schemaVersion', 'sessionId', 'revision', 'slidePosition', 'mediaGeneration', 'eventId', 'snapshotId', 'quizRevision', 'validUntilMs', 'expiresAtMs', 'media'].sort());
    expect(authority.expiresAtMs).toBeGreaterThan(Date.now());
    expect(authority.expiresAtMs).toBeLessThanOrEqual(Date.now() + 5000);
    const encoded = JSON.stringify(authority);
    for (const secret of [privateAnswer, fixture.loginEmail, 'scopeKey', 'correctAnswer', 'moderatorNote', 'actorId']) expect(encoded).not.toContain(secret);
    for (const change of [
      { sessionId: 'missing-synthetic-session' }, { revision: tuple.revision + 1 }, { slidePosition: tuple.slidePosition + 1 },
      { mediaGeneration: tuple.mediaGeneration + 1 }, { reference: `quiz-asset:${fixture.quizId}/${'f'.repeat(64)}` },
    ]) await expect(fixture.anonymous.call('readLocalProjectorMediaAuthority', { ...tuple, ...change })).rejects.toMatchObject({ code: 'functions/failed-precondition' });
    await fixture.navigate(sessionId, 5);
    await expect(fixture.anonymous.call('readLocalProjectorMediaAuthority', tuple)).rejects.toMatchObject({ code: 'functions/failed-precondition' });
  } finally { await fixture.dispose(); }
});

test('never falls back after HTTP authorization or missing-media responses', async ({ context, page, baseURL }, testInfo) => {
  const { fixture, prompt, sessionId, projector } = await createCase(context, page, baseURL, testInfo);
  try {
    let status = 401;
    let authorityRequests = 0;
    projector.on('request', request => { if (request.method() === 'POST' && isAuthority(new URL(request.url()))) authorityRequests++; });
    await projector.route(gatewayFor(prompt.reference, sessionId), route => route.request().method() !== 'GET' ? route.fallback() : route.fulfill({
      status, headers: { 'access-control-allow-origin': hosting, 'cache-control': 'no-store' }, body: '',
    }));
    for (const denied of [401, 403, 404, 410, 429, 500]) {
      status = denied;
      await fixture.navigate(sessionId, 2);
      await expect(image(projector)).toHaveCount(0);
      const response = projector.waitForResponse(response => response.request().method() === 'GET' && gatewayFor(prompt.reference, sessionId)(new URL(response.url())));
      await fixture.navigate(sessionId, 3);
      expect((await response).status()).toBe(denied);
      await expect(projector.getByRole('button', { name: 'Zkusit načíst znovu', exact: true })).toBeVisible();
      await wait(fallbackDeadlineMs + 250);
      await expect(localImage(projector)).toHaveCount(0);
    }
    expect(authorityRequests).toBe(0);
  } finally { await fixture.dispose(); }
});

test('uses a local PNG after a gateway 503 but revokes it after a late 403', async ({ context, page, baseURL }, testInfo) => {
  const { fixture, prompt, sessionId, projector } = await createCase(context, page, baseURL, testInfo);
  let release = () => {};
  const held = new Promise(resolve => { release = resolve; });
  try {
    let lateDenied = false;
    await projector.route(gatewayFor(prompt.reference, sessionId), async route => {
      if (route.request().method() !== 'GET') return route.fallback();
      if (lateDenied) await held;
      return route.fulfill({ status: lateDenied ? 403 : 503, headers: {
        'access-control-allow-origin': hosting, 'cache-control': 'no-store',
      }, body: '' });
    });
    await fixture.navigate(sessionId, 3);
    await decoded(projector, 'local');
    await fixture.navigate(sessionId, 2);
    await expect(image(projector)).toHaveCount(0);
    lateDenied = true;
    await fixture.navigate(sessionId, 3);
    await decoded(projector, 'local');
    release();
    await expect(localImage(projector)).toHaveCount(0);
    await expect(projector.getByRole('button', { name: 'Zkusit načíst znovu', exact: true })).toBeVisible();
  } finally { release(); await fixture.dispose(); }
});

test('rejects a changed pinned generation and clears an active local source on moderator logout', async ({ context, page, baseURL }, testInfo) => {
  const { fixture, prompt, sessionId, projector, backupPath } = await createCase(context, page, baseURL, testInfo);
  const assetRef = fixture.db.doc(`quizzes/${fixture.quizId}/mediaAssets/${prompt.assetId}`);
  const original = (await assetRef.get()).data();
  try {
    await projector.route(gatewayFor(prompt.reference, sessionId), route => route.request().method() === 'GET' ? route.abort('connectionfailed') : route.fallback());
    await assetRef.update({ generation: String(BigInt(original.generation) + 1n) });
    const authorityResponse = projector.waitForResponse(response => response.request().method() === 'POST' && isAuthority(new URL(response.url())));
    await fixture.navigate(sessionId, 3);
    await authorityResponse;
    await expect(projector.getByRole('button', { name: 'Zkusit načíst znovu', exact: true })).toBeVisible();
    await expect(localImage(projector)).toHaveCount(0);
    await assetRef.update({ generation: original.generation });
    await fixture.navigate(sessionId, 2);
    await page.getByLabel('Načíst místní zálohu', { exact: true }).setInputFiles(backupPath);
    await expect(backupControl(page)).toContainText('Místní záloha ověřena');
    await fixture.navigate(sessionId, 3);
    await decoded(projector, 'local');
    const account = await context.newPage();
    await account.goto('/admin');
    await account.getByRole('button', { name: 'Odhlásit se', exact: true }).first().click();
    await expect(page).toHaveURL(/\/admin\/login/u);
    await expect(localImage(projector)).toHaveCount(0, { timeout: 7500 });
  } finally { await fixture.dispose(); }
});

test('discards a delayed authority response after navigation', async ({ context, page, baseURL }, testInfo) => {
  const { fixture, prompt, sessionId, projector } = await createCase(context, page, baseURL, testInfo);
  let release = () => {};
  const held = new Promise(resolve => { release = resolve; });
  try {
    await projector.route(gatewayFor(prompt.reference, sessionId), route => route.request().method() === 'GET' ? route.abort('connectionfailed') : route.fallback());
    let captured = false;
    await projector.route(isAuthority, async route => {
      if (route.request().method() !== 'POST') return route.fallback();
      const response = await route.fetch({ maxRedirects: 0, maxRetries: 0 });
      try {
        expect(response.ok()).toBe(true);
        captured = true;
        await held;
        await route.fulfill({ response });
      } finally { await response.dispose(); }
    });
    await fixture.navigate(sessionId, 3);
    await expect.poll(() => captured).toBe(true);
    await fixture.navigate(sessionId, 2);
    await expect(image(projector)).toHaveCount(0);
    release();
    await wait(750);
    await expect(image(projector)).toHaveCount(0);
    await expect(localImage(projector)).toHaveCount(0);
  } finally { release(); await fixture.dispose(); }
});

test('invalidates a local source when its exact live session ends', async ({ context, page, baseURL }, testInfo) => {
  const { fixture, prompt, sessionId, projector } = await createCase(context, page, baseURL, testInfo);
  try {
    await projector.route(gatewayFor(prompt.reference, sessionId), route => route.request().method() === 'GET' ? route.abort('connectionfailed') : route.fallback());
    await fixture.navigate(sessionId, 3);
    await decoded(projector, 'local');
    const session = (await fixture.db.doc(`sessions/${sessionId}`).get()).data();
    await fixture.admin.call('endLiveSession', { sessionId, expectedRevision: session.revision });
    await expect(projector.getByText('Kvíz skončil', { exact: true })).toBeVisible();
    await expect(image(projector)).toHaveCount(0);
    await expect(localImage(projector)).toHaveCount(0);
  } finally { await fixture.dispose(); }
});

test('revokes retained bytes after the operator loses export permission and membership version changes', async ({ context, page, baseURL }, testInfo) => {
  const { fixture, prompt, sessionId, projector, backupPath } = await createCase(context, page, baseURL, testInfo);
  try {
    await projector.route(gatewayFor(prompt.reference, sessionId), route => route.request().method() !== 'GET' ? route.fallback() : route.fulfill({
      status: 503, headers: { 'access-control-allow-origin': hosting, 'cache-control': 'no-store' }, body: '',
    }));
    await fixture.navigate(sessionId, 3);
    await decoded(projector, 'local');
    const memberRef = fixture.db.doc(`memberships/${fixture.admin.auth.currentUser.uid}`);
    const member = (await memberRef.get()).data();
    const changedAt = performance.now();
    await memberRef.update({ permissions: member.permissions.filter(permission => permission !== 'event.export'), version: member.version + 1 });
    await expect(backupControl(page)).toHaveCount(0);
    await expect(localImage(projector)).toHaveCount(0, { timeout: 6000 });
    const clearedMs = Math.round(performance.now() - changedAt);
    expect(clearedMs).toBeLessThan(6500);
    expect((await readFile(backupPath)).byteLength).toBeGreaterThan(84);
    await expect(fixture.admin.call('readLocalEventMediaAuthorization', { eventId: fixture.eventId, reference: prompt.reference }))
      .rejects.toMatchObject({ code: 'functions/permission-denied' });
    await fixture.navigate(sessionId, 2);
    await fixture.navigate(sessionId, 3);
    await expect(projector.getByRole('button', { name: 'Zkusit načíst znovu', exact: true })).toBeVisible();
    await expect(localImage(projector)).toHaveCount(0);
    await testInfo.attach('local-media-membership-revocation', { body: JSON.stringify({ removedPermission: 'event.export', versionChanged: true, retainedFile: true, clearedMs, nextAttemptDenied: true }), contentType: 'application/json' });
  } finally { await fixture.dispose(); }
});

test('rejects a real MessageChannel request from an unmanaged same-origin sibling window', async ({ context, page, baseURL }, testInfo) => {
  const { fixture, prompt, sessionId, projector } = await createCase(context, page, baseURL, testInfo);
  try {
    await projector.route(gatewayFor(prompt.reference, sessionId), route => route.request().method() === 'GET' ? route.abort('connectionfailed') : route.fallback());
    await fixture.navigate(sessionId, 3);
    await decoded(projector, 'local');
    const [sibling] = await Promise.all([
      projector.waitForEvent('popup'),
      projector.evaluate(() => { window.open(window.location.href, 'synthetic-unmanaged-relay-sibling'); }),
    ]);
    await expect(sibling).toHaveURL(new RegExp(`/projector/${sessionId}\\?backupPilot=1$`, 'u'));
    const current = (await fixture.db.doc(`publicSessions/${sessionId}`).get()).data();
    const authority = await fixture.anonymous.call('readLocalProjectorMediaAuthority', {
      sessionId, revision: current.revision, slidePosition: current.slidePosition,
      mediaGeneration: current.mediaGeneration, reference: prompt.reference,
    });
    const result = await sibling.evaluate(async grant => {
      const moderator = window.opener?.opener;
      if (!moderator || moderator.location.origin !== window.location.origin) throw new Error('Synthetic sibling lacks the real same-origin moderator window.');
      return new Promise(resolve => {
        const channel = new MessageChannel();
        let messages = 0, receivedBytes = 0;
        channel.port1.onmessage = event => {
          messages++;
          if (event.data?.bytes instanceof ArrayBuffer) receivedBytes += event.data.bytes.byteLength;
        };
        moderator.postMessage({ type: 'justkviz-local-png-request-v1', requestId: crypto.randomUUID(), authority: grant }, window.location.origin, [channel.port2]);
        window.setTimeout(() => {
          channel.port1.close(); channel.port2.close(); resolve({ messages, receivedBytes });
        }, 1000);
      });
    }, authority);
    expect(result).toEqual({ messages: 0, receivedBytes: 0 });
    await decoded(projector, 'local');
    await testInfo.attach('local-media-unmanaged-source', { body: JSON.stringify({ actualSiblingWindow: true, actualTransferredMessagePort: true, validPublicAuthority: true, ...result }), contentType: 'application/json' });
  } finally { await fixture.dispose(); }
});

test('rejects corrupt bytes and a wrong-snapshot package in the live loader before recovering with the original file', async ({ context, page, baseURL }, testInfo) => {
  const { fixture, prompt, sessionId, projector, backupPath } = await createCase(context, page, baseURL, testInfo);
  try {
    const archived = await readFile(backupPath);
    const corrupt = Buffer.from(archived);
    corrupt[corrupt.length - 1] ^= 1;
    const corruptPath = testInfo.outputPath('corrupt-live.justkvizbackup');
    await writeFile(corruptPath, corrupt);
    const magicLength = Buffer.byteLength('JUSTKVIZ-MEDIA-BACKUP/1\n');
    const headerSize = archived.readUInt32BE(magicLength);
    const headerStart = magicLength + 4;
    const header = JSON.parse(archived.subarray(headerStart, headerStart + headerSize).toString('utf8'));
    header.snapshotId = (header.snapshotId[0] === 'a' ? 'b' : 'a') + header.snapshotId.slice(1);
    const wrongHeader = Buffer.from(JSON.stringify(header));
    expect(wrongHeader.length).toBe(headerSize);
    const wrongSnapshot = Buffer.from(archived);
    wrongHeader.copy(wrongSnapshot, headerStart);
    const wrongSnapshotPath = testInfo.outputPath('wrong-snapshot-live.justkvizbackup');
    await writeFile(wrongSnapshotPath, wrongSnapshot);
    await projector.route(gatewayFor(prompt.reference, sessionId), route => route.request().method() === 'GET' ? route.abort('connectionfailed') : route.fallback());
    for (const file of [corruptPath, wrongSnapshotPath]) {
      await fixture.navigate(sessionId, 2);
      await expect(image(projector)).toHaveCount(0);
      await page.getByLabel('Načíst místní zálohu', { exact: true }).setInputFiles(file);
      await expect(backupControl(page).getByRole('status')).toContainText('Místní záloha je poškozená, neplatná nebo ji server nepotvrdil.');
      await fixture.navigate(sessionId, 3);
      await expect(projector.getByRole('button', { name: 'Zkusit načíst znovu', exact: true })).toBeVisible();
      await expect(localImage(projector)).toHaveCount(0);
    }
    await fixture.navigate(sessionId, 2);
    await page.getByLabel('Načíst místní zálohu', { exact: true }).setInputFiles(backupPath);
    await expect(backupControl(page)).toContainText('Místní záloha ověřena');
    await fixture.navigate(sessionId, 3);
    await decoded(projector, 'local');
    await testInfo.attach('local-media-live-loader-invalid', { body: JSON.stringify({ sameLengthPayloadTamperRejected: true, wrongSnapshotHeaderRejected: true, networkFailureDidNotExposeInvalidBytes: true, originalFileReloadRecovered: true }), contentType: 'application/json' });
  } finally { await fixture.dispose(); }
});

test('warns for unsupported browser configuration and a separately opened projector tab', async ({ browser, context, page, baseURL }, testInfo) => {
  const active = await createCase(context, page, baseURL, testInfo);
  const unsupported = await browser.newContext({ baseURL, userAgent: 'Synthetic unsupported configuration Firefox/130.0', serviceWorkers: 'block' });
  let unsupportedCase;
  try {
    const { fixture, prompt, sessionId, projector } = active;
    await projector.close();
    const standalone = await context.newPage();
    await standalone.route(gatewayFor(prompt.reference, sessionId), route => route.request().method() === 'GET' ? route.abort('connectionfailed') : route.fallback());
    await standalone.goto(`/projector/${sessionId}?backupPilot=1`);
    expect(await standalone.evaluate(() => window.opener)).toBeNull();
    await fixture.navigate(sessionId, 3);
    await expect(backupControl(page)).toContainText('Samostatná karta místní zálohu nepoužije.');
    await expect(standalone.getByRole('button', { name: 'Zkusit načíst znovu', exact: true })).toBeVisible();
    await expect(localImage(standalone)).toHaveCount(0);
    const unsupportedPage = await unsupported.newPage();
    unsupportedCase = await createCase(unsupported, unsupportedPage, baseURL, testInfo, false);
    await expect(backupControl(unsupportedPage).getByRole('alert')).toContainText('Tato konfigurace nepodporuje místní zálohu.');
    await expect(unsupportedPage.getByLabel('Načíst místní zálohu', { exact: true })).toBeDisabled();
    await testInfo.attach('local-media-unsupported', { body: JSON.stringify({ separateTabWithoutOpener: 'no fallback', unsupportedUserAgent: 'warning and disabled picker', realFirefox: 'not run' }), contentType: 'application/json' });
  } finally {
    await unsupportedCase?.fixture.dispose();
    await unsupported.close();
    await active.fixture.dispose();
  }
});

test('clears a local image when active Firestore authority is lost while the browser stays online', async ({ context, page, baseURL }, testInfo) => {
  const { fixture, prompt, sessionId, projector } = await createCase(context, page, baseURL, testInfo);
  try {
    // Reload keeps the real opener relationship while installing the stream-only fault hook.
    const abortListen = await allowListenAbort(projector);
    let blocked = false;
    let failedRequests = 0;
    await projector.route(isFirestoreListen, route => {
      if (blocked) { failedRequests++; return route.abort('connectionfailed'); }
      return route.fallback();
    });
    await projector.reload();
    await expect(projector.getByText('Čekáme na první slide', { exact: true })).toBeVisible();
    await projector.route(gatewayFor(prompt.reference, sessionId), route => route.request().method() === 'GET' ? route.abort('connectionfailed') : route.fallback());
    await fixture.navigate(sessionId, 3);
    await decoded(projector, 'local');
    blocked = true;
    await abortListen();
    await expect.poll(() => failedRequests).toBeGreaterThan(0);
    await expect(projector.getByRole('heading', { name: 'Projektor není připojen', exact: true })).toBeVisible({ timeout: 45_000 });
    await expect(image(projector)).toHaveCount(0);
    expect(await projector.evaluate(() => navigator.onLine)).toBe(true);
  } finally { await fixture.dispose(); }
});
