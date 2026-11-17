import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { offlineEventFixture } from './offline-event-fixture.mjs';

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
    await page.getByRole('button', { name: 'Ukončit kvíz', exact: true }).click();
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
    const response = await fetch('http://127.0.0.1:5001/demo-filmovy-kviz-v2/europe-west1/generatePrintArtifact', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + await fixture.user.getIdToken() },
      body: JSON.stringify({ eventId: fixture.eventId, options: { artifactType: 'score-table', disposition: 'inline' } }),
    });
    expect(response.status).toBe(200); expect(Buffer.from(await response.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
    expect((await fixture.identity.db.collection(`events/${fixture.eventId}/scores`).get()).size).toBe(20);
    expect((await fixture.identity.db.collection(`sessions/${sessionId}/finalVersions`).get()).size).toBe(1);
  } finally { await projectionContext?.close(); await fixture.dispose(); }
});
