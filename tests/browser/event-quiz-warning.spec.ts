import { expect, test } from '@playwright/test';
for (const width of [1280, 390]) {
  test(`upcoming quiz warning and exclusions at ${width}px`, async ({ page, context }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    await page.clock.install();
    await page.clock.setFixedTime(new Date('2030-03-30T12:00:00Z'));
    await page.setViewportSize({ width, height:900 });
    await page.goto('/admin/events');
    const card = (title:string) => page.locator('.event-card').filter({ has:page.getByRole('heading', { name:title, exact:true }) });
    for (const title of ['Brzy bez kvízu', 'Přesně za sedm dní']) await expect(card(title).getByText('Chybí kvíz', { exact:true })).toBeVisible();
    for (const title of ['Později bez kvízu', 'Minulý termín', 'Přiřazený kvíz']) await expect(card(title).locator('.event-quiz-warning')).toHaveCount(0);
    await expect(card('Brzy bez kvízu').getByRole('link')).toHaveAttribute('href', '/admin/events/soon');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path:`.local-data/event-quiz-warning/overview-${width}.png`, fullPage:true });
    await page.getByRole('button', { name:'Dokončené (1)', exact:true }).click();
    await expect(card('Dokončená akce')).toBeVisible();
    await expect(page.locator('.event-quiz-warning')).toHaveCount(0);
    await page.getByRole('button', { name:'Zrušené (1)', exact:true }).click();
    await expect(card('Zrušená akce')).toBeVisible();
    await expect(page.locator('.event-quiz-warning')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
