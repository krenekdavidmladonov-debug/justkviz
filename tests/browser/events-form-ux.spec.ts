import { expect, test, type Page } from '@playwright/test';

const diagnostics = new WeakMap<Page, { pageErrors: string[]; blockedRequests: string[] }>();
test.beforeEach(async ({ context, page }) => {
  const evidence = { pageErrors: [] as string[], blockedRequests: [] as string[] };
  diagnostics.set(page, evidence);
  page.on('pageerror', error => evidence.pageErrors.push(error.stack ?? error.message));
  // Only the existing local preview may serve this fixture; no Auth/API traffic escapes.
  await context.route('**/*', async route => {
    if (new URL(route.request().url()).origin === 'http://127.0.0.1:5188') await route.continue();
    else { evidence.blockedRequests.push(route.request().url()); await route.abort('blockedbyclient'); }
  });
  await context.routeWebSocket('**/*', socket => {
    if (new URL(socket.url()).origin === 'ws://127.0.0.1:5188') socket.connectToServer();
    else { evidence.blockedRequests.push(socket.url()); void socket.close(); }
  });
});
test.afterEach(async ({ page }, testInfo) => {
  const evidence = diagnostics.get(page)!;
  await testInfo.attach('runtime-and-network', { body: JSON.stringify({ ...evidence, viewport: page.viewportSize(), retry: testInfo.retry }, null, 2), contentType: 'application/json' });
  if (testInfo.status !== testInfo.expectedStatus) await testInfo.attach('failure-screen', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  expect.soft(evidence.pageErrors, 'Unhandled browser errors').toEqual([]);
  expect.soft(evidence.blockedRequests, 'Unexpected traffic outside the isolated preview').toEqual([]);
});

test('create and edit preserve the form contract and revision', async ({ page }) => {
  await page.goto('/admin/events/new');
  await page.getByLabel('Název akce').fill('Syntetická nová akce');
  await page.getByLabel('Datum a čas').fill('2030-10-20T19:00');
  await page.getByLabel('Místo', { exact: true }).fill('Testovací sál');
  await page.getByLabel('Veřejné upřesnění místa').fill('Testovací lokalita');
  await page.getByRole('button', { name: 'Vytvořit akci', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Vytvářím…' })).toBeDisabled();
  await expect(page).toHaveURL(/synthetic-event$/u);
  await expect(page.getByLabel('Název akce')).toHaveValue('Syntetická nová akce');
  expect(await page.evaluate(() => window.uxEventReads)).toEqual([
    expect.objectContaining({ id: 'synthetic-event', title: 'Syntetická nová akce', revision: 1 }),
  ]);
  await page.getByLabel('Název akce').fill('Upravená akce');
  await page.getByRole('button', { name: 'Uložit změny' }).click();
  await expect(page.getByRole('status')).toHaveText('Změny akce byly uloženy.');
  const calls = await page.evaluate(() => window.uxCalls);
  expect(calls).toEqual([
    { operation: 'create', values: { title: 'Syntetická nová akce', startsAt: '2030-10-20T19:00', timeZone: 'Europe/Prague', venueName: 'Testovací sál', publicLocation: 'Testovací lokalita', teamCapacity: 20, peopleCapacity: 80, teamSizeMin: 2, teamSizeMax: 4, pricingMode: 'per-team', pricingAmountCzk: 350, pricingHidden: false } },
    expect.objectContaining({ operation: 'update', id: 'synthetic-event', revision: 1, values: expect.objectContaining({ title: 'Upravená akce', teamCapacity: 20, peopleCapacity: 80 }) }),
  ]);
  expect(await page.evaluate(() => window.uxMutationResults)).toEqual([
    { operation: 'create', response: { eventId: 'synthetic-event', revision: 1, lifecycleStatus: 'scheduled', registrationStatus: 'scheduled' } },
    { operation: 'update', response: { eventId: 'synthetic-event', revision: 2, lifecycleStatus: 'scheduled', registrationStatus: 'scheduled' } },
  ]);
  const savedRead = { id: 'synthetic-event', title: 'Upravená akce', revision: 2 };
  expect(await page.evaluate(() => window.uxEventReads)).toEqual([
    expect.objectContaining({ id: 'synthetic-event', title: 'Syntetická nová akce', revision: 1 }),
    expect.objectContaining(savedRead),
  ]);
  // Remount the real detail route: its repository read must retain the successful update.
  await page.goBack();
  await expect(page).toHaveURL(/\/admin\/events\/new$/u);
  await expect(page.getByRole('heading', { name: 'Vytvořit akci', exact: true })).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/\/admin\/events\/synthetic-event$/u);
  await expect(page.getByLabel('Název akce')).toHaveValue('Upravená akce');
  expect(await page.evaluate(() => window.uxEventReads)).toEqual([
    expect.objectContaining({ id: 'synthetic-event', title: 'Syntetická nová akce', revision: 1 }),
    expect.objectContaining(savedRead),
    expect.objectContaining(savedRead),
  ]);
  expect(await page.evaluate(() => window.uxCalls)).toEqual(calls);
});

test('save errors retain values and native constraints prevent invalid submissions', async ({ page }) => {
  await page.goto('/admin/events/synthetic-event?fail=1');
  await page.getByLabel('Název akce').fill('Neztratit koncept');
  await page.getByLabel('Maximální počet týmů', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Uložit změny' }).click();
  expect(await page.evaluate(() => window.uxCalls.length)).toBe(0);
  await page.getByLabel('Maximální počet týmů', { exact: true }).fill('21');
  await page.getByRole('button', { name: 'Uložit změny' }).click();
  await expect(page.getByRole('alert')).toContainText('Změny se nepodařilo uložit');
  await expect(page.getByLabel('Název akce')).toHaveValue('Neztratit koncept');
  await expect(page.getByLabel('Maximální počet týmů', { exact: true })).toHaveValue('21');
  await expect(page.getByRole('status')).toHaveCount(0);
});

test('moderator stays read-only', async ({ page }) => {
  await page.goto('/admin/events/synthetic-event?role=moderator');
  await expect(page.getByRole('heading', { name: 'Detail akce' })).toBeVisible();
  await expect(page.locator('.event-form')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Uložit změny' })).toHaveCount(0);
  await page.goto('/admin/events/new?role=moderator');
  await expect(page.getByRole('heading', { name: 'Pouze pro administrátora' })).toBeVisible();
});

for (const width of [1280, 390]) {
  test(`event price visibility retains its private amount after save and reload at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/admin/events/synthetic-event');
    const visible = page.getByRole('checkbox', { name: 'Zobrazovat cenu na veřejném webu' });
    const amount = page.getByLabel('Cena v Kč');
    const save = page.getByRole('button', { name: 'Uložit změny' });
    await expect(visible).toBeChecked();
    await amount.fill('12500');
    await visible.uncheck();
    await expect(amount).toHaveValue('12500');
    await expect(page.getByText('Veřejně se cena nezobrazuje. Uložená cena: 12 500 Kč za tým')).toBeVisible();
    await save.click();
    await expect(page.getByRole('status')).toHaveText('Změny akce byly uloženy.');
    expect(await page.evaluate(() => window.uxEventReads.at(-1)?.pricing)).toEqual({ mode: 'per-team', amountCzk: 12500, hidden: true });
    await page.getByRole('link', { name: '← Zpět na akce' }).click();
    await page.goBack();
    await expect(visible).not.toBeChecked();
    await expect(amount).toHaveValue('12500');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: `.local-data/price-visibility-registration-release/hidden-${width}.png`, fullPage: true });
    await visible.check();
    await save.click();
    await expect(page.getByRole('status')).toHaveText('Změny akce byly uloženy.');
    expect(await page.evaluate(() => window.uxEventReads.at(-1)?.pricing)).toEqual({ mode: 'per-team', amountCzk: 12500 });
  });
  test(`event pricing saves and reloads from the isolated repository at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/admin/events/new');
    const mode = page.getByLabel('Způsob účtování');
    const amount = page.getByLabel('Cena v Kč');
    await expect(mode).toHaveValue('per-team');
    await expect(amount).toHaveValue('350');
    await expect(page.getByText('Veřejné zobrazení: 350 Kč za tým')).toBeVisible();
    await page.getByLabel('Název akce').fill('Syntetická placená akce');
    await page.getByLabel('Datum a čas').fill('2030-10-20T19:00');
    await page.getByLabel('Místo', { exact: true }).fill('Testovací sál');
    await page.getByLabel('Veřejné upřesnění místa').fill('Testovací lokalita');
    await page.getByRole('button', { name: 'Vytvořit akci', exact: true }).click();
    await expect(page).toHaveURL(/synthetic-event$/u);
    await expect(amount).toHaveValue('350');
    await mode.selectOption('per-event');
    await amount.fill('12500');
    await expect(page.getByText('Veřejné zobrazení: 12 500 Kč za celou akci')).toBeVisible();
    await mode.selectOption('agreement');
    await expect(amount).toHaveCount(0);
    await expect(page.getByText('Veřejné zobrazení: Cena dle dohody')).toBeVisible();
    await mode.selectOption('per-event');
    await expect(amount).toHaveValue('12500');

    const save = page.getByRole('button', { name: 'Uložit změny' });
    for (const invalid of ['', '-1', '1.5', '1000001']) {
      await amount.fill(invalid);
      await save.click();
      expect(await amount.evaluate(input => (input as HTMLInputElement).validity.valid)).toBe(false);
      expect(await page.evaluate(() => window.uxCalls.length)).toBe(1);
    }
    await amount.fill('12500');
    await save.click();
    await expect(page.getByRole('status')).toHaveText('Změny akce byly uloženy.');
    expect(await page.evaluate(() => window.uxEventReads.at(-1)?.pricing)).toEqual({ mode: 'per-event', amountCzk: 12500 });
    // Route remount rereads the memory-only synthetic repository, as a fresh detail load does.
    await page.goBack();
    await expect(page).toHaveURL(/\/new$/u);
    await page.goForward();
    await expect(mode).toHaveValue('per-event');
    await expect(amount).toHaveValue('12500');
    await expect(page.getByText('Veřejné zobrazení: 12 500 Kč za celou akci')).toBeVisible();
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: `.local-data/event-pricing-config-release/per-event-${width}.png`, fullPage: true });

    await mode.selectOption('agreement');
    await save.click();
    await expect(page.getByRole('status')).toHaveText('Změny akce byly uloženy.');
    expect(await page.evaluate(() => window.uxEventReads.at(-1)?.pricing)).toEqual({ mode: 'agreement', amountCzk: null });
    await page.goBack();
    await expect(page).toHaveURL(/\/new$/u);
    await page.goForward();
    await expect(mode).toHaveValue('agreement');
    await expect(amount).toHaveCount(0);
    await expect(page.getByText('Veřejné zobrazení: Cena dle dohody')).toBeVisible();
    await expect(page.locator('#event-pricing-help')).toContainText('zobrazuje veřejně');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: `.local-data/event-pricing-config-release/agreement-${width}.png`, fullPage: true });
  });
}

for (const [width, height] of [[1280, 720], [1024, 768], [390, 844]]) {
  test(`both forms visual contract ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width: width!, height: height! });
    for (const route of ['new', 'synthetic-event']) {
      await page.goto('/admin/events/' + route);
      const field = page.getByLabel('Název akce');
      await expect(field).toBeVisible();
      await expect(page.getByText('V2', { exact: true }).filter({ visible: true })).toBeVisible();
      await expect(page.getByText('Pro zkoušení používejte pouze smyšlená data.', { exact: true })).toHaveCount(0);
      const size = await field.boundingBox();
      expect(size!.height).toBe(46);
      expect(size!.width).toBeGreaterThan(width === 390 ? 250 : 600);
      expect(await page.locator('h1').evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeLessThanOrEqual(36);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      await field.focus();
      await page.keyboard.press('Tab');
      await expect(page.getByLabel('Datum a čas')).toBeFocused();
      await page.screenshot({ path: `.local-data/events-form-ux/after-local/${route}-${width}.png`, fullPage: true });
    }
  });
}
