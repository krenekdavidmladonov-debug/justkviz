import { seedEmulatorMembership } from '../../functions/src/dev/seed-membership.js';
import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

// Create an ephemeral synthetic staff account; never store a test password in Git.
let loginEmail: string, loginPassword: string;
let cleanup: (() => Promise<void>) | undefined;
test.beforeAll(async () => {
  const projectId = process.env.GCLOUD_PROJECT;
  if (projectId !== 'demo-filmovy-kviz-v2' || !/^(127\.0\.0\.1|localhost):9099$/u.test(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '')) {
    throw new Error('Scoring browser fixtures require the local demo Auth emulator.');
  }
  const require = createRequire(new URL('../../functions/package.json', import.meta.url));
  const sdk = require('firebase-admin/app') as { initializeApp(options: { projectId: string }, name: string): object; deleteApp(app: object): Promise<void> };
  const app = sdk.initializeApp({ projectId }, 'scoring-browser-' + randomUUID());
  const authSdk = require('firebase-admin/auth') as { getAuth(app: object): {
    createUser(data: { email: string; password: string }): Promise<{ uid: string }>;
    setCustomUserClaims(uid: string, claims: { role: string }): Promise<void>;
    deleteUser(uid: string): Promise<void>;
  } };
  const auth = authSdk.getAuth(app);
  loginEmail = 'score-browser-' + randomUUID() + '@example.test'; loginPassword = randomUUID();
  const user = await auth.createUser({ email: loginEmail, password: loginPassword });
  cleanup = async () => { await auth.deleteUser(user.uid); await sdk.deleteApp(app); };
  await auth.setCustomUserClaims(user.uid, { role: 'admin' }); await seedEmulatorMembership(user.uid, 'admin');
});
test.afterAll(async () => { await cleanup?.(); });

