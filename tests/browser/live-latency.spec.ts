import { setTimeout } from 'node:timers/promises';
import { expect, test, type Browser, type BrowserContext, type Page, type Route } from '@playwright/test';

const injectedDelayMs = 1_200;
const callableUrl = 'http://127.0.0.1:5001/demo-filmovy-kviz-v2/europe-west1/goToSlide';
const questionImage = 'https://example.test/image.jpg';
const answerImage = 'https://example.test/answer.jpg';
const question = 'Syntetický veřejný prompt';
const imageQuestion = 'Syntetická obrázková otázka';
const agenda = 'Syntetická agenda';
const answer = 'Syntetická odpověď';
const youtubeApi = 'https://www.youtube.com/iframe_api';
const youtubeMock = `
(() => {
  class Player {
    constructor(element, { videoId, events }) {
      this.events = events;
      element.dataset.syntheticYoutube = videoId;
      queueMicrotask(() => events.onReady());
    }
    cueVideoById() {}
    loadVideoById() { this.playVideo(); }
    playVideo() { queueMicrotask(() => this.events.onStateChange({ data: 1 })); }
    pauseVideo() {}
    seekTo() {}
    destroy() {}
  }
  window.YT = { Player, PlayerState: { ENDED: 0, PLAYING: 1 } };
  window.onYouTubeIframeAPIReady?.();
})();
`;

function fulfillImage(route: Route) {
  return route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="blue"/></svg>',
  });
}

async function localContext(browser: Browser) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') return route.continue();
    if (url.origin === 'https://example.test') return fulfillImage(route);
    return route.abort('blockedbyclient');
  });
  return context;
}

function holdRequest() {
  let release = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  return { held, release };
}

function trace(page: Page) {
  return page.locator('[data-latency-status]');
}

function stage(page: Page, name: string, target?: string) {
  const targetSelector = target === undefined ? '' : `[data-latency-target="${target}"]`;
  return trace(page).locator(`[data-latency-stage="${name}"]${targetSelector}`);
}

async function stageMs(page: Page, name: string, target?: string) {
  const sample = stage(page, name, target);
  await expect(sample).toHaveAttribute('data-latency-ms', /^\d+(?:\.\d+)?$/u);
  return Number(await sample.getAttribute('data-latency-ms'));
}

async function confirmedFrame(page: Page, revision: number) {
  await expect(trace(page)).toHaveAttribute('data-latency-status', 'confirmed');
  await expect(trace(page)).toHaveAttribute('data-latency-revision', String(revision));
  const callableMs = await stageMs(page, 'callable');
  const snapshotMs = await stageMs(page, 'snapshot');
  const frameMs = await stageMs(page, 'frame');
  expect(frameMs).toBeGreaterThanOrEqual(snapshotMs);
  return { callableMs, snapshotMs, frameMs };
}

async function expectPosition(page: Page, position: number) {
  await expect(page.locator('.focused-live-shell')).toHaveAttribute('data-current-position', String(position));
}

function next(page: Page) {
  return page.getByRole('button', { name: 'Další →', exact: true }).click();
}

async function startSession(context: BrowserContext, baseURL: string | undefined) {
  const moderator = await context.newPage();
  await moderator.goto(`${baseURL}/admin/login`);
  await moderator.getByLabel('E-mail').fill('admin@example.test');
  await moderator.getByLabel('Heslo').fill('LocalQuiz123!');
  await moderator.getByRole('button', { name: 'Přihlásit se' }).click();
  await expect(moderator).toHaveURL(/\/admin$/u);
  await moderator.goto(`${baseURL}/admin/quizzes/projector-lifecycle-e2e`);
  await moderator.getByRole('button', { name: 'Spustit kvíz' }).click();
  await expect(moderator).toHaveURL(/\/admin\/live\/[^/]+$/u);
  const sessionId = new URL(moderator.url()).pathname.split('/').at(-1);
  const projectorUrl = `${baseURL}/projector/${sessionId}?latency=1`;
  await moderator.goto(`${moderator.url()}?latency=1`);
  await expectPosition(moderator, 0);
  const diagnostics = moderator.locator('.live-diagnostics');
  await diagnostics.locator('summary').click();
  await expect(diagnostics.getByText('Časy posledního měřeného příkazu', { exact: true })).toBeVisible();
  return { moderator, projectorUrl };
}

async function endSession(moderator: Page, projector: Page) {
  await moderator.getByText('Další možnosti', { exact: true }).click();
  await moderator.getByRole('button', { name: 'Ukončit kvíz' }).click();
  await expect(projector.getByText('Kvíz skončil')).toBeVisible();
}

