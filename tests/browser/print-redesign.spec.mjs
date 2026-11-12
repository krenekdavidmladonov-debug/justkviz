/* global document, innerWidth, window */
import { test, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { printRedesignFixture } from '../e2e/print-redesign-fixture.mjs';
import { printModeratorIdentity } from '../e2e/print-center-fixture.mjs';
import { requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';

const out = process.env.PRINT_SCREENSHOTS_DIR ?? '.local-data/print-redesign/browser';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function login(page, identity) {
  await page.goto('/admin/login'); await page.getByLabel('E-mail', { exact: true }).fill(identity.email); await page.getByLabel('Heslo', { exact: true }).fill(identity.password);
  await page.getByRole('button', { name: 'Přihlásit se', exact: true }).click(); await expect(page).toHaveURL(/\/admin$/u);
}
async function download(page, filename) {
  const frame = page.getByTitle('Náhled PDF', { exact: true });
  await expect(frame).toBeVisible();
  const link = page.locator('.print-actions a');
  await expect(link).toHaveAttribute('aria-disabled', 'false');
  const url = (await frame.getAttribute('src')).split('#')[0];
  await expect(link).toHaveAttribute('href', url);
  const previewBytes = await page.evaluate(async url => [...new Uint8Array(await (await fetch(url)).arrayBuffer())], url);
  const [file] = await Promise.all([page.waitForEvent('download'), link.click()]); await file.saveAs(out + '/' + filename);
  const bytes = await readFile(out + '/' + filename); expect(digest(bytes)).toBe(digest(Buffer.from(previewBytes)));
  const pdf = await PDFDocument.load(bytes); expect(pdf.getPageCount()).toBeGreaterThan(0);
  return pdf.getPageCount();
}
async function noOverlap(page, selector) {
  const boxes = await page.locator(selector).evaluateAll(nodes => nodes.filter(n => n.getClientRects().length).map(n => { const r = n.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, label: n.textContent?.slice(0, 40) }; }));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j]; expect(Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1, JSON.stringify([a, b])).toBe(false);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

test('event materials use frozen questions, real PDF preview/download and responsive settings', async ({ page, context }) => {
  const fixture = await printRedesignFixture(); let editorQuiz;
  const errors = [], evidence = { realEmulators: true, previewDownloadIdentical: true, sizes: [] };
  await mkdir(out, { recursive: true });
  const failedRequests = [];
  context.on('requestfailed', request => failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
  await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) || /^(blob:|chrome-extension:|chrome:\/\/resources\/)/u.test(route.request().url()) ? route.continue() : route.abort());
  page.on('pageerror', e => errors.push(e.message));
  try {
    await login(page, fixture); await page.goto('/admin/events/' + fixture.eventId);
    await page.getByRole('link', { name: 'Tisk a materiály', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Tiskové centrum', exact: true })).toBeVisible();
    await expect(page.locator('.print-advanced')).not.toHaveAttribute('open');
    await expect(page.getByRole('combobox', { name: 'Barevnost', exact: true })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Všechny přijaté týmy', exact: true })).toBeVisible();
    evidence.standardPages = await download(page, 'event-standard.pdf');
    await page.evaluate(() => window.scrollTo(0, 0));
    const frameBox = await page.getByTitle('Náhled PDF', { exact: true }).boundingBox();
    expect(frameBox).not.toBeNull();
    expect(frameBox.y).toBeLessThan(750);
    await page.waitForTimeout(750);
    await page.screenshot({ path: out + '/center-desktop-above-fold.png', mask: [page.locator('.admin-account > strong')] });
    await page.screenshot({ path: out + '/center-desktop.png', fullPage: true, mask: [page.locator('.admin-account > strong')] });
    await page.getByTitle('Náhled PDF', { exact: true }).scrollIntoViewIfNeeded();
    // Native PDF guests paint outside the DOM; this delay is for the screenshot only.
    await page.waitForTimeout(750);
    await page.screenshot({ path: out + '/center-visible-preview.png', mask: [page.locator('.admin-account > strong')] });
    expect(failedRequests.filter(request => /^(chrome:|chrome-extension:)/u.test(request.url))).toEqual([]);
    await writeFile(out + '/preview-diagnostics.json', JSON.stringify({ failedRequests, frames: await Promise.all(page.frames().map(async frame => ({ url: frame.url(), html: (await frame.content()).slice(0, 2000) }))) }, null, 2));
    const frozen = await fixture.snapshotData();
    await page.locator('.print-advanced > summary').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.print-advanced')).toHaveAttribute('open');
    await page.getByRole('combobox', { name: 'Šablona', exact: true }).selectOption('compact');
    await page.getByRole('combobox', { name: 'Barevnost', exact: true }).selectOption('grayscale');
    evidence.compactPages = await download(page, 'event-compact-grayscale.pdf');
    expect(await fixture.snapshotData()).toEqual(frozen);
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 }); await noOverlap(page, '.print-advanced .form-field, .print-advanced fieldset');
      await page.locator('.print-advanced').screenshot({ path: out + '/settings-' + width + '.png' }); evidence.sizes.push(width);
    }
    await page.locator('.print-advanced > summary').click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: out + '/center-mobile.png', fullPage: true });
    await page.getByRole('link', { name: 'Přejít k náhledu ↓', exact: true }).click();
    await expect(page).toHaveURL(/#print-document-preview$/u);
    await expect.poll(async () => (await page.locator('#print-document-preview').boundingBox())?.y).toBeLessThan(250);
    await page.waitForTimeout(750);
    await page.screenshot({ path: out + '/center-mobile-visible-preview.png' });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: /^Hrací arch se správnými odpověďmi/u }).click();
    await expect(page.getByTitle('Náhled PDF', { exact: true })).toHaveCount(0);
    await expect(page.locator('.print-actions a')).not.toHaveAttribute('href');
    await page.getByRole('button', { name: 'Otevřít dokument se správnými odpověďmi', exact: true }).click();
    await download(page, 'event-organizer.pdf');
    await page.getByRole('button', { name: /^Klíč správných odpovědí/u }).click();
    await expect(page.getByTitle('Náhled PDF', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Otevřít dokument se správnými odpověďmi', exact: true }).click();
    await download(page, 'event-key.pdf');
    await page.getByRole('button', { name: /^Bodovací tabulka/u }).click(); await download(page, 'event-score.pdf');
    editorQuiz = (await fixture.call('createQuiz', { requestId: randomUUID(), title: 'Syntetický tiskový vzhled' })).quizId;
    await page.goto('/admin/quizzes/' + editorQuiz + '/edit'); await page.getByText('Tiskové materiály', { exact: true }).click();
    const sample = page.locator('.print-editor-preview img');
    await expect(sample).toHaveAttribute('src', '/print-samples/player-standard.png');
    await expect(page.getByRole('link', { name: 'Zvětšit ukázku', exact: true })).toHaveAttribute('href', '/print-samples/player-standard.png');
    await expect(sample).toBeVisible();
    await expect.poll(() => sample.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
    await page.getByRole('combobox', { name: 'Šablona odpovědních archů', exact: true }).selectOption('compact');
    await expect(sample).toHaveAttribute('src', '/print-samples/player-compact.png');
    await expect(page.getByRole('link', { name: 'Zvětšit ukázku', exact: true })).toHaveAttribute('href', '/print-samples/player-compact.png');
    await page.getByRole('button', { name: 'Správné odpovědi', exact: true }).click();
    await expect(sample).toHaveAttribute('src', '/print-samples/organizer.png');
    await page.getByRole('button', { name: 'Bodovací tabulka', exact: true }).click();
    await expect(sample).toHaveAttribute('src', '/print-samples/score.png');
    await page.getByRole('button', { name: 'Hráčský arch', exact: true }).click();
    await expect(sample).toHaveAttribute('src', '/print-samples/player-compact.png');
    await expect(page.locator('.print-template-settings details')).toHaveCount(0);
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await noOverlap(page, '.print-template-settings .form-field');
      const labelSafe = await page.locator('.print-template-settings .form-field').evaluateAll(nodes => nodes.every(n => { const label = n.querySelector('span'), input = n.querySelector('input,textarea,select'); return !label || !input || label.getBoundingClientRect().bottom <= input.getBoundingClientRect().top + 1; }));
      expect(labelSafe).toBe(true);
      await page.locator('.print-template-settings').screenshot({ path: out + '/editor-settings-' + width + '.png' });
    }
    expect(errors).toEqual([]); await writeFile(out + '/evidence.json', JSON.stringify(evidence, null, 2));
  } finally { if (editorQuiz) await fixture.db.recursiveDelete(fixture.db.doc('quizzes/' + editorQuiz)); await fixture.dispose(); }
});

