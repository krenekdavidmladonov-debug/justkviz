import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { seedEmulatorMembership } from '../../functions/src/dev/seed-membership';
import { eventFormRecord } from './events-form-ux.data';

let email: string, password: string;
const eventId = 'warmup-synthetic-event', snapshotId = 'warmup-synthetic-snapshot', quizId = 'warmup-synthetic-quiz';
let readData: () => Promise<unknown>;
test.beforeAll(async () => {
  const projectId = process.env.GCLOUD_PROJECT;
  if (!projectId?.startsWith('demo-') || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9399'
    || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8380' || process.env.FUNCTIONS_EMULATOR_HOST !== '127.0.0.1:5301') {
    throw new Error('Synthetic warmup fixtures require the isolated +300 local demo emulators.');
  }
  const require = createRequire(new URL('../../functions/package.json', import.meta.url));
  const { initializeApp } = require('firebase-admin/app') as { initializeApp: (options: { projectId: string }, name: string) => object };
  const app = initializeApp({ projectId }, 'warmup-browser');
  const { getAuth } = require('firebase-admin/auth') as { getAuth: (app: object) => { createUser(data: { email: string; password: string; emailVerified: boolean }): Promise<{ uid: string }> } };
  const { getFirestore } = require('firebase-admin/firestore') as { getFirestore: (app: object) => {
    doc(path: string): { set(value: object): Promise<unknown>; get(): Promise<{ data(): Record<string, unknown> | undefined }> };
  } };
  const auth = getAuth(app), db = getFirestore(app);
  email = 'warmup-' + randomUUID() + '@example.test'; password = randomUUID();
  const user = await auth.createUser({ email, password, emailVerified: true });
  await seedEmulatorMembership(user.uid, 'admin');
  const now = new Date();
  await db.doc('quizzes/' + quizId).set({ title: 'Syntetický kvíz', description: '', status: 'draft', slideCount: 1, roundCount: 0, questionCount: 0, revision: 0, createdAt: now, updatedAt: now, createdBy: user.uid, updatedBy: user.uid });
  await db.doc('quizSnapshots/' + snapshotId).set({ eventId, quizId, quizRevision: 0, slideCount: 1, roundCount: 0, questionCount: 0 });
  await db.doc('quizSnapshots/' + snapshotId + '/slides/intro').set({ position: 1, kind: 'intro', isQuestion: false, title: 'Syntetické zahřátí', text: '', options: [], media: [], presentation: {} });
  await db.doc('events/' + eventId).set({ ...eventFormRecord(), id: eventId, lifecycleStatus: 'ready', createdBy: user.uid, updatedBy: user.uid, createdAt: now, updatedAt: now,
    quizAssignment: { quizId, snapshotId, quizRevision: 0, quizTitle: 'Syntetický kvíz', roundCount: 0, questionCount: 0, lockedAt: now } });
  readData = async () => Promise.all(['events/' + eventId, 'quizSnapshots/' + snapshotId, 'quizSnapshots/' + snapshotId + '/slides/intro'].map(async path => (await db.doc(path).get()).data()));
});

test('detail preparation and once-only automatic moderation use exact nonmutating pings', async ({ page, context }) => {
  const errors: string[] = [], pings: { name: string; data: unknown }[] = [], forbidden: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) { forbidden.push(url.origin); await route.abort(); return; }
    if (route.request().method() === 'POST' && url.port === '5301') {
      const body = route.request().postDataJSON() as { data?: unknown; warmup?: unknown };
      const data = body.data ?? body;
      if (typeof data === 'object' && data !== null && 'warmup' in data) pings.push({ name: url.pathname.split('/').at(-1)!, data });
    }
    await route.continue();
  });
  await page.goto('/admin/login');
  await page.getByLabel('E-mail').fill(email); await page.getByLabel('Heslo').fill(password);
  await page.getByRole('button', { name: 'Přihlásit se' }).click(); await expect(page).toHaveURL(/\/admin$/u);
  await page.goto('/admin/events/' + eventId);
  const prepare = page.getByRole('button', { name: 'Připravit večer', exact: true });
  await expect(prepare).toBeVisible();
  const before = await readData();
  await prepare.click(); await expect(page.getByText('Všech šest služeb večera odpovědělo. Můžete pokračovat.')).toBeVisible();
  expect(await readData()).toEqual(before);
  expect(pings).toHaveLength(6);
  await page.getByRole('button', { name: 'Otevřít moderování akce', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/live\//u);
  await expect.poll(() => pings.length).toBe(12);
  await page.goBack(); await expect(prepare).toBeVisible();
  await page.getByRole('button', { name: 'Otevřít moderování akce', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/live\//u);
  await expect(page.getByRole('button', { name: 'Další →', exact: true })).toBeVisible();
  expect(pings).toHaveLength(12);
  for (const ping of pings) expect(ping.data).toEqual({ warmup: true });
  expect(errors).toEqual([]); expect(forbidden).toEqual([]);
});
