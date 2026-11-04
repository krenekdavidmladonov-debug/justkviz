import { expect, test } from '@playwright/test';

test.beforeEach(async ({ context, page }) => {
  await context.route('**/*', async route => {
    if (new URL(route.request().url()).origin === 'http://127.0.0.1:5196') await route.continue();
    else await route.abort('blockedbyclient');
  });
  await context.routeWebSocket('**/*', socket => {
    if (new URL(socket.url()).origin === 'ws://127.0.0.1:5196') socket.connectToServer();
    else void socket.close();
  });
  await page.clock.install({ time: new Date('2030-10-20T17:00:00Z') });
});

test('clears the initial two members and replaces the value after a timer rerender', async ({ page }, testInfo) => {
  await page.goto('/events/synthetic-event');
  const count = page.getByLabel('Počet členů');
  await expect(count).toHaveValue('2');
  if (testInfo.project.use.hasTouch) await count.tap(); else await count.click();
  await count.press('ControlOrMeta+A');
  await count.press('Backspace');
  await expect(count).toHaveValue('');
  await page.clock.fastForward(15_000);
  await expect(count).toHaveValue('');
  await count.pressSequentially('3');
  await expect(count).toHaveValue('3');
  await page.getByLabel('Název týmu').fill('Syntetický mobilní tým');
  await page.getByLabel('E-mail').fill('synthetic@example.test');
  await page.getByRole('button', { name: 'Přihlásit tým', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Děkujeme, tým byl přihlášen.' })).toBeVisible();
  expect(await page.evaluate(() => window.registrationInputCalls)).toEqual([
    { operation: 'create', values: { teamName: 'Syntetický mobilní tým', memberCount: 3, contactEmail: 'synthetic@example.test' } },
  ]);
});

test('keeps blank and invalid edits visible without submitting, then accepts select-and-type replacement', async ({ page }) => {
  await page.goto('/events/synthetic-event');
  const count = page.getByLabel('Počet členů');
  await page.getByLabel('Název týmu').fill('Syntetický tým');
  await page.getByLabel('E-mail').fill('synthetic@example.test');
  await expect(count).toHaveAttribute('inputmode', 'numeric');
  await expect(count).toHaveAttribute('step', '1');
  await expect(count).toHaveAttribute('max', '4');
  for (const invalid of ['', '0', '1', '2.5', '5']) {
    await count.fill(invalid);
    await page.getByLabel('E-mail').click();
    await page.clock.fastForward(15_000);
    await expect(count).toHaveValue(invalid);
    await page.getByRole('button', { name: 'Přihlásit tým', exact: true }).click();
    expect(await count.evaluate(input => (input as HTMLInputElement).validity.valid)).toBe(false);
    expect(await page.evaluate(() => window.registrationInputCalls)).toEqual([]);
  }
  await count.fill('2');
  await count.press('ControlOrMeta+A');
  await count.pressSequentially('4');
  await expect(count).toHaveValue('4');
  await page.getByRole('button', { name: 'Přihlásit tým', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Děkujeme, tým byl přihlášen.' })).toBeVisible();
  expect(await page.evaluate(() => window.registrationInputCalls.at(-1)?.values.memberCount)).toBe(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test('initializes the event minimum once and does not restore it while editing', async ({ page }) => {
  await page.goto('/events/synthetic-event?min=3');
  const count = page.getByLabel('Počet členů');
  await expect(count).toHaveAttribute('min', '3');
  await expect(count).toHaveValue('3');
  await count.fill('');
  await page.clock.fastForward(15_000);
  await expect(count).toHaveValue('');
  await count.pressSequentially('4');
  await page.clock.fastForward(15_000);
  await expect(count).toHaveValue('4');
});

test('allows the same blank editing and numeric save through the management link', async ({ page }, testInfo) => {
  await page.goto('/events/synthetic-event/registration/manage#registration=synthetic-registration&token=synthetic-token');
  const count = page.getByLabel('Počet členů');
  await expect(count).toHaveValue('2');
  if (testInfo.project.use.hasTouch) await count.tap(); else await count.click();
  await count.press('ControlOrMeta+A');
  await count.press('Backspace');
  await expect(count).toHaveValue('');
  await page.getByLabel('Název týmu').fill('Upravený syntetický tým');
  await expect(count).toHaveValue('');
  await page.getByRole('button', { name: 'Uložit změny' }).click();
  expect(await page.evaluate(() => window.registrationInputCalls)).toEqual([]);
  await count.pressSequentially('3');
  await page.getByRole('button', { name: 'Uložit změny' }).click();
  await expect(page.getByRole('status')).toHaveText('Registrace byla upravena.');
  expect(await page.evaluate(() => window.registrationInputCalls)).toEqual([
    { operation: 'update', values: { teamName: 'Upravený syntetický tým', memberCount: 3, contactEmail: 'synthetic@example.test' } },
  ]);
  await expect(count).toHaveValue('3');
});
