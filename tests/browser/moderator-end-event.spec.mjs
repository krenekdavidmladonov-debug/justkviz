import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { offlineEventFixture } from './offline-event-fixture.mjs';
import { finalFixture } from '../e2e/final-reveal-fixture.mjs';

for (const width of [1366, 375]) test(`full quiz end retains history and PDF at ${width}px${width === 375 ? ' with lost response' : ''}`, async ({ page, context, browser, baseURL }) => {
  const fixture = await offlineEventFixture();
  let projectionContext;
  const localOnly = target => target.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  try {
    await localOnly(context); await page.setViewportSize({ width, height: 900 });
    const roster = await fixture.identity.db.collection(`events/${fixture.eventId}/registrations`).get();
    const rounds = await fixture.identity.db.collection(`quizSnapshots/${fixture.snapshotId}/rounds`).get();
    for (const round of rounds.docs) await fixture.call('saveEventScore', { eventId: fixture.eventId, snapshotId: fixture.snapshotId,
      roundId: round.id, requestId: randomUUID(), scores: roster.docs.map(team => ({ teamId: team.id, expectedRevision: 0, halfPoints: 2, reason: '' })) });
    const { sessionId } = await fixture.call('createEventLiveSession', { eventId: fixture.eventId, expectedRevision: (await fixture.event()).revision });
    await fixture.call('goToSlide', { sessionId, expectedRevision: 0, position: 1 });
    const preview = await fixture.call('previewFinalResults', { eventId: fixture.eventId, sessionId });
    await fixture.call('controlFinalReveal', { eventId: fixture.eventId, sessionId, action: 'start', requestId: randomUUID(), expectedRevision: preview.sessionRevision,
      versionId: preview.publishedVersionId, sourceFingerprint: preview.sourceFingerprint });
    await page.goto('/admin/login'); await page.getByLabel('E-mail').fill(fixture.identity.email); await page.getByLabel('Heslo').fill(fixture.identity.password);
    await page.getByRole('button', { name: 'Přihlásit se', exact: true }).click(); await expect(page).toHaveURL(/\/admin$/u);
    projectionContext = await browser.newContext({ baseURL, viewport: { width: 1366, height: 768 } }); await localOnly(projectionContext);
    const projector = await projectionContext.newPage(); await projector.goto('/projector/' + sessionId);
    await page.goto('/admin/live/' + sessionId); await expect(page.locator('.live-control')).toBeVisible();
    if (width === 375) await page.route('**/endLiveSession', async route => { await route.fetch(); await route.abort('failed'); });
    await page.locator('.live-danger-area summary').click();
    await page.getByRole('button', { name: 'Dokončit akci a ukončit kvíz', exact: true }).click();
    await expect.poll(async () => (await fixture.event()).lifecycleStatus).toBe('completed');
    await expect(page.locator('.live-progress')).toContainText('Ukončeno');
    await expect.poll(async () => (await fixture.identity.db.doc('publicSessions/' + sessionId).get()).get('status')).toBe('ended');
    await expect(projector.getByRole('heading', { name: 'Kvíz skončil', exact: true })).toBeVisible();
    await page.reload(); await expect(page.locator('.live-progress')).toContainText('Ukončeno');
    await page.goto('/admin/events');
    const detail = page.locator(`a[href="/admin/events/${fixture.eventId}"]`);
    await expect(detail).toHaveCount(0);
    await page.getByRole('button', { name: /^Dokončené \(/u }).click(); await expect(detail).toBeVisible();
    await page.goto(`/admin/events/${fixture.eventId}/results`);
    await expect(page.getByText('QA01', { exact: true })).toBeVisible();
    const response = await fetch('http://' + fixture.environment.functionsEndpoint.host + ':' + fixture.environment.functionsEndpoint.port + '/' + fixture.environment.projectId + '/europe-west1/generatePrintArtifact', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + await fixture.user.getIdToken() },
      body: JSON.stringify({ eventId: fixture.eventId, options: { artifactType: 'score-table', disposition: 'inline' } }),
    });
    expect(response.status).toBe(200); expect(Buffer.from(await response.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
    expect((await fixture.identity.db.collection(`events/${fixture.eventId}/scores`).get()).size).toBe(20);
    expect((await fixture.identity.db.collection(`sessions/${sessionId}/finalVersions`).get()).size).toBe(1);
  } finally { await projectionContext?.close(); await fixture.dispose(); }
});

for (const width of [1366, 375]) test(`standard moderator ends only the quiz at ${width}px`, async ({ page, context, browser, baseURL }) => {
  const fixture = await finalFixture(4);
  let projectionContext;
  const localOnly = target => target.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  try {
    await localOnly(context); await page.setViewportSize({ width, height: 900 });
    await fixture.startFinal(await fixture.previewFinal());
    const eventRef = fixture.db.doc('events/' + fixture.eventId);
    const before = (await eventRef.get()).data();
    const session = await fixture.session();
    const member = (await fixture.db.doc('memberships/' + fixture.moderator.uid).get()).data();
    expect(member.permissions).toContain('event.live');
    expect(member.permissions).not.toContain('event.manage');
    await expect(fixture.call('endLiveSession', { sessionId: fixture.sessionId, expectedRevision: session.revision, completeEvent: true })).rejects.toMatchObject({ code: 'functions/permission-denied' });
    await page.goto('/admin/login'); await page.getByLabel('E-mail').fill(fixture.login.email); await page.getByLabel('Heslo').fill(fixture.login.password);
    await page.getByRole('button', { name: 'Přihlásit se', exact: true }).click(); await expect(page).toHaveURL(/\/admin$/u);
    projectionContext = await browser.newContext({ baseURL, viewport: { width: 1366, height: 768 } }); await localOnly(projectionContext);
    const projector = await projectionContext.newPage(); await projector.goto('/projector/' + fixture.sessionId);
    await page.goto('/admin/live/' + fixture.sessionId); await expect(page.locator('.live-control')).toBeVisible();
    await page.locator('.live-danger-area summary').click();
    await expect(page.getByText('Akci dokončí správce', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dokončit akci a ukončit kvíz', exact: true })).toHaveCount(0);
    const [response] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/endLiveSession') && response.request().method() === 'POST'),
      page.getByRole('button', { name: 'Ukončit kvíz', exact: true }).click(),
    ]);
    expect(response.status()).toBe(200);
    expect(response.request().postDataJSON().data.completeEvent).toBeUndefined();
    await expect(page.locator('.live-progress')).toContainText('Ukončeno');
    await expect(projector.getByRole('heading', { name: 'Kvíz skončil', exact: true })).toBeVisible();
    expect((await eventRef.get()).data()).toEqual(before);
    await page.reload(); await expect(page.locator('.live-progress')).toContainText('Ukončeno');
    expect((await eventRef.get()).data()).toEqual(before);
  } finally { await projectionContext?.close(); await fixture.close(); }
});
