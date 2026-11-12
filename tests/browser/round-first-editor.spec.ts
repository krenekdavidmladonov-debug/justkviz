import { expect, test, type Page, type TestInfo } from '@playwright/test';

const iframeApiMock = `
(() => {
  class Player {
    constructor(_element, options) { this.options = options; this.time = 6.5; queueMicrotask(() => options.events.onReady()); }
    cueVideoById() {}
    addEventListener(event, listener) { this.options.events[event] = window[listener]; }
    removeEventListener(event) { this.options.events[event] = () => {}; }
    playVideo() { queueMicrotask(() => this.options.events.onStateChange({ data: 1 })); }
    loadVideoById() { queueMicrotask(() => this.options.events.onStateChange({ data: 1 })); }
    pauseVideo() {}
    seekTo(seconds) { this.time = seconds; }
    getCurrentTime() { return this.time; }
    destroy() {}
  }
  window.YT = { Player, PlayerState: { ENDED: 0, PLAYING: 1 } };
  window.onYouTubeIframeAPIReady?.();
})();
`;

async function login(page: Page, baseURL: string | undefined): Promise<void> {
  await page.goto(`${baseURL}/admin/login`);
  await page.getByLabel('E-mail').fill('admin@example.test');
  await page.getByLabel('Heslo').fill('LocalQuiz123!');
  await page.getByRole('button', { name: 'Přihlásit se' }).click();
  await expect(page).toHaveURL(/\/admin$/u);
}

async function discardBySelectingRoot(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Zahodit změny…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Máte neuložené změny.' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Pokračovat bez uložení' }).click();
  await page.getByRole('button', { name: 'Základní údaje' }).click();
  await expect(page.getByRole('heading', { name: 'Základní údaje' })).toBeVisible();
}