async function watchForAnswer(page: Page) {
  let answerRequests = 0;
  page.on('request', request => { if (request.url() === answerImage) answerRequests += 1; });
  await page.addInitScript(({ answerText, imageUrl }) => {
    new MutationObserver(() => {
      const root = document.documentElement;
      if (!root) return;
      root.dataset.earlyAnswer ??= 'false';
      if (document.body?.textContent?.includes(answerText) || document.querySelector(`img[src="${imageUrl}"]`)) {
        root.dataset.earlyAnswer = 'true';
      }
    }).observe(document, { childList: true, characterData: true, subtree: true });
  }, { answerText: answer, imageUrl: answerImage });
  return async () => {
    await expect(page.locator('html')).toHaveAttribute('data-early-answer', 'false');
    await expect(page.locator('.slide-answer')).toHaveCount(0);
    expect(answerRequests).toBe(0);
  };
}

test('separates callable and image delay, then recovers an independently offline projector', async ({ browser, baseURL }, testInfo) => {
  const context = await localContext(browser);
  const isolatedContext = await localContext(browser);

  try {
    const { moderator, projectorUrl } = await startSession(context, baseURL);
    const projector = await context.newPage();
    const assertNoAnswer = await watchForAnswer(projector);
    await projector.goto(projectorUrl);
    await expect(projector.getByText('Čekáme na první slide')).toBeVisible();
    await next(moderator);
    await expect(projector.getByRole('heading', { name: 'Začínáme' })).toBeVisible();
    const baseline = await confirmedFrame(moderator, 1);

    const callableDelay = await test.step('Delay the moderator navigation request before it reaches the emulator', async () => {
      const gate = holdRequest();
      let handling: Promise<void> | undefined;
      const routeCallable = async (route: Route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        handling = gate.held.then(() => route.continue());
        return handling;
      };
      await moderator.route(callableUrl, routeCallable);
      try {
        await Promise.all([moderator.waitForRequest(request => request.url() === callableUrl && request.method() === 'POST'), next(moderator)]);
        await expect(trace(moderator)).toHaveAttribute('data-latency-status', 'pending');
        await stageMs(moderator, 'dispatched');
        await expect(stage(moderator, 'callable')).not.toHaveAttribute('data-latency-ms', /./u);
        await expect(projector.getByRole('heading', { name: 'Začínáme' })).toBeVisible();
        await setTimeout(injectedDelayMs);
      } finally {
        gate.release();
        await handling;
        await moderator.unroute(callableUrl, routeCallable);
      }
      await expect(projector.getByText(question, { exact: true })).toBeVisible();
      await assertNoAnswer();
      const sample = await confirmedFrame(moderator, 2);
      expect(sample.callableMs).toBeGreaterThanOrEqual(injectedDelayMs);
      expect(sample.snapshotMs).toBeGreaterThanOrEqual(injectedDelayMs);
      return sample;
    });

    await next(moderator);
    await expect(projector.getByText(agenda, { exact: true })).toBeVisible();
    await confirmedFrame(moderator, 3);

    const imageDelay = await test.step('Delay only the projector image after its new slide is confirmed', async () => {
      const gate = holdRequest();
      let handling: Promise<void> | undefined;
      const routeImage = async (route: Route) => {
        handling = gate.held.then(() => fulfillImage(route));
        return handling;
      };
      await projector.route(questionImage, routeImage);
      let frame: Awaited<ReturnType<typeof confirmedFrame>>;
      try {
        await Promise.all([projector.waitForRequest(questionImage), next(moderator)]);
        await expect(projector.getByText(imageQuestion, { exact: true })).toBeVisible();
        frame = await confirmedFrame(moderator, 4);
        await expect(stage(moderator, 'image-ready', 'question-image').and(moderator.locator('[data-latency-ms]'))).toHaveCount(0);
        await expect(projector.getByAltText('Obrázek k otázce')).toHaveJSProperty('naturalWidth', 0);
        await setTimeout(injectedDelayMs);
      } finally {
        gate.release();
        await handling;
        await projector.unroute(questionImage, routeImage);
      }
      await expect(projector.getByAltText('Obrázek k otázce')).toHaveJSProperty('naturalWidth', 8);
      const imageReadyMs = await stageMs(moderator, 'image-ready', 'question-image');
      await expect(stage(moderator, 'asset-headers', 'question-image').getByText('Nezjištěno', { exact: true })).toBeVisible();
      expect(imageReadyMs - frame.frameMs).toBeGreaterThanOrEqual(injectedDelayMs);
      return { ...frame, imageReadyMs };
    });

    const reconnectMs = await test.step('Reconnect an isolated projector after the moderator advances while it is offline', async () => {
      const isolated = await isolatedContext.newPage();
      const assertIsolatedNoAnswer = await watchForAnswer(isolated);
      await isolated.goto(projectorUrl);
      await expect(isolated.getByText(imageQuestion, { exact: true })).toBeVisible();
      await expect(isolated.getByAltText('Obrázek k otázce')).toHaveJSProperty('naturalWidth', 8);
      await isolatedContext.setOffline(true);
      await expect(isolated.getByRole('heading', { name: 'Projektor není připojen' })).toBeVisible();
      await expect(isolated.getByText(imageQuestion, { exact: true })).toHaveCount(0);
      await expect(isolated.getByAltText('Obrázek k otázce')).toHaveCount(0);

      for (const position of [3, 2]) {
        await moderator.getByRole('button', { name: '← Předchozí', exact: true }).click();
        await expectPosition(moderator, position);
      }
      await expect(projector.getByText(question, { exact: true })).toBeVisible();
      await expect(isolated.getByText(question, { exact: true })).toHaveCount(0);
      await expect(isolated.getByRole('heading', { name: 'Projektor není připojen' })).toBeVisible();

      const reconnectStarted = performance.now();
      await isolatedContext.setOffline(false);
      await expect(isolated.getByText(question, { exact: true })).toBeVisible();
      const elapsed = Math.round(performance.now() - reconnectStarted);
      await expect(isolated.getByText(imageQuestion, { exact: true })).toHaveCount(0);
      await expect(isolated.locator(`img[src="${questionImage}"]`)).toHaveCount(0);
      await assertIsolatedNoAnswer();
      await assertNoAnswer();
      return elapsed;
    });

    const samples = { injectedDelayMs, baseline, callableDelay, imageDelay, reconnectMs };
    await testInfo.attach('live-latency-samples', { body: JSON.stringify(samples, null, 2), contentType: 'application/json' });
    console.log(`Live latency sample (ms): ${JSON.stringify(samples)}`);

    await endSession(moderator, projector);
  } finally {
    await isolatedContext.close();
    await context.close();
  }
});