test('one round save, reload, reason, two views, history and lost response', async ({ page, context }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/admin/login');
  await page.getByLabel('E-mail').fill(loginEmail); await page.getByLabel('Heslo').fill(loginPassword);
  await page.getByRole('button', { name: 'Přihlásit se' }).click(); await expect(page).toHaveURL(/\/admin$/u);
  await page.goto('/admin/events/new'); await page.getByLabel('Název akce').fill('Synthetic scoring browser');
  await page.getByLabel('Datum a čas').fill('2031-11-20T19:00'); await page.getByLabel('Místo', { exact: true }).fill('Synthetic venue');
  await page.getByLabel('Veřejné upřesnění místa').fill('Synthetic location'); await page.getByRole('button', { name: 'Vytvořit akci' }).click();
  await expect(page).toHaveURL(/\/admin\/events\/[^/]+$/u);
  for (const name of ['Bodovací tým', 'Druhý tým']) {
    await page.getByRole('button', { name: '+ Přidat tým', exact: true }).click(); await page.getByRole('dialog').getByLabel('Název týmu').fill(name);
    await page.getByRole('dialog').getByRole('button', { name: 'Přidat tým', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  await page.getByRole('combobox', { name: 'Kvíz', exact: true }).selectOption('preflight-ready-e2e');
  await page.getByRole('button', { name: 'Připravit ke hraní', exact: true }).click(); await expect(page.getByText('Kvíz je připraven ke hraní.')).toBeVisible();
  await page.getByRole('link', { name: 'Otevřít bodování' }).click(); await expect(page).toHaveURL(/\/admin\/events\/[^/]+\/scoring$/u);
  const url = page.url(), row = page.locator('.round-score-team').filter({ has: page.getByLabel('Body — Bodovací tým', { exact: true }) });
  const points = page.getByLabel('Body — Bodovací tým', { exact: true });
  const save = page.getByRole('button', { name: 'Uložit body celého kola', exact: true });
  await expect(page.locator('.round-score-team')).toHaveCount(2); await expect(save).toHaveCount(1);
  await points.fill('2,5'); await page.getByLabel('Body — Druhý tým', { exact: true }).fill('0');
  const firstResponse = page.waitForResponse(response => response.url().endsWith('/saveEventScore') && response.request().method() === 'POST');
  await save.click(); const batch = await (await firstResponse).json() as { result: { scores: unknown[] } };
  expect(batch.result.scores).toHaveLength(2); await expect(page.getByText('Body kola jsou uložené. Potvrzeno serverem.')).toBeVisible();
  await expect(page.getByText('2 / 2 týmů má uložené body', { exact: true })).toBeVisible();
  await page.reload(); await expect(points).toHaveValue('2,5');
  await points.fill('3.5'); await save.click(); await expect(page.getByRole('alert')).toContainText('Doplňte důvod');
  await page.getByLabel('Důvod opravy — Bodovací tým').fill('Přepočet archu'); await save.click(); await expect(row).toContainText('3,5 bodů');
  const second = await context.newPage(); await second.goto(url); const otherPoints = second.getByLabel('Body — Bodovací tým', { exact: true });
  const otherRow = second.locator('.round-score-team').filter({ has: otherPoints });
  await expect(otherPoints).toHaveValue('3,5'); await otherPoints.fill('5');
  await points.fill('4'); await page.getByLabel('Důvod opravy — Bodovací tým').fill('Druhý přepočet'); await save.click();
  await expect(otherRow).toContainText('Aktuálně uloženo: 4 bodů'); await expect(otherPoints).toHaveValue('5');
  await expect(second.getByRole('button', { name: 'Uložit body celého kola', exact: true })).toBeDisabled();
  await otherRow.getByRole('button', { name: 'Připravit opravu aktuální revize' }).click(); await second.getByLabel('Důvod opravy — Bodovací tým').fill('Rozhodnutí po konfliktu');
  await second.getByRole('button', { name: 'Uložit body celého kola', exact: true }).click(); await expect(otherRow).toContainText('5 bodů');
  await row.getByText('Historie a oprava — Bodovací tým', { exact: true }).click(); await row.getByRole('button', { name: 'Historie změn' }).click();
  await expect(row.locator('li')).toHaveCount(4); await expect(row).toContainText('Rozhodnutí po konfliktu'); await second.close();
  await points.fill('6,5'); await page.getByLabel('Důvod opravy — Bodovací tým').fill('Ověření opakování');
  let dropped = false;
  await page.route('**/saveEventScore', async route => { if (!dropped) { dropped = true; await route.fetch(); await route.abort('failed'); } else await route.continue(); });
  await save.click(); await expect(page.getByRole('alert').filter({ hasText: 'Uložení se nepodařilo potvrdit' })).toBeVisible(); await expect(points).toHaveValue('6,5');
  await save.click(); await expect(page.getByText('Body kola jsou uložené. Potvrzeno serverem.')).toBeVisible();
  await points.fill(''); await save.click(); await expect(page.getByRole('alert')).toContainText('Zadejte nezáporné body');
  page.once('dialog', dialog => dialog.dismiss()); await page.getByRole('link', { name: 'Zpět na detail akce' }).click(); await expect(page).toHaveURL(url);
  await page.getByLabel('Důvod opravy — Bodovací tým').fill('Zápis patřil jinému týmu');
  await row.getByRole('button', { name: 'Vrátit na nezadáno' }).click();
  page.once('dialog', dialog => dialog.accept()); await save.click(); await expect(points).toHaveValue(''); await expect(row).toContainText('Nezadáno');
  if (await row.locator('details').getAttribute('open') === null) await row.locator('summary').click();
  await row.getByRole('button', { name: 'Historie změn' }).click(); await expect(row.locator('li')).toHaveCount(6);
  mkdirSync('.local-data/event-scoring/screenshots', { recursive: true }); await page.screenshot({ path: '.local-data/event-scoring/screenshots/desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: '.local-data/event-scoring/screenshots/mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false); expect(errors).toEqual([]);
});
