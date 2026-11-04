import { expect, test, type Page } from '@playwright/test';

async function localOnly(context: import('@playwright/test').BrowserContext) { await context.route('**/*', route => { const url = new URL(route.request().url()); return ['http:', 'https:'].includes(url.protocol) && ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort(); }); }
test.beforeEach(async ({ context }) => { await localOnly(context); });

async function login(page: Page, baseURL: string | undefined, email = 'admin@example.test') {
  await page.goto(`${baseURL}/admin/login`);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Heslo').fill('LocalQuiz123!');
  await page.getByRole('button', { name: 'Přihlásit se' }).click();
  await expect(page).not.toHaveURL(/\/admin\/login$/u);
}

async function createOpenEvent(page: Page, baseURL: string | undefined, title: string) {
  await login(page, baseURL);
  await page.goto(`${baseURL}/admin/events/new`);
  await page.getByLabel('Název akce').fill(title);
  await page.getByLabel('Datum a čas').fill('2031-11-20T19:00');
  await page.getByLabel('Místo', { exact: true }).fill('Syntetický sál');
  await page.getByLabel('Veřejné upřesnění místa').fill('Praha');
  await page.getByRole('button', { name: 'Vytvořit akci' }).click();
  await expect(page).not.toHaveURL(/\/admin\/events\/new$/u);
  await expect(page).toHaveURL(/\/admin\/events\/[^/]+$/u);
  const detailUrl = page.url();
  const eventId = /\/admin\/events\/([^/]+)$/u.exec(detailUrl)?.[1];
  expect(eventId).toBeTruthy();
  await page.getByRole('link', { name: 'Spravovat týmy a registrace' }).click();
  await page.getByLabel('Otevření').fill('2020-01-01T00:00');
  await page.getByLabel('Uzavření').fill('2030-01-01T00:00');
  await page.getByRole('button', { name: 'Uložit nastavení' }).click();
  await expect(page.getByText('Nastavení registrací bylo uloženo.')).toBeVisible();
  await page.goto(detailUrl);
  await page.getByRole('button', { name: 'Zveřejnit a otevřít registrace', exact: true }).click();
  const publication = page.getByRole('dialog');
  await publication.getByRole('button', { name: 'Zveřejnit a otevřít registrace', exact: true }).click();
  await expect(publication).toHaveCount(0);
  await page.getByRole('button', { name: 'Odhlásit se' }).click();
  await expect(page).toHaveURL(/\/admin\/login$/u);
  return eventId!;
}

async function register(page: Page, baseURL: string | undefined, eventId: string, teamName: string, email: string) {
  await page.goto(`${baseURL}/events/${eventId}`);
  await expect(page.getByRole('heading', { name: 'Přihlásit tým', exact: true })).toBeVisible();
  await page.getByLabel('Název týmu').fill(teamName);
  await page.getByLabel('Počet členů').fill('4');
  await page.getByLabel('E-mail').fill(email);
  await page.getByRole('button', { name: 'Přihlásit tým' }).click();
  await expect(page.getByRole('heading', { name: 'Děkujeme, tým byl přihlášen.' })).toBeVisible();
}

test('public team registration returns only its secure management link', async ({ page, baseURL }) => {
  const eventId = await createOpenEvent(page, baseURL, 'Veřejná registrace E2E');
  await register(page, baseURL, eventId, 'Syntetický veřejný tým', 'public@example.test');
  const link = page.getByRole('link', { name: 'Spravovat registraci' });
  expect(/registration=.*&token=/u.test(await link.getAttribute('href') ?? '')).toBe(true);
});

test('management link edits and idempotently soft-cancels its registration', async ({ page, baseURL }) => {
  const eventId = await createOpenEvent(page, baseURL, 'Management link E2E');
  await register(page, baseURL, eventId, 'Původní tým', 'manage@example.test');
  await page.getByRole('link', { name: 'Spravovat registraci' }).click();
  await expect(page.getByLabel('Počet členů')).toHaveAttribute('min', '2');
  await expect(page.getByLabel('Počet členů')).toHaveAttribute('max', '4');
  await page.getByLabel('Název týmu').fill('Upravený tým');
  await page.getByLabel('Počet členů').fill('3');
  await page.getByRole('button', { name: 'Uložit změny' }).click();
  await expect(page.getByText('Registrace byla upravena.')).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Zrušit registraci' }).click();
  await expect(page.getByRole('heading', { name: 'Registrace je zrušená' })).toBeVisible();
});

test('admin sees private contacts and moderator receives read-only registration UI', async ({ page, baseURL }) => {
  const eventId = await createOpenEvent(page, baseURL, 'Admin registrace E2E');
  await register(page, baseURL, eventId, 'Staff viditelný tým', 'staff-only@example.test');
  await login(page, baseURL);
  await page.goto(`${baseURL}/admin/events/${eventId}/registrations`);
  await expect(page.getByText('staff-only@example.test')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Zrušit' })).toBeVisible();
  await page.getByRole('button', { name: 'Odhlásit se' }).click();
  await expect(page).toHaveURL(/\/admin\/login$/u);
  await login(page, baseURL, 'moderator@example.test');
  await page.goto(`${baseURL}/admin/events/${eventId}/registrations`);
  await expect(page.getByText('staff-only@example.test')).toBeVisible();
  await expect(page.getByText('Moderátor má přístup pouze pro čtení.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Zrušit' })).toHaveCount(0);
});

for (const role of ['user', 'moderator']) {
  test(`management link remains usable in ${role} session`, async ({ page, baseURL }) => {
    const eventId = await createOpenEvent(page, baseURL, `Management ${role}`);
    await register(page, baseURL, eventId, 'Tým držitele odkazu', 'holder@example.test');
    const managementLink = await page.getByRole('link', { name: 'Spravovat registraci' }).getAttribute('href');
    expect(managementLink).toBeTruthy();
    await login(page, baseURL, `${role}@example.test`);
    await page.goto(`${baseURL}${managementLink}`);
    await expect(page.getByLabel('Počet členů')).toHaveAttribute('min', '2');
    await expect(page.getByLabel('Počet členů')).toHaveAttribute('max', '4');
    await page.getByLabel('Počet členů').fill('3');
    await page.getByRole('button', { name: 'Uložit změny' }).click();
    await expect(page.getByText('Registrace byla upravena.')).toBeVisible();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Zrušit registraci' }).click();
    await expect(page.getByRole('heading', { name: 'Registrace je zrušená' })).toBeVisible();
  });
}