test('times moderator audio and projector video after Play', { tag: '@media' }, async ({ browser, baseURL }, testInfo) => {
  const context = await localContext(browser);
  try {
    await context.route(youtubeApi, route => route.fulfill({ contentType: 'application/javascript', body: youtubeMock }));
    const { moderator, projectorUrl } = await startSession(context, baseURL);
    const projector = await context.newPage();
    const assertNoAnswer = await watchForAnswer(projector);
    let projectorApiRequests = 0;
    projector.on('request', request => { if (request.url() === youtubeApi) projectorApiRequests += 1; });
    await projector.goto(projectorUrl);
    await expect(projector.getByText('Čekáme na první slide')).toBeVisible();

    for (let position = 1; position <= 5; position += 1) {
      await next(moderator);
      await expectPosition(moderator, position);
    }
    await expect(projector.getByText('Syntetická audio otázka', { exact: true })).toBeVisible();
    await expect(moderator.locator('[data-synthetic-youtube="erroraudio1"]')).toBeAttached();
    const play = moderator.getByRole('button', { name: 'Play', exact: true });
    await play.click();
    const audioReadyMs = await stageMs(moderator, 'player-ready', 'audio');
    const audioPlayingMs = await stageMs(moderator, 'player-playing', 'audio');
    expect(audioPlayingMs).toBeGreaterThanOrEqual(audioReadyMs);
    await expect(stage(moderator, 'player-playing', 'video')).toHaveCount(0);
    await expect(projector.locator('.vinyl-visual.is-playing')).toBeVisible();
    expect(projectorApiRequests).toBe(0);

    await next(moderator);
    await expect(projector.getByText('Syntetická video otázka', { exact: true })).toBeVisible();
    await expect(projector.locator('.projector-video-player')).toHaveCount(1);
    await expect(projector.locator('.video-presentation')).toHaveCount(0);
    const videoMountedMs = await stageMs(moderator, 'player-mounted', 'video');
    const videoCuedMs = await stageMs(moderator, 'player-cued', 'video');
    expect(videoCuedMs).toBeGreaterThanOrEqual(videoMountedMs);
    expect(projectorApiRequests).toBe(1);
    await play.click();
    await expect(projector.locator('[data-synthetic-youtube="errorvideo1"]')).toBeAttached();
    await expect(projector.locator('.video-presentation')).toBeVisible();
    await expect(projector.locator('.projector-video-player')).toHaveCount(1);
    const videoReadyMs = await stageMs(moderator, 'player-ready', 'video');
    const videoPlayingMs = await stageMs(moderator, 'player-playing', 'video');
    expect(videoPlayingMs).toBeGreaterThanOrEqual(videoReadyMs);
    await expect(stage(moderator, 'player-playing', 'audio')).toHaveCount(0);

    await next(moderator);
    await expect(projector.getByRole('heading', { name: 'Rekapitulace' })).toBeVisible();
    await expect(projector.locator('.projector-video-player')).toHaveCount(0);
    await assertNoAnswer();

    const samples = {
      audio: { readyMs: audioReadyMs, playingMs: audioPlayingMs },
      videoNavigation: { mountedMs: videoMountedMs, cuedMs: videoCuedMs },
      videoPlay: { readyMs: videoReadyMs, playingMs: videoPlayingMs },
    };
    await testInfo.attach('live-media-latency-samples', { body: JSON.stringify(samples, null, 2), contentType: 'application/json' });
    console.log(`Live media latency sample (ms): ${JSON.stringify(samples)}`);
    await endSession(moderator, projector);
  } finally {
    await context.close();
  }
});
