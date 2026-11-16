/* global window, document */
import { test, expect } from '@playwright/test';
import { mediaFixture, syntheticAudio } from '../e2e/media-fixture.mjs';
import { browserFixture } from '../access/browser-fixture.mjs';

async function loopbackOnly(context) {
  await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
}
async function login(page, person) {
  await page.goto('/admin/login');
  await page.getByLabel('E-mail', { exact: true }).fill(person.email);
  await page.getByLabel('Heslo', { exact: true }).fill(person.password);
  await page.getByRole('button', { name: 'Přihlásit se', exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
}
async function navigate(page, pathname) {
  await page.evaluate(path => {
    const previous = window.history.state ?? {};
    window.history.pushState({ ...previous, idx: (previous.idx ?? 0) + 1, key: window.crypto.randomUUID() }, '', path);
    window.dispatchEvent(new window.PopStateEvent('popstate', { state: window.history.state }));
  }, pathname);
}
async function frames(page) {
  await page.evaluate(() => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))));
}
async function prepareAudio() {
  const media = await mediaFixture();
  try {
    const upload = await media.upload('audio', syntheticAudio(30), 'audio/wav');
    await media.update('audio', { mediaSource: upload.reference, clipStartSeconds: 1, clipEndSeconds: 25 });
    await media.lock();
    const sessionId = await media.live();
    await media.navigate(sessionId, 4);
    return { media, sessionId };
  } catch (error) { await media.dispose(); throw error; }
}

for (const changeIdentity of [false, true]) {
  test(changeIdentity ? 'queued eligible playback report is discarded after leaving and changing identity' : 'queued eligible playback error reaches the server when identity stays current', async ({ browser }) => {
    const { media, sessionId } = await prepareAudio();
    let access, context, release = () => {};
    try {
      if (changeIdentity) access = await browserFixture();
      context = await browser.newContext({ baseURL: 'http://127.0.0.1:5198' });
      await loopbackOnly(context);
      const page = await context.newPage();
      const readSession = async () => (await media.db.doc('sessions/' + sessionId).get()).data();
      const privateCanary = 'PRIVATE_PLAYBACK_SESSION_TITLE';
      await media.db.doc('sessions/' + sessionId).update({ quizTitle: privateCanary });
      await login(page, { email: media.loginEmail, password: media.loginPassword });
      await navigate(page, '/admin/live/' + sessionId);
      await expect(page.getByRole('heading', { name: privateCanary, exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
      const reports = [];
      page.on('request', request => {
        if (request.method() !== 'POST' || !request.url().endsWith('/reportMediaPlayback')) return;
        const data = request.postDataJSON()?.data;
        if (data?.sessionId === sessionId) reports.push({ generation: data.mediaGeneration, state: data.playbackState });
      });
      const gate = new Promise(resolve => { release = resolve; });
      let committed = false, delivered;
      const delivery = new Promise(resolve => { delivered = resolve; });
      await page.route('**/playMedia', async route => {
        if (route.request().method() !== 'POST' || route.request().postDataJSON()?.data.sessionId !== sessionId) return route.continue();
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        committed = true;
        await gate;
        await route.fulfill({ response });
        delivered();
      });
      const before = await readSession();
      await page.getByRole('button', { name: 'Play', exact: true }).click();
      await expect.poll(() => committed).toBe(true);
      await expect.poll(async () => (await readSession()).mediaGeneration).toBeGreaterThan(before.mediaGeneration);
      const generation = (await readSession()).mediaGeneration;
      await expect.poll(() => page.locator('.moderator-audio-player audio').evaluate(audio => !audio.paused && audio.currentTime > 1)).toBe(true);
      await page.evaluate(async ({ sessionId, generation }) => {
        const channel = new window.BroadcastChannel('filmovy-kviz-projector-' + sessionId);
        channel.postMessage({ type: 'playback-state', sessionId, mediaGeneration: generation, playbackState: 'error' });
        await new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
        channel.close();
      }, { sessionId, generation });
      await expect(page.getByText('Médium se na projektoru nepřehrálo', { exact: true })).toBeVisible();
      expect(reports).toEqual([]);
      if (changeIdentity) {
        await navigate(page, '/account');
        await page.getByRole('button', { name: 'Odhlásit pouze toto zařízení', exact: true }).click();
        await page.getByLabel('E-mail', { exact: true }).fill(access.viewer.email);
        await page.getByLabel('Heslo', { exact: true }).fill(access.viewer.password);
        await page.locator('form').getByRole('button', { name: 'Přihlásit se', exact: true }).click();
        await expect(page.getByLabel('Zobrazované jméno', { exact: true })).toHaveValue('viewer');
        await page.evaluate(canary => {
          window.__playbackPrivateLeak = false;
          window.__playbackPrivateObserver = new window.MutationObserver(() => {
            if (document.body.innerText.includes(canary)) window.__playbackPrivateLeak = true;
          });
          window.__playbackPrivateObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
        }, privateCanary);
      }
      // The queued error remains eligible on the server immediately before release.
      const eligible = await readSession();
      expect(eligible.status).toBe('active');
      expect(eligible.mediaGeneration).toBe(generation);
      expect(eligible.mediaCommand).toBe('play');
      expect(['error', 'finished']).not.toContain(eligible.mediaPlaybackState);
      expect(reports).toEqual([]);
      const transport = page.waitForResponse(response => response.url().endsWith('/playMedia')
        && response.request().method() === 'POST' && response.request().postDataJSON()?.data.sessionId === sessionId);
      release();
      const response = await transport;
      expect(await response.finished()).toBeNull();
      await delivery;
      if (changeIdentity) {
        await navigate(page, '/admin/live/' + sessionId);
        await expect(page.getByRole('heading', { name: 'Tato činnost není dostupná', exact: true })).toBeVisible();
        await frames(page);
        await expect(page.locator('.live-control')).toHaveCount(0);
        expect(reports).toEqual([]);
        await expect(page.getByText(privateCanary, { exact: true })).toHaveCount(0);
        expect(await page.evaluate(() => window.__playbackPrivateLeak)).toBe(false);
        await page.evaluate(() => window.__playbackPrivateObserver.disconnect());
        const unchanged = await readSession();
        expect(unchanged.mediaGeneration).toBe(generation);
        expect(['error', 'finished']).not.toContain(unchanged.mediaPlaybackState);
      } else {
        await expect.poll(() => reports.some(report => report.generation === generation && report.state === 'error')).toBe(true);
        await expect.poll(async () => (await readSession()).mediaPlaybackState).toBe('error');
      }
    } finally {
      release();
      await context?.close();
      await access?.dispose();
      await media.dispose();
    }
  });
}
