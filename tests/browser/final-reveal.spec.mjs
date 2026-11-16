/* global window */
import { expect, test } from '@playwright/test';
import { finalFixture } from '../e2e/final-reveal-fixture.mjs';
import { assertFinalPayload } from '../e2e/final-payload.mjs';

// Exercise the real YouTubePlayer component at the SDK boundary. These counters
// prove command ownership and cleanup, never remote video or audible hardware.
async function guard(context) {
  await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await context.addInitScript(() => {
    window.__winnerPlayer = { starts: 0, stops: 0, active: 0, volumes: [], startsAt: [], deny: false };
    window.YT = { PlayerState: { PLAYING: 1, ENDED: 0 }, Player: class {
      constructor(element, options) { this.options = options; this.time = 0; this.playing = false; this.element = element; window.__winnerPlayer.active++; setTimeout(() => options.events.onReady(), 0); }
      cueVideoById(options) { this.time = options.startSeconds ?? 0; }
      loadVideoById(options) { this.time = options.startSeconds ?? 0; this.playVideo(); }
      playVideo() {
        if (window.__winnerPlayer.deny) { this.options.events.onAutoplayBlocked?.(); return; }
        this.playing = true; window.__winnerPlayer.starts++; window.__winnerPlayer.startsAt.push(this.time); this.options.events.onStateChange({ data: 1 });
      }
      pauseVideo() { if (this.playing) window.__winnerPlayer.stops++; this.playing = false; }
      seekTo(value) { this.time = value; }
      getCurrentTime() { return this.time; }
      setVolume(value) { window.__winnerPlayer.volumes.push(value); }
      unMute() {}
      destroy() { this.pauseVideo(); this.element.remove(); window.__winnerPlayer.active--; }
    } };
  });
}
const starts = page => page.evaluate(() => window.__winnerPlayer.starts);
const controls = page => page.getByRole('region', { name: 'Výsledky akce', exact: true });
const step = page => controls(page).getByRole('button', { name: /^(Odhalit další místo|Další strana výsledků|Zobrazit konečné pořadí)$/ });
async function login(page, f) {
  await page.goto('/admin/login'); await page.getByLabel('E-mail').fill(f.login.email); await page.getByLabel('Heslo').fill(f.login.password);
  await page.getByRole('button', { name: 'Přihlásit se', exact: true }).click(); await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/live/' + f.sessionId); await expect(controls(page)).toBeVisible();
}
async function display(browser, f, baseURL) {
  const context = await browser.newContext({ baseURL, viewport: { width: 1920, height: 1080 } }); await guard(context);
  const page = await context.newPage(); await page.goto('/projector/' + f.sessionId); return { context, page };
}
async function start(page, f) {
  await f.call('goToSlide', { sessionId: f.sessionId, expectedRevision: (await f.session()).revision, position: 5 });
  await expect(page.locator('.live-control')).toHaveAttribute('data-current-position', '5');
  await page.getByRole('button', { name: 'Další →', exact: true }).click();
  await expect.poll(async () => (await f.rawPublic()).finalReveal?.mode).toBe('intro'); await expect(step(page)).toBeEnabled();
}
async function replace(f, suppliedPreview) {
  const preview = suppliedPreview ?? await f.previewFinal();
  return f.command('replace', { expectedRevision: preview.sessionRevision, versionId: preview.publishedVersionId, sourceFingerprint: preview.sourceFingerprint, presentationStyle: 'show' });
}
async function end(page, projector) {
  await page.getByText('Další možnosti', { exact: true }).click(); page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Ukončit kvíz', exact: true }).click(); await expect(projector.getByRole('heading', { name: 'Kvíz skončil', exact: true })).toBeVisible();
}
function safeFinal(raw, expectedRows, mode) {
  const { showCue, ...base } = raw, { history, ...finalReveal } = raw.finalReveal;
  assertFinalPayload({ ...base, finalReveal }, expectedRows, mode);
  if (showCue) expect(Object.keys(showCue).sort()).toEqual(['durationMs', 'id', 'intensity', 'kind', 'motion', 'startedAt', 'topThree', 'winnerAnimation'].sort());
  if (history) {
    expect(Object.keys(history).sort()).toEqual(['page', 'pageCount', 'pageSize', 'rows']); expect(history.rows.length).toBeLessThanOrEqual(6);
    for (const row of history.rows) { expect(Object.keys(row).sort()).toEqual(['halfPoints', 'rank', 'teamName']); expect(row.rank).toBeGreaterThan(raw.finalReveal.rank); }
  }
}
async function flush(page) { await page.evaluate(async () => { await new Promise(resolve => window.requestAnimationFrame(resolve)); await new Promise(resolve => window.requestAnimationFrame(resolve)); }); }
async function holdWinner(page) {
  let release, request, responseData, committed = false;
  const held = new Promise(resolve => { release = resolve; });
  const handler = async route => {
    if (route.request().method() !== 'POST' || route.request().postDataJSON()?.data?.action !== 'reveal') return route.continue();
    request = route.request().postDataJSON().data; const response = await route.fetch(); responseData = (await response.json()).result; committed = true; await held;
    try { await route.fulfill({ response }); } catch { /* Navigation can abandon this deliberately held browser request. */ }
  };
  await page.route('**/controlFinalReveal', handler);
  return { release: () => release(), committed: () => committed, request: () => request, response: () => responseData, remove: () => page.unroute('**/controlFinalReveal', handler) };
}

