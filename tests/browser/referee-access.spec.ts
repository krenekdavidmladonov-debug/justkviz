import { seedEmulatorMembership } from '../../functions/src/dev/seed-membership.js';
import { expect, test } from '@playwright/test';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

// Create an ephemeral synthetic staff account; never store a test password in Git.
let loginEmail: string, loginPassword: string;
const refereeQuizId = 'referee-browser-' + randomUUID();
let cleanup: (() => Promise<void>) | undefined;
test.beforeAll(async () => {
  const projectId = process.env.GCLOUD_PROJECT;
  if (projectId !== 'demo-filmovy-kviz-v2' || !/^(127\.0\.0\.1|localhost):9099$/u.test(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '')) {
    throw new Error('Scoring browser fixtures require the local demo Auth emulator.');
  }
  const require = createRequire(new URL('../../functions/package.json', import.meta.url));
  const sdk = require('firebase-admin/app') as { initializeApp(options: { projectId: string }, name: string): object; deleteApp(app: object): Promise<void> };
  const app = sdk.initializeApp({ projectId }, 'referee-browser-' + randomUUID());
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
  type FixtureDocument = { id: string; data(): Record<string, unknown> };
  const store = (require('firebase-admin/firestore') as { getFirestore(app: object): {
    doc(path: string): { get(): Promise<FixtureDocument>; set(data: Record<string, unknown>): Promise<unknown> };
    collection(path: string): { get(): Promise<{ docs: FixtureDocument[] }> };
  } }).getFirestore(app);
  const source = (await store.doc('quizzes/preflight-ready-e2e').get()).data();
  const slides = (await store.collection('quizzes/preflight-ready-e2e/slides').get()).docs.sort((a,b) => Number(a.data().position)-Number(b.data().position));
  const round = (await store.collection('quizzes/preflight-ready-e2e/rounds').get()).docs[0]!.data();
  await store.doc('quizzes/' + refereeQuizId).set({ ...source, title: 'Synthetic referee two rounds', roundCount: 2, questionCount: 2, slideCount: slides.length * 2 });
  for (let index = 0; index < 2; index++) {
    const roundId = 'round-' + (index + 1);
    await store.doc(`quizzes/${refereeQuizId}/rounds/${roundId}`).set({ ...round, title: 'Synthetic round ' + (index + 1), position: index + 1 });
    for (let position = 0; position < slides.length; position++) await store.doc(`quizzes/${refereeQuizId}/slides/${roundId}-${position}`).set({ ...slides[position]!.data(), roundId, position: index * slides.length + position + 1 });
  }
});
test.afterAll(async () => { await cleanup?.(); });