test('real endpoint denies anonymous and non-answer staff; server failure removes old preview', async ({ page, context }) => {
  const fixture = await printRedesignFixture(), moderator = await printModeratorIdentity();
  const { projectId, authEndpoint, functionsEndpoint } = requireFullEmulatorEnvironment(process.env, 'Print denial checks');
  const endpoint = `http://${functionsEndpoint.host}:${functionsEndpoint.port}/${projectId}/europe-west1/generatePrintArtifact`;
  const body = { eventId: fixture.eventId, options: { artifactType: 'answer-key', disposition: 'inline' } };
  try {
    expect((await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).status).toBe(401);
    const auth = await (await fetch(`http://${authEndpoint.host}:${authEndpoint.port}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: moderator.email, password: moderator.password, returnSecureToken: true }) })).json();
    expect((await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + auth.idToken }, body: JSON.stringify(body) })).status).toBe(403);
    const organizerBody = { eventId: fixture.eventId, options: { artifactType: 'organizer-sheets', disposition: 'inline' } };
    const requestOrganizer = () => fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + auth.idToken }, body: JSON.stringify(organizerBody) });
    expect((await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(organizerBody) })).status).toBe(401);
    expect((await requestOrganizer()).status).toBe(403);
    const member = moderator.db.doc('memberships/' + auth.localId), original = (await member.get()).data();
    const required = ['event.export', 'event.answers.read', 'event.answers.export'];
    try {
      for (const missing of required) {
        await member.set({ ...original, permissions: required.filter(permission => permission !== missing), events: { mode: 'selected', ids: [fixture.eventId] } });
        expect((await requestOrganizer()).status, 'missing ' + missing).toBe(403);
      }
      await member.set({ ...original, permissions: required, events: { mode: 'selected', ids: ['different-event'] } });
      expect((await requestOrganizer()).status).toBe(403);
      await member.set({ ...original, status: 'disabled', permissions: required });
      expect((await requestOrganizer()).status).toBe(403);
      await member.delete(); expect((await requestOrganizer()).status).toBe(403);
      await member.set({ ...original, permissions: required, events: { mode: 'selected', ids: [fixture.eventId] } });
      const permitted = await requestOrganizer(); expect(permitted.status).toBe(200); expect(permitted.headers.get('content-type')).toContain('application/pdf');
      await fixture.db.doc('quizSnapshots/' + fixture.snapshotId).update({ eventId: 'different-event' });
      expect((await requestOrganizer()).status).toBe(409);
    } finally {
      await member.set(original); await fixture.db.doc('quizSnapshots/' + fixture.snapshotId).update({ eventId: fixture.eventId });
    }
    // Grayscale has no raster-logo dependency, while color keeps the ownership guard.
    const snapshot = fixture.db.doc('quizSnapshots/' + fixture.snapshotId);
    await snapshot.update({ printTemplate: { logoImage: 'https://invalid.example.test/logo.png' } });
    for (const [colorMode, status] of [['grayscale', 200], ['color', 422]]) {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + auth.idToken }, body: JSON.stringify({ eventId: fixture.eventId, options: { artifactType: 'team-sheets', disposition: 'inline', mode: 'generic', colorMode } }) });
      expect(response.status).toBe(status);
      if (status === 200) expect(response.headers.get('content-type')).toContain('application/pdf');
    }
    await snapshot.update({ printTemplate: {} });
    await login(page, moderator); await page.goto('/admin/events/' + fixture.eventId + '/print');
    await expect(page.getByRole('button', { name: /^Klíč správných odpovědí/u })).toBeDisabled();
    await expect(page.getByRole('button', { name: /^Hrací arch se správnými odpověďmi/u })).toBeDisabled();
    await expect(page.getByTitle('Náhled PDF', { exact: true })).toBeVisible();
    // Error path deliberately injects only an HTTP failure, never substitutes successful PDF transport.
    await context.route('**/generatePrintArtifact', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Syntetická nedostupnost serveru' }) }));
    await page.getByRole('button', { name: /^Bodovací tabulka/u }).click();
    await expect(page.getByRole('alert')).toContainText('PDF se nepodařilo');
    await expect(page.getByTitle('Náhled PDF', { exact: true })).toHaveCount(0);
    await expect(page.locator('.print-actions a')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator('.print-actions a')).not.toHaveAttribute('href');
    await context.unroute('**/generatePrintArtifact'); await page.getByRole('button', { name: 'Zkusit znovu', exact: true }).click(); await expect(page.getByTitle('Náhled PDF', { exact: true })).toBeVisible();
  } finally { await moderator.dispose(); await fixture.dispose(); }
});