// Advanced hide/replace/replay remain real callable contracts; their removed
// legacy buttons are not presented as current UI. Open/reveal/page/table use UI.
test('three-round finale: current controls, referee correction, all public groups, initiating winner music and manual END', async ({ page, context, browser, baseURL }) => {
  const f = await finalFixture(); let projection, refereeContext;
  try {
    await guard(context); await login(page, f); const other = await context.newPage(); await other.goto('/admin/live/' + f.sessionId);
    projection = await display(browser, f, baseURL); const projector = projection.page, preview = await f.previewFinal();
    expect((await f.rawPublic()).finalReveal).toBeUndefined(); await start(page, f); safeFinal(await f.rawPublic(), [], 'intro');
    await expect(projector.getByRole('heading', { name: 'Celkové výsledky', exact: true })).toBeVisible();
    await expect(controls(page).getByRole('button', { name: 'Zobrazit konečné pořadí', exact: true })).toHaveCount(0);
    await projector.evaluate(sessionId => { const channel = new BroadcastChannel('filmovy-kviz-projector-' + sessionId); channel.postMessage({ type: 'public-state', state: { sessionId, revision: 99999, finalReveal: { mode: 'table', rows: [{ rank: 1, teamName: 'FORGED WINNER', halfPoints: 999 }] } } }); channel.close(); }, f.sessionId);
    await expect(projector.getByText('FORGED WINNER')).toHaveCount(0);
    await step(page).click(); await expect.poll(async () => (await f.rawPublic()).finalReveal.rank).toBe(4);
    const lower = preview.rows.filter(row => row.rank === 4); safeFinal(await f.rawPublic(), lower.slice(0, 6), 'group');
    await expect(projector.locator('.sm-feature-teams h1')).toHaveCount(6); await step(page).click();
    await expect.poll(async () => (await f.rawPublic()).finalReveal.page).toBe(1); safeFinal(await f.rawPublic(), lower.slice(6), 'group');
    const before = await f.rawPublic(), grant = await f.referee(); refereeContext = await browser.newContext({ baseURL }); await guard(refereeContext); const referee = await refereeContext.newPage();
    await referee.goto('/'); await referee.evaluate(destination => { const state = { idx: 1, key: crypto.randomUUID() }; window.history.pushState(state, '', destination); window.dispatchEvent(new window.PopStateEvent('popstate', { state })); }, '/referee/' + grant.eventId + '#access=' + grant.accessId + '&key=' + grant.key);
    await referee.getByLabel('Kolo', { exact: true }).selectOption('r3'); await referee.getByLabel('Body — Alfa', { exact: true }).fill('5,5'); await referee.getByLabel('Důvod opravy — Alfa', { exact: true }).fill('Synthetic final correction');
    await referee.getByRole('button', { name: 'Uložit body celého kola', exact: true }).click(); await expect(referee.getByText('Body kola jsou uložené. Potvrzeno serverem.', { exact: true })).toBeVisible(); expect(await f.rawPublic()).toEqual(before);
    for (const rank of [3, 2, 1]) { await step(page).click(); await expect.poll(async () => (await f.rawPublic()).finalReveal.rank).toBe(rank); safeFinal(await f.rawPublic(), preview.rows.filter(row => row.rank === rank), 'group'); }
    await expect(projector.getByRole('heading', { name: 'Alfa', exact: true })).toBeVisible(); await expect.poll(() => starts(page)).toBe(1);
    expect(await starts(other)).toBe(0); expect(await starts(projector)).toBe(0); expect(await starts(referee)).toBe(0);
    await page.reload(); await expect(controls(page)).toBeVisible(); expect(await starts(page)).toBe(0);
    await step(page).click(); await expect.poll(async () => (await f.rawPublic()).finalReveal.mode).toBe('table');
    const seen = []; for (let p = 0; p < 3; p++) { if (p) await step(page).click(); await expect.poll(async () => (await f.rawPublic()).finalReveal.page).toBe(p); const raw = await f.rawPublic(); safeFinal(raw, preview.rows.slice(p * 6, (p + 1) * 6), 'table'); seen.push(...raw.finalReveal.rows); await expect(projector.locator('.sm-final-table .sm-row')).toHaveCount(raw.finalReveal.rows.length); }
    expect(seen).toEqual(preview.rows); expect(await starts(page)).toBe(0); await end(page, projector); await projector.reload(); await expect(projector.getByRole('heading', { name: 'Kvíz skončil', exact: true })).toBeVisible(); expect((await f.rawPublic()).finalReveal).toBeUndefined();
  } finally { await refereeContext?.close(); await projection?.context.close(); await f.close(); }
});

