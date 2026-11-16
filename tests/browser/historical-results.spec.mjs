/* global document, innerWidth */
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { finalFixture } from '../e2e/final-reveal-fixture.mjs';

async function login(page, f) {
  await page.context().route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.goto('/admin/login');
  await page.getByLabel('E-mail').fill(f.login.email); await page.getByLabel('Heslo').fill(f.login.password);
  await page.getByRole('button', { name: 'Přihlásit se', exact: true }).click(); await expect(page).toHaveURL(/\/admin$/);
}
async function protectedState(f) {
  const state = {};
  for (const path of [`events/${f.eventId}`, `sessions/${f.sessionId}`, `publicSessions/${f.sessionId}`]) state[path] = (await f.db.doc(path).get()).data();
  for (const path of [`events/${f.eventId}/scores`, ...['finalVersions','finalOperations','interimVersions','interimOperations'].map(name => `sessions/${f.sessionId}/${name}`)]) {
    const docs = await f.db.collection(path).get(); state[path] = docs.docs.map(d => ({ id: d.id, data: d.data() }));
  }
  return state;
}
async function readOnlyMember(f) {
  await f.db.doc(`memberships/${f.moderator.uid}`).update({ permissions: ['event.read'], quizzes: { mode: 'none', ids: [] }, events: { mode: 'selected', ids: [f.eventId] }, version: 2 });
}
test('completed detail → confirmed history, mobile/reload, later source edits and missing roster cause no mutation', async ({ page }) => {
  const f = await finalFixture(4); let sourceQuizId;
  try {
    // Keep the source quiz valid for other library clients and owned by this fixture.
    ({ quizId: sourceQuizId } = await f.admin.call('createQuiz', { title: 'Synthetic immutable quiz', requestId: randomUUID() }));
    await f.db.doc(`events/${f.eventId}`).update({ 'quizAssignment.quizId': sourceQuizId });
    await f.db.doc(`quizSnapshots/${f.snapshotId}`).update({ quizId: sourceQuizId });
    await f.db.doc(`sessions/${f.sessionId}`).update({ quizId: sourceQuizId });
    const names = ['QA Alfa', 'QA Beta — dlouhý název týmu pro kontrolu mobilního pořadí', 'QA Delta', 'QA Gamma'];
    const halfPoints = [[12,12,10],[9,7,10],[5,8,6],[0,4,2]];
    for (let i = 0; i < 4; i++) {
      await f.db.doc(`events/${f.eventId}/registrations/${f.teamIds[i]}`).update({ teamName: names[i] });
      for (let r = 0; r < 3; r++) await f.score(i, r, halfPoints[i][r]);
    }
    await f.startFinal(await f.previewFinal());
    for (let i = 0; i < 4; i++) await f.command('reveal');
    await f.command('table');
    await f.call('endLiveSession', { sessionId: f.sessionId, expectedRevision: (await f.session()).revision });
    // Session END and lifecycle completion are distinct current application operations.
    await f.admin.call('completeEvent', { eventId: f.eventId, expectedRevision: (await f.db.doc(`events/${f.eventId}`).get()).get('revision'), requestId: randomUUID() });
    await readOnlyMember(f);
    await login(page, f);
    await page.goto(`/admin/events/${f.eventId}`);
    await expect(page.getByText('Dokončeno', { exact: true })).toBeVisible();
    const before = await protectedState(f), functions = [];
    page.on('request', request => { if (request.url().includes('/europe-west1/')) functions.push(new URL(request.url()).pathname.split('/').at(-1)); });
    await page.getByRole('link', { name: 'Otevřít konečné výsledky', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/events/${f.eventId}/results$`));
    const table = page.getByRole('table', { name: 'Konečné pořadí' });
    const expected = names.map((name, i) => [`${i + 1}.`, name, ['17','13','9,5','3'][i]]);
    const rows = () => table.locator('tbody tr').evaluateAll(elements => elements.map(row => [...row.children].map(cell => cell.textContent)));
    await expect(table.locator('tbody tr')).toHaveCount(4); expect(await rows()).toEqual(expected);
    await expect(page.getByText('Potvrzené konečné pořadí dokončené akce. Pouze pro čtení.')).toBeVisible();
    await expect(page.locator('main input,main select,main textarea,main button')).toHaveCount(0);
    mkdirSync('.local-data/historical-results', { recursive: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await table.screenshot({ path: '.local-data/historical-results/desktop-table.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(table.getByRole('rowheader', { name: names[1], exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await table.screenshot({ path: '.local-data/historical-results/mobile-table.png' });
    await page.reload(); await expect(table.locator('tbody tr')).toHaveCount(4); expect(await rows()).toEqual(expected);
    expect(await protectedState(f)).toEqual(before);
    // These changes are local emulator fixtures only, after the immutable confirmation.
    await f.db.doc(`quizzes/${sourceQuizId}`).update({ revision: 31, title: 'Later library content' });
    await f.db.doc(`events/${f.eventId}/registrations/${f.teamIds[1]}`).delete();
    await page.reload(); await expect(table.locator('tbody tr')).toHaveCount(4); expect(await rows()).toEqual(expected);
    expect(await protectedState(f)).toEqual(before);
    expect(functions.every(name => name === 'readAccessData')).toBe(true);
    await f.db.doc(`memberships/${f.moderator.uid}`).update({ events: { mode: 'none', ids: [] }, version: 3 });
    await expect(table).toHaveCount(0);
    await expect(page.getByRole('alert')).toContainText('nemáte přístup');
  } finally {
    try {
      if (sourceQuizId) {
        const source = await f.db.doc(`quizzes/${sourceQuizId}`).get();
        if (source.exists) {
          expect(source.get('createdBy') === f.admin.uid).toBe(true);
          await f.db.recursiveDelete(source.ref);
        }
      }
    } finally { await f.close(); }
  }
});

test('live event has no historical shortcut; completed event without confirmation reports unavailable', async ({ page }) => {
  const f = await finalFixture(1);
  try {
    await login(page, f); await page.goto(`/admin/events/${f.eventId}`);
    await expect(page.getByRole('heading', { name: /Upravit akci|Detail akce/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Otevřít konečné výsledky', exact: true })).toHaveCount(0);
    await page.goto(`/admin/events/${f.eventId}/results`);
    await expect(page.getByText('Akce ještě není dokončená. Její průběh otevřete z detailu akce.')).toBeVisible();
    await f.call('endLiveSession', { sessionId: f.sessionId, expectedRevision: (await f.session()).revision });
    // Session END and lifecycle completion are distinct current application operations.
    await f.admin.call('completeEvent', { eventId: f.eventId, expectedRevision: (await f.db.doc(`events/${f.eventId}`).get()).get('revision'), requestId: randomUUID() });
    const before = await protectedState(f);
    await page.reload(); await expect(page.getByText('Konečné výsledky této akce nejsou k dispozici.')).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
    expect(await protectedState(f)).toEqual(before);
  } finally { await f.close(); }
});
