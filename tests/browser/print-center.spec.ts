import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { printCenterFixture, printModeratorIdentity } from '../e2e/print-center-fixture.mjs';

async function localOnly(context: import('@playwright/test').BrowserContext) { await context.route('**/*', route => { const url = new URL(route.request().url()); return ['http:', 'https:'].includes(url.protocol) && ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort(); }); }
test.beforeEach(async ({ context }) => { await localOnly(context); });

async function login(page: Page, identity: { email: string; password: string }) {
  await page.goto('/admin/login');
  await page.getByLabel('E-mail', { exact: true }).fill(identity.email);
  await page.getByLabel('Heslo', { exact: true }).fill(identity.password);
  await page.getByRole('button', { name: 'Přihlásit se', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Administrace', exact: true })).toBeVisible();
}
async function ready(page: Page) {
  const frame = page.getByTitle('Náhled PDF', { exact: true });
  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute('src', /^blob:/u);
  await expect(frame).toHaveAttribute('src', /#navpanes=0&view=Fit$/u);
  await expect(page.locator('.print-actions a')).toHaveAttribute('href', (await frame.getAttribute('src'))?.split('#')[0] ?? 'missing');
}
async function downloaded(page: Page, info: TestInfo, name: string) {
  await ready(page);
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('.print-actions a').click()]);
  const directory = process.env.PRINT_REVIEW_OUTPUT_DIR ?? info.outputDir;
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, name);
  await download.saveAs(file);
  expect(await download.failure()).toBeNull();
  const bytes = await readFile(file);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.getPageCount()).toBeGreaterThan(0);
  for (const page of pdf.getPages()) {
    expect(Math.min(page.getWidth(), page.getHeight())).toBeCloseTo(595.28, 1);
    expect(Math.max(page.getWidth(), page.getHeight())).toBeCloseTo(841.89, 1);
  }
  return pdf;
}
test('three materials use immediate real PDF previews, accepted teams and the locked quiz', async ({ page }, info) => {
  const fixture = await printCenterFixture(2, 8);
  try {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await login(page, fixture);
    await page.goto('/admin/events/' + fixture.eventId);
    await page.getByRole('link', { name: 'Tisk a materiály', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Tiskové centrum', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Hrací arch pro hráče/u })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.print-advanced')).not.toHaveAttribute('open');
    await expect(page.getByRole('button', { name: 'Vytvořit náhled', exact: true })).toHaveCount(0);
    await expect(page.getByText('Přijaté týmy: 2', { exact: true })).toBeVisible();
    const sheets = await downloaded(page, info, 'odpovedni-archy-2-tymy.pdf');
    expect(sheets.getPageCount()).toBe(9);
    await expect(page.getByText(/Všechny týmy a právě jeden univerzální rezervní arch/u)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Vytisknout', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: /^Bodovací tabulka/u }).click();
    await ready(page);
    await page.getByRole('button', { name: /^Klíč správných odpovědí/u }).click();
    await expect(page.locator('.print-private-note')).toContainText('NEDÁVAT HRÁČŮM');
    await page.getByRole('button', { name: 'Otevřít dokument se správnými odpověďmi', exact: true }).click();
    await downloaded(page, info, 'klic-spravnych-odpovedi.pdf');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  } finally { await fixture.dispose(); }
});

test('zero accepted teams offer an immediate blank sheet and an honest empty score table', async ({ page }, info) => {
  const fixture = await printCenterFixture(0, 3);
  try {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await login(page, fixture);
    await page.goto('/admin/events/' + fixture.eventId + '/print');
    await expect(page.getByRole('heading', { name: 'Akce zatím nemá přijaté týmy', exact: true })).toBeVisible();
    expect((await downloaded(page, info, 'prazdny-odpovedni-arch.pdf')).getPageCount()).toBe(3);
    await page.getByRole('button', { name: /^Bodovací tabulka/u }).click();
    await expect(page.locator('.print-actions a')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTitle('Náhled PDF', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Zobrazit prázdný arch', exact: true })).toBeVisible();
  } finally { await fixture.dispose(); }
});

test('thirty accepted teams download fully and advanced choices remain transient', async ({ page }, info) => {
  const fixture = await printCenterFixture(30, 3);
  try {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await login(page, fixture);
    await page.goto('/admin/events/' + fixture.eventId + '/print');
    expect((await downloaded(page, info, 'odpovedni-archy-30-tymu.pdf')).getPageCount()).toBe(46);
    await expect(page.getByText(/Všechny týmy a právě jeden univerzální rezervní arch/u)).toBeVisible();
    const sourceBefore = await fixture.snapshotData();
    await page.locator('.print-advanced > summary').click();
    await page.getByRole('combobox', { name: 'Šablona', exact: true }).selectOption('compact');
    await page.getByRole('combobox', { name: 'Barevnost', exact: true }).selectOption('grayscale');
    await ready(page);
    expect(await fixture.snapshotData()).toEqual(sourceBefore);
    await page.getByRole('button', { name: /^Bodovací tabulka/u }).click();
    await downloaded(page, info, 'bodovaci-tabulka-30-tymu.pdf');
  } finally { await fixture.dispose(); }
});

test('answer keys stay disabled for moderators and an unprepared event has no PDF', async ({ page }) => {
  const fixture = await printCenterFixture(2, 3), moderator = await printModeratorIdentity();
  try {
    await login(page, moderator);
    await page.goto('/admin/events/' + fixture.eventId + '/print');
    await expect(page.getByRole('button', { name: /^Klíč správných odpovědí/u })).toBeDisabled();
    await ready(page);
    await page.getByRole('button', { name: 'Odhlásit se', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/login$/u);
    await login(page, fixture);
    await fixture.unprepare();
    await page.goto('/admin/events/' + fixture.eventId + '/print');
    await expect(page.getByRole('heading', { name: 'Nejdříve připravte kvíz pro tuto akci', exact: true })).toBeVisible();
    await expect(page.getByTitle('Náhled PDF', { exact: true })).toHaveCount(0);
  } finally { await moderator.dispose(); await fixture.dispose(); }
});
