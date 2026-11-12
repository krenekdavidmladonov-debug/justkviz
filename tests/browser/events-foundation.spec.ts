import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, baseURL: string | undefined, email = 'admin@example.test'): Promise<void> {
  await page.goto(`${baseURL}/admin/login`);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Heslo').fill('LocalQuiz123!');
  await page.getByRole('button', { name: 'Přihlásit se' }).click();
  await expect(page).toHaveURL(/\/admin$/u);
}

test('admin creates an event, validates quiz readiness, locks a snapshot, and publishes safe event copy', async ({ page, baseURL }) => {
  await login(page, baseURL);
  await page.getByRole('link', { name: 'Akce' }).click();
  await page.getByRole('link', { name: 'Vytvořit akci' }).click();
  await page.getByLabel('Název akce').fill('Veřejný Events Foundation test');
  await page.getByLabel('Datum a čas').fill('2026-10-20T19:00');
  await page.getByLabel('Místo', { exact: true }).fill('Syntetický kulturní dům');
  await page.getByLabel('Veřejné upřesnění místa').fill('Praha – hlavní sál');
  await page.getByLabel('Maximální počet týmů', { exact: true }).fill('24');
  await expect(page.getByLabel('Maximální počet účastníků')).toHaveCount(0);
  await page.getByLabel('Minimální počet členů týmu').fill('2');
  await page.getByLabel('Maximální počet členů týmu').fill('4');
  await page.getByRole('button', { name: 'Vytvořit akci' }).click();
  await expect(page).not.toHaveURL(/\/admin\/events\/new$/u);
  await expect(page).toHaveURL(/\/admin\/events\/[^/]+$/u);

  await page.locator('[data-testid="event-quiz-assignment"] select').selectOption(
    { value: 'preflight-ready-e2e' },
    { force: true },
  );
  await expect(page.locator('[data-preflight-status="READY"]')).toBeVisible();
  await page.getByRole('button', { name: 'Zkontrolovat a připravit' }).click();
  await expect(page.getByRole('heading', { name: 'Kvíz připraven' })).toBeVisible();
  await expect(page.getByText('Snapshot je privátní')).toBeVisible();

  await page.goto(`${baseURL}/events`);
  const card = page.getByRole('article').filter({ hasText: 'Veřejný Events Foundation test' });
  await expect(card).toContainText('Syntetický kulturní dům');
  await expect(card).toContainText('max. 4');
  await expect(card).toContainText('Volná místa pro týmy');
  await expect(card).toContainText('24');
  await expect(card).not.toContainText('Volno pro osoby');
});

test('blocked quiz cannot be prepared and moderator receives read-only event UX', async ({ page, baseURL }) => {
  await login(page, baseURL);
  await page.goto(`${baseURL}/admin/events`);
  await page.getByRole('link', { name: 'Vytvořit akci' }).click();
  await page.getByLabel('Název akce').fill('Blokovaný event test');
  await page.getByLabel('Datum a čas').fill('2026-10-21T19:00');
  await page.getByLabel('Místo', { exact: true }).fill('Testovací sál');
  await page.getByLabel('Veřejné upřesnění místa').fill('Brno');
  await page.getByRole('button', { name: 'Vytvořit akci' }).click();
  await expect(page).not.toHaveURL(/\/admin\/events\/new$/u);
  await page.locator('[data-testid="event-quiz-assignment"] select').selectOption(
    { value: 'preflight-blocked-e2e' },
    { force: true },
  );
  await expect(page.locator('[data-preflight-status="BLOCKED"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Zkontrolovat a připravit' })).toBeDisabled();
  const detailUrl = page.url();

  await page.getByRole('button', { name: 'Odhlásit se' }).click();
  await expect(page).toHaveURL(/\/admin\/login$/u);
  await page.getByLabel('E-mail').fill('moderator@example.test');
  await page.getByLabel('Heslo').fill('LocalQuiz123!');
  await page.getByRole('button', { name: 'Přihlásit se' }).click();
  await expect(page).toHaveURL(detailUrl);
  await expect(page.getByText('Moderátor může připravenou akci číst')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Uložit změny' })).toHaveCount(0);
});