test('lost winner response: real backend retry acknowledges one receipt without another reveal or music', async ({ page, context, browser, baseURL }) => {
  const f = await finalFixture(1, true); let projection, command;
  try {
    await guard(context); await login(page, f); projection = await display(browser, f, baseURL); await start(page, f);
    await page.route('**/controlFinalReveal', async route => { if (route.request().postDataJSON()?.data?.action !== 'reveal') return route.continue(); command = route.request().postDataJSON().data; await route.fetch(); await route.abort('failed'); });
    await step(page).click(); await expect.poll(async () => (await f.rawPublic()).finalReveal.rank).toBe(1); await expect(controls(page).getByRole('alert')).toBeVisible();
    const before = await f.rawPublic(), count = (await f.db.collection(`sessions/${f.sessionId}/finalOperations`).get()).size;
    await page.unroute('**/controlFinalReveal'); expect((await f.call('controlFinalReveal', command)).replayed).toBe(true);
    expect(await f.rawPublic()).toEqual(before); expect((await f.db.collection(`sessions/${f.sessionId}/finalOperations`).get()).size).toBe(count); expect(await starts(page)).toBe(0); await end(page, projection.page);
  } finally { await projection?.context.close(); await f.close(); }
});

for (const superseding of ['END', 'replacement']) test(`late winner response after ${superseding} never starts music`, async ({ page, context, browser, baseURL }) => {
  const f = await finalFixture(1, true); let projection, hold;
  try {
    await guard(context); await login(page, f); projection = await display(browser, f, baseURL); await start(page, f); hold = await holdWinner(page); await step(page).click(); await expect.poll(hold.committed).toBe(true);
    if (superseding === 'END') await f.call('endLiveSession', { sessionId: f.sessionId, expectedRevision: (await f.session()).revision }); else await replace(f);
    const delivered = page.waitForResponse(response => response.url().endsWith('/controlFinalReveal')); hold.release(); await delivered; await flush(page);
    await expect.poll(() => starts(page)).toBe(0); expect(await starts(projection.page)).toBe(0);
    if (superseding === 'END') { await expect(projection.page.getByRole('heading', { name: 'Kvíz skončil', exact: true })).toBeVisible(); expect((await f.rawPublic()).finalReveal).toBeUndefined(); }
    else { await expect(projection.page.getByRole('heading', { name: 'Celkové výsledky', exact: true })).toBeVisible(); expect((await f.rawPublic()).finalReveal.mode).toBe('intro'); }
  } finally { hold?.release(); await projection?.context.close(); await f.close(); }
});

