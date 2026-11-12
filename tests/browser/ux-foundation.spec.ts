import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';

const iframeApiMock = `
(() => {
  class Player {
    constructor(_element, options) { this.options = options; queueMicrotask(() => options.events.onReady()); }
    cueVideoById() {}
    addEventListener(event, listener) { this.options.events[event] = window[listener]; }
    removeEventListener(event) { this.options.events[event] = () => {}; }
    playVideo() {}
    loadVideoById() {}
    pauseVideo() {}
    seekTo() {}
    getCurrentTime() { return 6.5; }
    destroy() {}
  }
  window.YT = { Player, PlayerState: { ENDED: 0, PLAYING: 1 } };
  window.onYouTubeIframeAPIReady?.();
})();
`;

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await testInfo.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
}

async function expectAboveFold(locator: Locator, viewportHeight: number): Promise<void> {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewportHeight);
}

test('admin and focused moderator shell remain usable at desktop, tablet, and mobile sizes', async ({ browser, baseURL }, testInfo) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.route('https://www.youtube.com/iframe_api', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: iframeApiMock });
  });
  const moderator = await context.newPage();
  await moderator.goto(`${baseURL}/admin/login`);
  await moderator.getByLabel('E-mail').fill('admin@example.test');
  await moderator.getByLabel('Heslo').fill('LocalQuiz123!');
  await moderator.getByRole('button', { name: 'Přihlásit se' }).click();
  await expect(moderator).toHaveURL(/\/admin$/u);

  const adminNav = moderator.getByRole('navigation', { name: 'Administrace' });
  await expect(adminNav.getByRole('link')).toHaveText(['Kvízy', 'Akce', 'Nastavení']);
  await expect(moderator.getByRole('heading', { name: 'Přehled' })).toBeVisible();
  await attachScreenshot(moderator, testInfo, 'admin-overview-1280x720');

  await adminNav.getByRole('link', { name: 'Kvízy' }).click();
  await expect(moderator.getByRole('heading', { name: 'Kvízy' })).toBeVisible();
  await moderator.locator('a.quiz-title-link[href="/admin/quizzes/projector-lifecycle-e2e"]').click();
  await expect(moderator.getByRole('link', { name: 'Spustit kvíz' })).toBeVisible();
  await moderator.getByRole('link', { name: 'Spustit kvíz' }).click();
  await moderator.getByRole('button', { name: 'Spustit i tak' }).click();
  await moderator.getByRole('button', { name: 'Potvrdit a spustit' }).click();
  await expect(moderator).toHaveURL(/\/admin\/live\/[^/]+$/u);

  await moderator.getByRole('button', { name: 'Další →' }).click();
  await moderator.getByRole('button', { name: 'Další →' }).click();
  await expect(moderator.locator('.focused-live-shell')).toHaveAttribute('data-current-position', '2');
  await expect(moderator.locator('[data-private-answer="true"]')).toContainText('Syntetická odpověď');
  await expectAboveFold(moderator.locator('[data-private-answer="true"]'), 720);
  await expectAboveFold(moderator.locator('.primary-live-controls'), 720);
  await expect(moderator.getByText('Verze stavu')).not.toBeVisible();
  await attachScreenshot(moderator, testInfo, 'moderator-question-1280x720');

  const projectorPromise = context.waitForEvent('page');
  await moderator.getByRole('button', { name: 'Otevřít projektor' }).click();
  const projector = await projectorPromise;
  await projector.waitForLoadState('domcontentloaded');
  await expect(projector).toHaveURL(/\/projector\/[^/]+$/u);
  await expect(moderator.getByText('Okno bylo otevřeno').first()).toBeVisible();

  await moderator.setViewportSize({ width: 1024, height: 768 });
  await expectAboveFold(moderator.locator('[data-private-answer="true"]'), 768);
  await expectAboveFold(moderator.locator('.primary-live-controls'), 768);
  await attachScreenshot(moderator, testInfo, 'moderator-question-1024x768');

  await moderator.setViewportSize({ width: 390, height: 844 });
  const infoBox = await moderator.locator('.moderator-info-panel').boundingBox();
  const controlsBox = await moderator.locator('.live-actions').boundingBox();
  const previewBox = await moderator.locator('.live-preview-panel').boundingBox();
  expect(infoBox && controlsBox && previewBox).toBeTruthy();
  expect(infoBox!.y).toBeLessThan(controlsBox!.y);
  expect(controlsBox!.y).toBeLessThan(previewBox!.y);
  const targetSizes = await moderator.locator('.live-actions button').evaluateAll((buttons) => buttons.map((button) => {
    const rect = button.getBoundingClientRect();
    return { width: rect.width, height: rect.height, name: button.getAttribute('aria-label') || button.textContent?.trim() };
  }));
  expect(targetSizes.length).toBeGreaterThan(3);
  expect(targetSizes.every(({ width, height, name }) => width >= 44 && height >= 44 && Boolean(name))).toBe(true);
  await expect(moderator.locator('.live-preview-panel')).toHaveJSProperty('open', true);
  await attachScreenshot(moderator, testInfo, 'moderator-question-390x844');

  for (let position = 3; position <= 5; position += 1) {
    await moderator.getByRole('button', { name: 'Další →' }).click();
    await expect(moderator.locator('.focused-live-shell')).toHaveAttribute('data-current-position', String(position));
  }
  await expect(moderator.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await expect(moderator.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  await expect(moderator.getByRole('button', { name: 'Pustit znovu', exact: true })).toBeVisible();
  await attachScreenshot(moderator, testInfo, 'moderator-audio-390x844');

  await moderator.getByRole('button', { name: 'Další →' }).click();
  await expect(moderator.locator('.focused-live-shell')).toHaveAttribute('data-current-position', '6');
  await expect(moderator.getByRole('button', { name: 'Play', exact: true })).toBeVisible();

  await moderator.getByRole('button', { name: 'Další →' }).click();
  await expect(moderator.locator('.focused-live-shell')).toHaveAttribute('data-current-position', '7');
  await expect(moderator.locator('.live-progress strong')).toHaveText('Rekapitulace');
  await expect(moderator.locator('.recap-question-buttons button')).toHaveText(['1', '2', '3', '4']);
  await expect(moderator.getByRole('button', { name: 'Zobrazit odpověď na otázku 1' })).toBeVisible();
  await attachScreenshot(moderator, testInfo, 'moderator-recap-390x844');

  await projector.close();
  await context.close();
});
