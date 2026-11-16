import { expect, test } from '@playwright/test';
import jsQR from 'jsqr';

async function localOnly(context: import('@playwright/test').BrowserContext) { await context.route('**/*', route => { const url = new URL(route.request().url()); return ['http:', 'https:'].includes(url.protocol) && ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort(); }); }
test.beforeEach(async ({ context }) => { await localOnly(context); });

for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
  test(`manual teams, retry, edit/cancel, public sharing and decoded PNG/SVG at ${viewport.width}`, async ({ page, context, baseURL }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize(viewport);
    await page.goto('/admin/login');
    await page.getByLabel('E-mail').fill('admin@example.test');
    await page.getByLabel('Heslo').fill('LocalQuiz123!');
    await page.getByRole('button', { name: 'Přihlásit se' }).click();
    await expect(page).toHaveURL(/\/admin$/u);
    await page.goto('/admin/events/new');
    await page.getByLabel('Název akce').fill(`Team tools QA ${viewport.width}`);
    await page.getByLabel('Datum a čas').fill('2031-11-20T19:00');
    await page.getByLabel('Místo', { exact: true }).fill('Synthetic venue');
    await page.getByLabel('Veřejné upřesnění místa').fill('Synthetic location');
    await page.getByRole('button', { name: 'Vytvořit akci' }).click();
    await expect(page).not.toHaveURL(/\/admin\/events\/new$/u);
    await expect(page).toHaveURL(/\/admin\/events\/[^/]+$/u);
    const eventId = page.url().split('/').at(-1)!;
    const detailUrl = page.url();
    await expect(page.getByText('Akce nemá zveřejněné přihlášení.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Zobrazit QR' })).toHaveCount(0);
    await page.getByRole('button', { name: '+ Přidat tým', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Název týmu')).toBeFocused();
    await dialog.getByLabel('Název týmu').fill('Ruční QA tým');
    // Simulate a lost server response: the first request commits, the retry must not duplicate.
    let dropped = false;
    await page.route('**/adminAddEventTeam', async route => {
      if (!dropped) { dropped = true; await route.fetch(); await route.abort('failed'); } else await route.continue();
    });
    await dialog.getByRole('button', { name: 'Přidat tým', exact: true }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(dialog.getByLabel('Název týmu')).toHaveValue('Ruční QA tým');
    await dialog.locator('form').evaluate(form => { (form as HTMLFormElement).requestSubmit(); (form as HTMLFormElement).requestSubmit(); });
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('1 / 20 týmů', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Spravovat týmy a registrace' }).click();
    let row = page.getByRole('row').filter({ hasText: 'Ruční QA tým' });
    await expect(row).toHaveCount(1); await expect(row).toContainText('Neuveden'); await expect(row).toContainText('Přidáno pořadatelem');
    await row.getByRole('button', { name: 'Upravit tým' }).click();
    await dialog.getByLabel('Název týmu').fill('Opravený QA tým');
    await dialog.getByLabel('Počet členů').fill('3');
    await dialog.getByRole('button', { name: 'Uložit tým' }).click();
    row = page.getByRole('row').filter({ hasText: 'Opravený QA tým' });
    await expect(row).toHaveClass('team-selected'); await expect(page.getByText('1 / 20 týmů', { exact: true })).toBeVisible(); await expect(row.getByRole('cell').nth(1)).toHaveText('3');
    await page.getByLabel('Otevření').fill('2020-01-01T00:00');
    await page.getByLabel('Uzavření').fill('2030-01-01T00:00');
    await page.getByRole('button', { name: 'Uložit nastavení' }).click();
    await expect(page.getByText('Nastavení registrací bylo uloženo.')).toBeVisible();
    await page.goto(detailUrl);
    await page.getByRole('button', { name: 'Zveřejnit a otevřít registrace', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Zveřejnit a otevřít registrace', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const url = `${baseURL}/events/${eventId}`;
    await expect(page.getByLabel('Veřejný odkaz')).toHaveValue(url);
    await page.getByRole('button', { name: 'Kopírovat odkaz' }).click();
    await expect(page.getByText('Odkaz zkopírován')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
    await page.getByRole('button', { name: 'Zobrazit QR' }).click();
    await expect(dialog.getByRole('img')).toBeVisible();
    for (const kind of ['PNG', 'SVG']) {
      const link = dialog.getByRole('link', { name: `Stáhnout ${kind}` });
      const pixels = await link.evaluate(async element => {
        const image = new Image(); image.src = (element as HTMLAnchorElement).href; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 512;
        const ctx = canvas.getContext('2d')!; ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 512, 512); ctx.drawImage(image, 0, 0, 512, 512);
        return Array.from(ctx.getImageData(0, 0, 512, 512).data);
      });
      expect(jsQR(new Uint8ClampedArray(pixels), 512, 512)?.data).toBe(url);
      const download = page.waitForEvent('download'); await link.click();
      expect((await download).suggestedFilename()).toMatch(new RegExp(`^registrace-[A-Za-z0-9_-]+\\.${kind.toLowerCase()}$`, 'u'));
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.keyboard.press('Escape');
    await expect(page.getByText('Přihlášky jsou otevřené.')).toBeVisible();
    const publicContext = await context.browser()!.newContext();
    await localOnly(publicContext);
    const publicPage = await publicContext.newPage(); await publicPage.goto(url);
    await expect(publicPage.getByRole('heading', { name: 'Přihlásit tým', exact: true })).toBeVisible();
    await expect(publicPage.getByLabel('E-mail')).toHaveAttribute('required', ''); await publicContext.close();
    await page.goto(`${detailUrl}/registrations`);
    row = page.getByRole('row').filter({ hasText: 'Opravený QA tým' });
    page.once('dialog', d => d.accept()); await row.getByRole('button', { name: 'Zrušit', exact: true }).click();
    await expect(row).toContainText('Zrušený');
    await expect(page.getByText('0 / 20 týmů', { exact: true })).toBeVisible();
    await expect(page.locator('.registration-table tbody tr').filter({ hasText: 'Přijatý' })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
