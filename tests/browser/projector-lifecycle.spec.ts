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

test('live diagnostics for connection, images, audio and video preserve playback recovery', async ({ browser, baseURL }) => {
  const context = await browser.newContext();
  await context.route('https://example.test/**', route => route.fulfill({
    contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
  }));
  const moderator = await context.newPage();
  await installYouTubeMock(moderator);
  await moderator.goto(`${baseURL}/admin/login`);
  await moderator.getByLabel('E-mail').fill('admin@example.test');
  await moderator.getByLabel('Heslo').fill('LocalQuiz123!');
  await moderator.getByRole('button', { name: 'Přihlásit se' }).click();
  await expect(moderator).toHaveURL(/\/admin$/u);

  await moderator.goto(`${baseURL}/admin/quizzes/projector-lifecycle-e2e`);
  await moderator.getByRole('button', { name: 'Spustit kvíz' }).click();
  await expect(moderator).toHaveURL(/\/admin\/live\/[^/]+$/u);
  const sessionId = new URL(moderator.url()).pathname.split('/').at(-1);
  expect(sessionId).toBeTruthy();
  const diagnostics = moderator.locator('.live-diagnostics');
  await diagnostics.locator('summary').click();
  const checkConnection = diagnostics.getByRole('button', { name: 'Otestovat připojení' });
  await checkConnection.click();
  await expect(diagnostics.getByText(/Web JustKvíz odpověděl za \d+ ms/)).toBeVisible();

  const probePath = '**/justkviz-connection-check.txt';
  await moderator.route(probePath, async (route) => {
    await new Promise(resolve => setTimeout(resolve, 1650));
    await route.fulfill({ status: 200, contentType: 'text/plain', body: 'justkviz-connection-check-v1\n' });
  });
  await checkConnection.click();
  await expect(diagnostics.getByText(/Pomalá odezva webu JustKvíz/)).toBeVisible();
  await moderator.unroute(probePath);
  await moderator.route(probePath, route => route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Přihlášení do Wi-Fi</h1>' }));
  await checkConnection.click();
  await expect(diagnostics.getByText(/Přišla neočekávaná odpověď/)).toBeVisible();
  await moderator.unroute(probePath);
  await moderator.route(probePath, async (route) => {
    await new Promise(resolve => setTimeout(resolve, 5600));
    await route.abort();
  });
  await checkConnection.click();
  await expect(diagnostics.getByText(/Web JustKvíz neodpověděl do 5 sekund/)).toBeVisible();
  await moderator.unroute(probePath);
  await diagnostics.locator('summary').click();
  await expect(diagnostics).not.toHaveAttribute('open', '');

  const projector = await context.newPage();
  await installYouTubeMock(projector);
  const questionImage = 'https://example.test/image.jpg';
  let failImage = () => {};
  const imageHold = new Promise<void>(resolve => { failImage = resolve; });
  await projector.route(questionImage, async (route) => {
    await imageHold;
    await route.abort('failed');
  }, { times: 1 });
  await projector.goto(`${baseURL}/projector/${sessionId}`);
  await expect(projector.getByText('Čekáme na první slide')).toBeVisible();

  for (let position = 1; position <= 4; position += 1) await nextSlide(moderator, position);
  const alerts = moderator.locator('.live-media-alert');
  const imageAlert = alerts.filter({ hasText: 'Obrázek otázky · Projektor' });
  try {
    await expect(imageAlert).toContainText('Načítání trvá přes 6 sekund');
    await expect(imageAlert).toBeVisible();
    await expect(imageAlert).toContainText('může být slabé připojení nebo pomalý zdroj');
  } finally { failImage(); }
  await expect(imageAlert).toContainText('Prohlížeč neposkytl přesný důvod');
  await expect(imageAlert).toBeVisible();
  await expect(imageAlert).not.toContainText('slabé připojení');
  await expect(projector.getByText('Syntetická obrázková otázka', { exact: true })).toBeVisible();
  await expect(projector.locator('.live-diagnostics')).toHaveCount(0);
  await expect(projector.locator('.live-media-alert')).toHaveCount(0);
  await expect(alerts.getByText('example.test', { exact: false })).toHaveCount(0);
  await projector.getByRole('button', { name: 'Zkusit načíst znovu' }).click();
  await expect.poll(() => projector.getByAltText('Obrázek k otázce').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(imageAlert).toHaveCount(0);

  await nextSlide(moderator, 5);
  await expect(projector.getByText('Syntetická audio otázka', { exact: true })).toBeVisible();

  await moderator.getByRole('button', { name: 'Play', exact: true }).click();
  const audioAlert = alerts.filter({ hasText: 'Audio · Moderátor' });
  await expect(audioAlert).toContainText('Zdroj není dostupný');
  await expect(audioAlert).toBeVisible();
  await expect(projector.locator('.vinyl-visual.is-playing')).toHaveCount(0);

  await moderator.getByRole('button', { name: 'Pustit znovu', exact: true }).click();
  await expect(projector.locator('.vinyl-visual.is-playing')).toBeVisible();
  await expect(alerts).toHaveCount(0);
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
  const videoAlert = alerts.filter({ hasText: 'Video · Projektor' });
  await expect(videoAlert).toContainText('Zdroj není dostupný');
  await expect(videoAlert).toBeVisible();
  await expect(projector.getByText('Syntetická video otázka', { exact: true })).toBeVisible();
  await expect(projector.locator('.video-presentation')).toHaveCount(0);
  await expect(projector.getByText(/Médium se nepodařilo přehrát/)).toBeVisible();

  await projector.reload();
  await expect(projector.getByText('Syntetická video otázka', { exact: true })).toBeVisible();
  await expect(projector.locator('.video-presentation')).toHaveCount(0);

  await moderator.getByText('Další možnosti', { exact: true }).click();
  await moderator.getByRole('button', { name: 'Ukončit kvíz' }).click();
  await expect(projector.getByText('Kvíz skončil')).toBeVisible();
  await context.close();
});