test('round-first editor supports semantic editing and responsive panel navigation', async ({ browser, baseURL }, testInfo: TestInfo) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.route('https://www.youtube.com/iframe_api', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: iframeApiMock });
  });
  const page = await context.newPage();
  await login(page, baseURL);
  await page.goto(`${baseURL}/admin/quizzes/round-first-editor-browser-e2e`);
  await page.getByRole('link', { name: 'Otevřít editor' }).click();
  await expect(page).toHaveURL(/\/admin\/quizzes\/round-first-editor-browser-e2e\/edit$/u);

  await expect(page.locator('.round-first-editor')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Základní údaje' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Struktura kvízu' })).toContainText('Úvodní obrazovka');
  await expect(page.getByRole('complementary', { name: 'Struktura kvízu' })).toContainText('Harmonogram');
  await expect(page.getByRole('complementary', { name: 'Struktura kvízu' })).toContainText('Pravidla');
  const initialQuestionCount = await page.locator('.outline-question').count();
  expect(initialQuestionCount).toBeGreaterThanOrEqual(5);
  await expect(page.locator('.outline-question').first()).not.toContainText(/slide|position|roundheader/iu);
  await testInfo.attach('round-editor-1280x720', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

  const choice = page.locator('.outline-question').filter({ hasText: 'Výběr z možností' }).first();
  await choice.click();
  await expect(page.getByRole('heading', { name: 'Výběr z možností' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Možnost A', exact: true }).fill('Upravená syntetická možnost');
  await expect(page.getByText('Neuložené změny')).toBeVisible();
  await discardBySelectingRoot(page);

  const image = page.locator('.outline-question').filter({ hasText: 'Obrázek' }).first();
  await image.click();
  await page.getByLabel('Otázka *').fill('Lokální obrázkové zadání');
  await expect(page.locator('.round-editor-preview')).toContainText('Lokální obrázkové zadání');
  await discardBySelectingRoot(page);

  const audio = page.locator('.outline-question').filter({ hasText: 'Audio' }).first();
  await audio.click();
  await expect(page.getByLabel('Začátek ukázky *')).toBeVisible();
  await expect(page.getByLabel('Konec ukázky *')).toBeVisible();
  await page.getByLabel('Začátek ukázky *').fill('00:00');
  await page.getByLabel('Konec ukázky *').fill('00:12.5');
  await expect(page.getByText('Délka ukázky:').locator('..')).toContainText('0:12.5');
  await page.getByRole('button', { name: 'Načíst' }).click();
  await page.getByRole('button', { name: 'Použít aktuální čas jako začátek' }).click();
  await expect(page.getByLabel('Začátek ukázky *')).toHaveValue('0:06.5');
  await page.getByLabel('Konec ukázky *').fill('neplatný čas');
  await page.getByRole('button', { name: 'Uložit vše', exact: true }).click();
  await expect(page.getByText('Před uložením opravte označené údaje.')).toBeVisible();
  await discardBySelectingRoot(page);

  const video = page.locator('.outline-question').filter({ hasText: 'Video' }).first();
  await video.click();
  await page.getByLabel('Otázka *').fill('Lokální video zadání');
  await expect(page.getByRole('button', { name: 'Přehrát ukázku' })).toBeVisible();
  await discardBySelectingRoot(page);

  const pl = page.locator('.outline-question').filter({ hasText: 'Pravda / Lež' }).first();
  await pl.click();
  await expect(page.getByRole('heading', { name: 'Legacy: Pravda / Lež' })).toBeVisible();
  await expect(page.getByText('Starší typ Pravda / Lež')).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Pravda' })).toBeVisible();

  await page.getByRole('button', { name: '+ Přidat otázku' }).click();
  await page.getByRole('dialog', { name: /Typ otázky/u }).getByRole('button', { name: 'Volná odpověď' }).click();
  await page.getByLabel('Otázka *').fill('Nová syntetická volná otázka');
  await page.getByLabel('Správná odpověď *').fill('Nová syntetická odpověď');
  await expect(page.locator('.round-editor-preview')).toContainText('Nová syntetická volná otázka');
  await expect(page.locator('.outline-question.selected')).toContainText('Nová syntetická volná otázka');
  await expect(page.locator('.outline-question')).toHaveCount(initialQuestionCount + 1);
  await page.getByRole('button', { name: 'Uložit vše', exact: true }).click();
  await expect(page.getByText('Uloženo', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Volná odpověď' })).toBeVisible();

  await page.getByRole('button', { name: 'Duplikovat', exact: true }).click();
  await expect(page.locator('.outline-question')).toHaveCount(initialQuestionCount + 2);
  await page.getByRole('button', { name: 'Posunout nahoru' }).click();
  await expect(page.getByText('Uloženo', { exact: true })).toBeVisible();

  await page.getByLabel('Otázka *').fill('Rozepsaná změna před navigací');
  await expect(page.getByText('Neuložené změny', { exact: true })).toBeVisible();
  await page.evaluate(() => history.back());
  const backDialog = page.getByRole('dialog', { name: 'Máte neuložené změny.' });
  await expect(backDialog).toBeVisible();
  await expect(backDialog.getByRole('button', { name: 'Zrušit' })).toBeFocused();
  await backDialog.getByRole('button', { name: 'Zrušit' }).click();
  await expect(page).toHaveURL(/\/edit$/u);
  await discardBySelectingRoot(page);

  await page.getByRole('button', { name: 'Rekapitulace' }).click();
  await expect(page.getByRole('main').getByRole('heading', { name: 'Rekapitulace' })).toBeVisible();
  await expect(page.getByText('Původní nastavení zůstává zachované.')).toBeVisible();

  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.getByRole('navigation', { name: 'Část editoru' })).toBeVisible();
  await page.getByRole('button', { name: 'Náhled', exact: true }).click();
  await expect(page.locator('.round-editor-preview')).toBeVisible();
  await testInfo.attach('round-editor-1024x768', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Struktura', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Struktura kvízu' })).toBeVisible();
  await page.getByRole('button', { name: 'Obsah', exact: true }).click();
  await expect(page.locator('.round-editor-content')).toBeVisible();
  await page.getByRole('button', { name: 'Náhled', exact: true }).click();
  await expect(page.locator('.round-editor-preview')).toBeVisible();
  const mobileTargets = await page.locator('.editor-panel-tabs button').evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().height));
  expect(mobileTargets.every((height) => height >= 44)).toBe(true);
  await testInfo.attach('round-editor-390x844', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

  await context.close();
});
