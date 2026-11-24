import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { offlineEventFixture } from './offline-event-fixture.mjs';

for (const width of [1366, 375]) test(`cancelled scored teams disappear from admin, referee and PDF at ${width}px`, async ({ page, context, browser, baseURL }) => {
  const fixture = await offlineEventFixture();
  let refereeContext;
  const localOnly = target => target.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  try {
    await localOnly(context);
    await page.setViewportSize({ width, height: 900 });
    const roster = await fixture.identity.db.collection(`events/${fixture.eventId}/registrations`).get();
    const before = roster.docs.find(team => team.get('teamName') === 'QA01');
    const during = roster.docs.find(team => team.get('teamName') === 'QA02');
    const rounds = await fixture.identity.db.collection(`quizSnapshots/${fixture.snapshotId}/rounds`).orderBy('position').get();
    for (const team of [before, during]) await fixture.call('saveEventScore', {
      eventId: fixture.eventId, snapshotId: fixture.snapshotId, teamId: team.id, roundId: rounds.docs[0].id,
      expectedRevision: 0, halfPoints: 2, reason: '', requestId: randomUUID(),
    });
    await fixture.call('adminCancelEventRegistration', { eventId: fixture.eventId, registrationId: before.id });
    const grant = await fixture.call('issueRefereeAccess', { eventId: fixture.eventId, requestId: randomUUID(), label: 'Syntetický rozhodčí', expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
    await page.goto('/admin/login');
    await page.getByLabel('E-mail').fill(fixture.identity.email);
    await page.getByLabel('Heslo').fill(fixture.identity.password);
    await page.getByRole('button', { name: 'Přihlásit se', exact: true }).click();
    await expect(page).toHaveURL(/\/admin$/u);
    await page.goto(`/admin/events/${fixture.eventId}/scoring`);
    await expect(page.getByLabel('Body — QA02', { exact: true })).toHaveValue('1');
    await expect(page.getByLabel('Body — QA01', { exact: true })).toHaveCount(0);
    refereeContext = await browser.newContext({ baseURL, viewport: { width, height: 900 } });
    await localOnly(refereeContext);
    const referee = await refereeContext.newPage();
    await referee.goto(`/referee/${fixture.eventId}#access=${grant.accessId}&key=${grant.key}`);
    await expect(referee.getByLabel('Body — QA02', { exact: true })).toHaveValue('1');
    await expect(referee.getByLabel('Body — QA01', { exact: true })).toHaveCount(0);
    const response = await fetch(`http://127.0.0.1:5001/demo-filmovy-kviz-v2/europe-west1/generatePrintArtifact`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + await fixture.user.getIdToken() },
      body: JSON.stringify({ eventId: fixture.eventId, options: { artifactType: 'team-sheets', disposition: 'inline', mode: 'single', teamId: before.id } }),
    });
    expect(response.status).toBe(404);
    await fixture.call('adminCancelEventRegistration', { eventId: fixture.eventId, registrationId: during.id });
    await expect(page.getByLabel('Body — QA02', { exact: true })).toHaveCount(0);
    await expect(referee.getByLabel('Body — QA02', { exact: true })).toHaveCount(0);
    await page.reload(); await referee.reload();
    await expect(page.locator('.round-score-team')).toHaveCount(8);
    await expect(referee.locator('.round-score-team')).toHaveCount(8);
    expect((await fixture.identity.db.collection(`events/${fixture.eventId}/scores`).get()).size).toBe(2);
  } finally {
    await refereeContext?.close();
    await fixture.dispose();
  }
});