test('organizer issues private QR, referee scores, corrections survive and revocation blocks open access', async ({ page, context, browser }) => {
  // Never record traces, QR screenshots, access URLs, request bodies or downloaded keys.
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['localhost','127.0.0.1'].includes(url.hostname)) return route.abort();
    return route.continue();
  });
  await page.goto('/admin/login');
  await page.getByLabel('E-mail').fill(loginEmail); await page.getByLabel('Heslo').fill(loginPassword);
  await page.getByRole('button', { name: 'Přihlásit se' }).click(); await expect(page).toHaveURL(/\/admin$/u);
  await page.goto('/admin/events/new');
  await page.getByLabel('Název akce').fill('Synthetic referee browser'); await page.getByLabel('Datum a čas').fill('2031-11-20T19:00');
  await page.getByLabel('Místo', { exact: true }).fill('Synthetic'); await page.getByLabel('Veřejné upřesnění místa').fill('Synthetic');
  await page.getByRole('button', { name: 'Vytvořit akci' }).click(); await expect(page).toHaveURL(/\/admin\/events\/(?!new$)[^/]+$/u);
  const eventId = page.url().split('/').pop()!;
  await page.getByRole('button', { name: '+ Přidat tým', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Název týmu').fill('Referee team'); await page.getByRole('dialog').getByRole('button', { name: 'Přidat tým', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '+ Přidat tým', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Název týmu').fill('Second referee team'); await page.getByRole('dialog').getByRole('button', { name: 'Přidat tým', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Kvíz', exact: true }).selectOption(refereeQuizId); await page.getByRole('button', { name: 'Připravit ke hraní', exact: true }).click(); await expect(page.getByText('Kvíz je připraven ke hraní.')).toBeVisible();
  const panel = page.getByRole('region', { name: 'Přístupy rozhodčích', exact: true });
  await panel.getByLabel('Označení rozhodčího').fill('Rozhodčí browser');
  const expiry = new Date(await panel.getByLabel('Platnost přístupu do').inputValue()).getTime(); expect(Math.abs(expiry - Date.now() - 86400000) < 120000).toBe(true);
  await panel.getByRole('button', { name: 'Vydat přístup rozhodčího' }).click();
  const urlField = panel.getByLabel('Soukromý odkaz rozhodčího'); await expect(urlField).toBeVisible();
  const privateUrl = await urlField.inputValue(); const qr = await panel.getByAltText('Soukromý QR rozhodčího').getAttribute('src');
  expect((await panel.getByRole('link', { name: 'Stáhnout QR PNG' }).getAttribute('href')) === qr).toBe(true);
  const png = PNG.sync.read(Buffer.from(qr!.split(',')[1]!, 'base64')); const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data;
  await panel.getByRole('button', { name: 'Skrýt soukromý odkaz' }).click();
  expect(decoded === privateUrl).toBe(true); expect(new URL(privateUrl).pathname === '/referee/' + eventId).toBe(true); expect(new URL(privateUrl).hash.startsWith('#access=')).toBe(true);
  const refereeContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await refereeContext.route('**/*', route => ['localhost','127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  const referee = await refereeContext.newPage();
  try {
    await referee.goto(privateUrl); await expect(referee.getByRole('heading', { name: 'Bodování', exact: true })).toBeVisible();
    await expect.poll(() => new URL(referee.url()).hash === '').toBe(true);
    const rounds = referee.getByRole('combobox', { name: 'Kolo', exact: true });
    const points = referee.getByLabel('Body — Referee team', { exact: true });
    const otherPoints = referee.getByLabel('Body — Second referee team', { exact: true });
    const row = referee.locator('.round-score-team').filter({ has: points });
    const save = referee.getByRole('button', { name: 'Uložit body celého kola', exact: true });
    await expect(rounds).toHaveValue('round-1'); await expect(referee.locator('.round-score-team')).toHaveCount(2); await expect(save).toHaveCount(1);
    await points.fill('2,5'); await otherPoints.fill('0');
    const savedResponse = referee.waitForResponse(response => response.url().endsWith('/saveRefereeScore') && response.request().method() === 'POST');
    await save.click(); const saved = await (await savedResponse).json() as { result: { scores: unknown[] } };
    expect(saved.result.scores).toHaveLength(2); await expect(referee.getByText('Body kola jsou uložené. Potvrzeno serverem.')).toBeVisible();
    await expect(referee.getByText('2 / 2 týmů má uložené body', { exact: true })).toBeVisible();
    await rounds.selectOption('round-2'); await expect(points).toHaveValue(''); await expect(otherPoints).toHaveValue('');
    await points.fill('0'); await otherPoints.fill('2'); await save.click(); await expect(referee.getByText('Body kola jsou uložené. Potvrzeno serverem.')).toBeVisible();
    await rounds.selectOption('round-1'); await expect(points).toHaveValue('2,5'); await expect(otherPoints).toHaveValue('0');
    await referee.reload(); await expect(points).toHaveValue('2,5');
    await points.fill('3.5'); await save.click(); await expect(referee.getByRole('alert')).toContainText('Doplňte důvod');
    await referee.getByLabel('Důvod opravy — Referee team').fill('Browser referee correction'); await save.click(); await expect(row).toContainText('3,5 bodů');
    await row.getByText('Historie a oprava — Referee team', { exact: true }).click();
    const historyResponse = referee.waitForResponse(response => response.url().endsWith('/readRefereeHistory') && response.request().method() === 'POST');
    await row.getByRole('button', { name: 'Historie změn' }).click(); const history = await (await historyResponse).json() as { result: Record<string, unknown>[] };
    expect(history.result.every(item => Object.keys(item).every(key => ['revision','halfPoints','previousHalfPoints','reason','createdAt','actorLabel'].includes(key)))).toBe(true);
    expect(history.result.map(item => item.revision).sort()).toEqual([1, 2]); await expect(row).toContainText('Rozhodčí browser'); await expect(row.locator('li')).toHaveCount(2);
    await page.getByRole('link', { name: 'Otevřít bodování' }).click(); await expect(page.getByLabel('Body — Referee team', { exact: true })).toHaveValue('3,5');
    await points.fill('5'); await page.getByLabel('Body — Referee team', { exact: true }).fill('4'); await page.getByLabel('Důvod opravy — Referee team').fill('Organizer conflict');
    await page.getByRole('button', { name: 'Uložit body celého kola', exact: true }).click();
    await expect(row).toContainText('Aktuálně uloženo: 4 bodů'); await expect(points).toHaveValue('5'); await expect(save).toBeDisabled();
    await row.getByRole('button', { name: 'Připravit opravu aktuální revize' }).click(); await referee.getByLabel('Důvod opravy — Referee team').fill('Resolution');
    await save.click(); await expect(row).toContainText('5 bodů'); await expect(referee.getByText('Body kola jsou uložené. Potvrzeno serverem.')).toBeVisible();
    await points.fill('6'); referee.once('dialog', dialog => dialog.dismiss()); await rounds.selectOption('round-2');
    await expect(rounds).toHaveValue('round-1'); await expect(points).toHaveValue('6');
    referee.once('dialog', dialog => dialog.accept()); await rounds.selectOption('round-2'); await expect(points).toHaveValue('0');
    await rounds.selectOption('round-1'); await expect(points).toHaveValue('5'); await points.fill('6');
    expect(await referee.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const sibling = await context.newPage(); await sibling.goto(privateUrl); await expect(sibling.getByRole('combobox', { name: 'Kolo', exact: true })).toBeVisible();
    await sibling.getByRole('button', { name: 'Ukončit přístup v tomto panelu' }).click(); await sibling.close();
    await page.getByRole('link', { name: 'Zpět na detail akce' }).click(); await expect(panel).toBeVisible();
    page.once('dialog', dialog => dialog.accept()); await panel.getByRole('button', { name: 'Odebrat — Rozhodčí browser' }).click(); await expect(panel.getByRole('status')).toContainText('Přístup byl odebrán.');
    await expect(referee.getByRole('alert').filter({ hasText: 'Přístup vypršel / byl odebrán' })).toBeVisible(); await expect(points).toBeDisabled(); await expect(points).toHaveValue('6');
    const credential = { eventId, accessId: new URLSearchParams(new URL(privateUrl).hash.slice(1)).get('access'), key: new URLSearchParams(new URL(privateUrl).hash.slice(1)).get('key') };
    const endpoint = 'http://127.0.0.1:5001/demo-filmovy-kviz-v2/europe-west1/';
    const deniedRead = await refereeContext.request.post(endpoint + 'readRefereeEvent', { data: { data: credential } }); expect(deniedRead.status()).toBe(403);
    const deniedSave = await refereeContext.request.post(endpoint + 'saveRefereeScore', { data: { data: { credential, score: { eventId, snapshotId: 'none', roundId: 'none', requestId: crypto.randomUUID(), scores: [{ teamId: 'none', expectedRevision: 0, halfPoints: 1, reason: '' }] } } } }); expect(deniedSave.status()).toBe(403);
    await page.reload(); await expect(panel).toBeVisible();
  } finally { await refereeContext.close(); }
});
