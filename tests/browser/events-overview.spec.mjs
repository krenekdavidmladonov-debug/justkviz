/* global document, innerWidth, Node */
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { editorIdentity } from '../e2e/editor-identity.mjs';
import { requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';

const out = '.local-data/events-overview/browser';
const localOnly = context => context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) || /^(blob:|data:)/u.test(route.request().url()) ? route.continue() : route.abort());
const metric = (page, label) => page.locator('.dashboard-stats > div').filter({ has: page.locator('dt', { hasText: new RegExp('^' + label + '$', 'u') }) }).locator('dd');
async function noOverflow(page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); }
async function fixture() {
  requireFullEmulatorEnvironment(process.env, 'Events overview browser fixture');
  const identity = await editorIdentity(), roots = [], ids = {};
  const member = (await identity.db.collection('memberships').where('email', '==', identity.email).get()).docs[0].ref;
  const eventData = async id => (await identity.db.doc('events/' + id).get()).data();
  const config = (title, days) => ({ title, description: 'Syntetický veřejný popis večera.', startsAt: new Date(Date.now() + days * 86_400_000).toISOString(), timeZone: 'Europe/Prague', venue: { name: 'Syntetický sál', publicLocation: 'Praha' }, teamCapacity: 4, peopleCapacity: 20, teamSizeMin: 1, teamSizeMax: 4 });
  for (const [key, title, days] of [['ready', 'Připravená neveřejná akce', 2], ['public', 'Zveřejněný kvízový večer', 1], ['draft', 'Koncept bez kvízu', 7], ['history', 'Proběhlý kvízový večer', -2]]) {
    ids[key] = (await identity.call('createEvent', { expectedRevision: 0, event: config(title, days) })).eventId;
    roots.push('events/' + ids[key], 'publicEvents/' + ids[key]);
  }
  const quizId = (await identity.call('createQuiz', { requestId: randomUUID(), title: 'Zdrojový kvíz po úpravě' })).quizId;
  roots.push('quizzes/' + quizId);
  await identity.db.doc('quizzes/' + quizId).update({ revision: 2 });
  const eventRef = identity.db.doc('events/' + ids.ready), event = await eventData(ids.ready);
  await eventRef.update({ lifecycleStatus: 'ready', quizAssignment: { quizId, quizRevision: 1, snapshotId: 'synthetic-snapshot-' + randomUUID(), quizTitle: 'Připravená verze kvízu', roundCount: 2, questionCount: 10, lockedAt: event.createdAt } });
  for (const key of ['public', 'history']) await identity.call('configureEventRegistration', { eventId: ids[key], expectedRevision: (await eventData(ids[key])).revision, published: true, registrationOpensAt: '2020-01-01T00:00:00Z', registrationClosesAt: '2035-01-01T00:00:00Z' });
  const team = await identity.call('adminAddEventTeam', { eventId: ids.public, requestId: randomUUID(), teamName: 'Syntetický tým čtyř', memberCount: 4 });
  await identity.call('adminAddEventTeam', { eventId: ids.public, requestId: randomUUID(), teamName: 'Syntetický tým tří', memberCount: 3 });
  await identity.db.doc('events/' + ids.history).update({ lifecycleStatus: 'completed' });
  await identity.db.doc('publicEvents/' + ids.history).update({ lifecycleStatus: 'completed' });
  await member.update({ events: { mode: 'selected', ids: Object.values(ids) }, quizzes: { mode: 'selected', ids: [quizId] } });
  return { ...identity, ids, team, eventData, async dispose() { for (const path of roots) await identity.db.recursiveDelete(identity.db.doc(path)); await identity.dispose(); await identity.db.terminate(); } };
}

test('compact overview shows each published event and keeps draft quizzes below statistics', async ({ page, context }) => {
  const f = await fixture(), errors = [], calls = [];
  await mkdir(out, { recursive: true });
  await localOnly(context);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (request.method() === 'POST' && request.url().includes('/europe-west1/')) calls.push({ name: request.url().split('/').at(-1), operation: request.postDataJSON()?.data?.operation });
  });
  try {
    await page.goto('/admin/login');
    await page.getByLabel('E-mail', { exact: true }).fill(f.email);
    await page.getByLabel('Heslo', { exact: true }).fill(f.password);
    await page.getByRole('button', { name: 'Přihlásit se', exact: true }).click();
    await expect(page).toHaveURL(/\/admin$/u);
    await expect(page.locator('[data-event-id="' + f.ids.public + '"]')).toBeVisible();
    calls.length = 0;
    const start = Date.now(); await page.reload();
    await expect(metric(page, 'Týmy')).toContainText('2');
    const dashboardLoadMillis = Date.now() - start;
    expect(calls.filter(call => call.name === 'readAccessData').map(call => call.operation).sort()).toEqual(['eventPage', 'quizzes']);
    await expect(page.locator('.dashboard-event-summary')).toHaveCount(1);
    await expect(page.getByText('Připravená neveřejná akce', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Koncept bez kvízu', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Proběhlý kvízový večer', { exact: true })).toHaveCount(0);
    await expect(metric(page, 'Týmy')).toContainText('4');
    await expect(metric(page, 'Osoby')).toHaveCount(0);
    await expect(metric(page, 'Volno')).toHaveText('2 týmů');
    await expect(page.getByRole('heading', { name: 'Rozpracované kvízy', exact: true })).toBeVisible();
    expect(await page.locator('.dashboard-stats').evaluate(el => Boolean(el.compareDocumentPosition(document.getElementById('dashboard-drafts-title')) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
    await expect(page.getByRole('button', { name: 'Zveřejnit akci', exact: true })).toHaveCount(0);
    expect((await f.eventData(f.ids.ready)).registrationPublished).toBe(false);
    await f.call('adminCancelEventRegistration', { eventId: f.ids.public, registrationId: f.team.registrationId });
    await page.getByRole('button', { name: 'Obnovit', exact: true }).click();
    await expect(metric(page, 'Volno')).toHaveText('3 týmů');
    await f.call('configureEventRegistration', { eventId: f.ids.ready, expectedRevision: (await f.eventData(f.ids.ready)).revision, published: true });
    await page.getByRole('button', { name: 'Obnovit', exact: true }).click();
    await expect(page.locator('.dashboard-event-summary')).toHaveCount(2);
    await expect(metric(page.locator('[data-event-id="' + f.ids.ready + '"]'), 'Týmy')).toContainText('0');
    await expect(metric(page.locator('[data-event-id="' + f.ids.public + '"]'), 'Volno')).toHaveText('3 týmů');
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 }); await noOverflow(page);
      await page.locator('.admin-dashboard').screenshot({ path: out + '/compact-' + width + '.png' });
    }
    expect(errors).toEqual([]);
    await writeFile(out + '/compact-evidence.json', JSON.stringify({ status: 'PASS', dashboardLoadMillis, separatePublishedEventCounts: true, hiddenEventsExcluded: true, publicationRefresh: true, draftsBelowStatistics: true, widths: [1440, 390] }));
  } finally {
    await context.unrouteAll({ behavior: 'ignoreErrors' }); await context.close(); await f.dispose();
  }
});