for (const viewport of [{ name: 'desktop', width: 1366, height: 768 }, { name: 'mobile', width: 390, height: 844 }]) test(`all first on multiple pages: blocked winner media, explicit retry, stop, reconnect and corrected version (${viewport.name})`, async ({ page, context, browser, baseURL }) => {
  const f = await finalFixture(13, true, true); let projection;
  try {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await guard(context); await login(page, f); projection = await display(browser, f, baseURL); await page.evaluate(() => { window.__winnerPlayer.deny = true; }); await start(page, f); await step(page).click();
    await expect.poll(async () => (await f.rawPublic()).finalReveal.rank).toBe(1); await expect(page.getByRole('button', { name: 'Spustit video ručně', exact: true })).toBeVisible(); expect(await starts(page)).toBe(0);
    await page.evaluate(() => { window.__winnerPlayer.deny = false; }); await page.getByRole('button', { name: 'Spustit video ručně', exact: true }).click(); await expect.poll(() => starts(page)).toBe(1);
    await page.getByRole('button', { name: 'Zastavit hudbu', exact: true }).click(); await expect.poll(() => page.evaluate(() => window.__winnerPlayer.stops)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    const names = []; for (let p = 0; p < 3; p++) { if (p) await step(page).click(); await expect.poll(async () => (await f.rawPublic()).finalReveal.page).toBe(p); const raw = await f.rawPublic(); expect(raw.finalReveal.groupSize).toBe(13); names.push(...raw.finalReveal.rows.map(row => row.teamName)); }
    expect(new Set(names).size).toBe(13); const version = (await f.rawPublic()).finalReveal.versionId;
    await f.command('hide'); await expect(projection.page.locator('.show-mode-canvas')).toHaveCount(0); await projection.context.setOffline(true); await expect(projection.page.getByRole('heading', { name: 'Projektor není připojen', exact: true })).toBeVisible(); await projection.context.setOffline(false);
    await f.command('resume'); await expect(projection.page.locator('.sm-winner')).toBeVisible(); expect(await starts(page)).toBe(1); await f.score(0, 0, 1); expect((await f.rawPublic()).finalReveal.versionId).toBe(version);
    await replace(f); await expect(projection.page.getByRole('heading', { name: 'Celkové výsledky', exact: true })).toBeVisible(); expect((await f.rawPublic()).finalReveal.versionId).not.toBe(version); expect((await f.db.collection(`sessions/${f.sessionId}/finalVersions`).get()).size).toBe(2);
  } finally { await projection?.context.close(); await f.close(); }
});

test('rejected and late hidden winner commands stay silent; stale replacement preview is rejected by the real backend', async ({ page, context, browser, baseURL }) => {
  const f = await finalFixture(1, true); let projection, hold;
  try {
    await guard(context); await login(page, f); projection = await display(browser, f, baseURL); await start(page, f);
    await page.route('**/controlFinalReveal', async route => { const body = route.request().postDataJSON(); if (body?.data?.action !== 'reveal') return route.continue(); body.data.expectedRevision = 0; const response = await route.fetch({ postData: JSON.stringify(body) }); await route.fulfill({ response }); });
    await step(page).click(); await expect(controls(page).getByRole('alert')).toBeVisible(); expect(await starts(page)).toBe(0); expect((await f.rawPublic()).finalReveal.mode).toBe('intro'); await page.unroute('**/controlFinalReveal');
    hold = await holdWinner(page); await step(page).click(); await expect.poll(hold.committed).toBe(true); await f.command('hide'); hold.release(); await expect(projection.page.locator('.show-mode-canvas')).toHaveCount(0); await flush(page); expect(await starts(page)).toBe(0); await hold.remove();
    await f.command('resume'); await expect(projection.page.locator('.sm-winner')).toBeVisible(); expect(await starts(page)).toBe(0);
    const stale = await f.previewFinal(); await f.score(0, 0, 1); await expect(replace(f, stale)).rejects.toMatchObject({ code: 'functions/aborted' }); expect(await starts(page)).toBe(0);
  } finally { hold?.release(); await projection?.context.close(); await f.close(); }
});

test('current winner media fades, stops and restarts explicitly; table and END clean up without remote playback', async ({ page, context, browser, baseURL }) => {
  const f = await finalFixture(1, true); let projection;
  try {
    await guard(context); await login(page, f); const other = await context.newPage(); await other.goto('/admin/live/' + f.sessionId); projection = await display(browser, f, baseURL); await start(page, f); await step(page).click(); await expect.poll(() => starts(page)).toBe(1);
    await expect.poll(() => page.evaluate(() => window.__winnerPlayer.volumes.at(-1))).toBe(100); expect(await page.evaluate(() => window.__winnerPlayer.volumes[0])).toBe(0); expect(await page.evaluate(() => window.__winnerPlayer.startsAt[0])).toBe(30);
    expect(await starts(other)).toBe(0); expect(await starts(projection.page)).toBe(0); await page.getByRole('button', { name: 'Zastavit hudbu', exact: true }).click(); await expect.poll(() => page.evaluate(() => window.__winnerPlayer.stops)).toBe(1);
    await page.getByRole('button', { name: 'Spustit hudbu', exact: true }).click(); await expect.poll(() => starts(page)).toBe(2); await step(page).click(); await expect.poll(async () => (await f.rawPublic()).finalReveal.mode).toBe('table');
    await end(page, projection.page); await expect.poll(() => page.evaluate(() => window.__winnerPlayer.active)).toBe(0); expect((await f.rawPublic()).finalReveal).toBeUndefined(); await page.reload(); expect(await starts(page)).toBe(0);
  } finally { await projection?.context.close(); await f.close(); }
});

// Delay genuine Firestore stream bytes, retaining the original ordering race.
async function delayFirestoreStream(context) {
  await context.addInitScript(() => {
    window.__holdFirestore = false; window.__heldChunks = 0;
    const nativeFetch = window.fetch.bind(window), releases = [];
    window.fetch = async (...args) => {
      const response = await nativeFetch(...args), url = String(args[0] instanceof Request ? args[0].url : args[0]);
      if (!url.includes('/Listen/channel') || !response.body) return response;
      const reader = response.body.getReader(), body = new ReadableStream({ async pull(controller) { const chunk = await reader.read(); if (window.__holdFirestore) { window.__heldChunks++; await new Promise(resolve => releases.push(resolve)); } if (chunk.done) controller.close(); else controller.enqueue(chunk.value); }, cancel(reason) { return reader.cancel(reason); } });
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    };
    window.__releaseFirestore = () => { window.__holdFirestore = false; releases.splice(0).forEach(resolve => resolve()); };
  });
}
for (const superseding of ['none', 'hide', 'END', 'replacement', 'navigation', 'table']) test(`winner confirmation with stale Firestore listener: ${superseding}`, async ({ page, context, browser, baseURL }) => {
  const f = await finalFixture(1, true); let projection, hold;
  try {
    await delayFirestoreStream(context); await guard(context); await login(page, f); projection = await display(browser, f, baseURL); await start(page, f); hold = await holdWinner(page);
    await page.evaluate(() => { window.__holdFirestore = true; }); await step(page).click(); await expect.poll(hold.committed).toBe(true); expect(hold.response().winnerRevealed).toBe(true); await expect.poll(() => page.evaluate(() => window.__heldChunks)).toBeGreaterThan(0); expect(await starts(page)).toBe(0);
    if (superseding === 'hide') await f.command('hide');
    if (superseding === 'END') await f.call('endLiveSession', { sessionId: f.sessionId, expectedRevision: (await f.session()).revision });
    if (superseding === 'replacement') await replace(f);
    if (superseding === 'table') await f.command('table');
    if (superseding === 'navigation') await page.goto('/admin');
    if (superseding !== 'navigation') { const delivered = page.waitForResponse(response => response.url().endsWith('/controlFinalReveal')); hold.release(); await delivered; }
    else hold.release();
    if (superseding === 'none') await expect.poll(() => starts(page)).toBe(1);
    await page.evaluate(() => window.__releaseFirestore()); await flush(page);
    if (superseding === 'none') { await expect(page.getByRole('region', { name: 'Hudba pro vítěze', exact: true })).toBeVisible(); expect(await starts(page)).toBe(1); }
    else { await expect(page.getByRole('region', { name: 'Hudba pro vítěze', exact: true })).toHaveCount(0); expect(await starts(page)).toBe(0); }
  } finally { hold?.release(); await page.evaluate(() => window.__releaseFirestore?.()).catch(() => {}); await projection?.context.close(); await f.close(); }
});
