import { expect, test, type Page } from '@playwright/test';

const iframeApiMock = `
(() => {
  const attempts = new Map();
  const instances = [];
  class Player {
    constructor(element, options) {
      this.element = element;
      this.options = options;
      this.videoId = options.videoId;
      this.destroyed = false;
      instances.push(this);
      queueMicrotask(() => options.events.onReady());
    }
    cueVideoById(options) { this.videoId = options.videoId; }
    addEventListener(event, listener) { this.options.events[event] = window[listener]; }
    removeEventListener(event) { this.options.events[event] = () => {}; }
    playVideo() { this.loadVideoById({ videoId: this.videoId }); }
    loadVideoById(options) {
      this.videoId = options.videoId;
      const attempt = (attempts.get(this.videoId) || 0) + 1;
      attempts.set(this.videoId, attempt);
      queueMicrotask(() => {
        if (this.videoId === 'erroraudio1' && attempt > 1) {
          this.options.events.onStateChange({ data: 1 });
        } else {
          this.options.events.onError({ data: 100 });
        }
      });
    }
    pauseVideo() {}
    seekTo() {}
    destroy() { this.destroyed = true; }
    emitEnded() { this.options.events.onStateChange({ data: 0 }); }
  }
  window.__YT_MOCK__ = { attempts, instances };
  window.YT = { Player, PlayerState: { ENDED: 0, PLAYING: 1 } };
  window.onYouTubeIframeAPIReady?.();
})();
`;

async function installYouTubeMock(page: Page): Promise<void> {
  await page.route('https://www.youtube.com/iframe_api', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: iframeApiMock });
  });
}

async function nextSlide(moderator: Page, position: number): Promise<void> {
  await moderator.getByRole('button', { name: 'Další →' }).click();
  await expect(moderator.locator('.focused-live-shell')).toHaveAttribute('data-current-position', String(position));
}

test('audio error/retry, stale callback, video fallback and projector refresh', async ({ browser, baseURL }) => {
  const context = await browser.newContext();
  const moderator = await context.newPage();
  await installYouTubeMock(moderator);
  await moderator.goto(`${baseURL}/admin/login`);
  await moderator.getByLabel('E-mail').fill('admin@example.test');
  await moderator.getByLabel('Heslo').fill('LocalQuiz123!');
  await moderator.getByRole('button', { name: 'Přihlásit se' }).click();
  await expect(moderator).toHaveURL(/\/admin$/u);

  await moderator.goto(`${baseURL}/admin/quizzes/projector-lifecycle-e2e`);
  await moderator.getByRole('link', { name: 'Spustit kvíz' }).click();
  await moderator.getByRole('button', { name: 'Spustit i tak' }).click();
  await moderator.getByRole('button', { name: 'Potvrdit a spustit' }).click();
  await expect(moderator).toHaveURL(/\/admin\/live\/[^/]+$/u);
  const sessionId = new URL(moderator.url()).pathname.split('/').at(-1);
  expect(sessionId).toBeTruthy();

  const projector = await context.newPage();
  await installYouTubeMock(projector);
  await projector.goto(`${baseURL}/projector/${sessionId}`);
  await expect(projector.getByText('Čekáme na první slide')).toBeVisible();

  for (let position = 1; position <= 5; position += 1) await nextSlide(moderator, position);
  await expect(projector.getByText('Syntetická audio otázka', { exact: true })).toBeVisible();

  await moderator.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(moderator.getByText('Video nelze přehrát z YouTube')).toBeVisible();
  await expect(projector.locator('.vinyl-visual.is-playing')).toHaveCount(0);

  await moderator.getByRole('button', { name: 'Pustit znovu', exact: true }).click();
  await expect(projector.locator('.vinyl-visual.is-playing')).toBeVisible();
  await moderator.evaluate(() => {
    const mock = (window as unknown as {
      __YT_MOCK__: { instances: Array<{ videoId: string; emitEnded(): void }> };
    }).__YT_MOCK__;
    const audioPlayers = mock.instances.filter((instance) => instance.videoId === 'erroraudio1');
    audioPlayers.at(-2)?.emitEnded();
  });
  await expect(projector.locator('.vinyl-visual.is-playing')).toBeVisible();

  await nextSlide(moderator, 6);
  await expect(projector.getByText('Syntetická video otázka', { exact: true })).toBeVisible();
  await moderator.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(moderator.getByText('Médium se na projektoru nepřehrálo')).toBeVisible();
  await expect(projector.getByText('Syntetická video otázka', { exact: true })).toBeVisible();
  await expect(projector.locator('.video-presentation')).toHaveCount(0);
  await expect(projector.locator('.projector-media-error')).toHaveCount(0);

  await projector.reload();
  await expect(projector.getByText('Syntetická video otázka', { exact: true })).toBeVisible();
  await expect(projector.locator('.video-presentation')).toHaveCount(0);

  await moderator.getByRole('button', { name: 'Ukončit kvíz' }).click();
  await expect(projector.getByText('Kvíz skončil')).toBeVisible();
  await context.close();
});
