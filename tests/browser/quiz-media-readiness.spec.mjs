import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';
import { mediaFixture, syntheticImage } from '../e2e/media-fixture.mjs';
import { collectPreflightMedia, runQuizPreflight } from '../../packages/quiz-domain/lib/index.js';
import { requireFullEmulatorEnvironment, localEmulatorEndpoint } from '../../tools/local-emulator-environment.mjs';

function image(width) { const value = new PNG({ width, height: 2 }); value.data.fill(255); return PNG.sync.write(value); }

test('advisory readiness checks actual image widths only on demand and preserves redacted answer authority', async ({ page, context }) => {
  const environment = requireFullEmulatorEnvironment(process.env, 'Media readiness browser');
  const storage = localEmulatorEndpoint(process.env.FIREBASE_STORAGE_EMULATOR_HOST, 'Media readiness Storage');
  if (environment.projectId !== 'demo-filmovy-kviz-v2' || environment.authEndpoint.port !== 9599 || environment.firestoreEndpoint.port !== 8580
    || environment.functionsEndpoint.port !== 5501 || storage.port !== 9699) throw new Error('Readiness requires its dedicated loopback demo emulators.');
  const fixture = await mediaFixture();
  const external = 'https://assets.example.test/%C5%BDelva.png', drive = 'https://drive.google.com/file/d/synthetic-readiness/view';
  const externalRequests = [];
  try {
    const owned = await fixture.upload('image', syntheticImage(), 'image/png');
    await fixture.update('image', { questionImage: external, backgroundImage: drive, answerImage: owned.reference, correctAnswer: 'Želva' });
    const limited = await fixture.roleClient('moderator');
    const membership = fixture.db.doc('memberships/' + limited.auth.currentUser.uid), original = (await membership.get()).data();
    await membership.update({ permissions: original.permissions.filter(permission => permission !== 'quiz.answers.read'), version: original.version + 1 });
    const redacted = await limited.call('readAccessData', { operation: 'editor', quizId: fixture.quizId });
    expect(redacted.slides.every(slide => slide.correctAnswer === '' && slide.answerImage === '')).toBe(true);
    expect(collectPreflightMedia(redacted).some(use => use.source === owned.reference)).toBe(false);
    expect(runQuizPreflight(redacted).issues.some(issue => issue.code === 'IMAGE_URL_ANSWER_HINT')).toBe(false);
    expect((await fixture.read(owned.reference, { who: limited })).status).toBe(404);

    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (['127.0.0.1', 'localhost'].includes(url.hostname)) return route.continue();
      if (route.request().url() === external || route.request().url() === drive) {
        externalRequests.push(route.request().url());
        return route.fulfill({ contentType: 'image/png', body: image(route.request().url() === external ? 799 : 800) });
      }
      return route.abort('blockedbyclient');
    });
    await page.goto('/admin/login');
    await page.getByLabel('E-mail').fill(fixture.loginEmail);
    await page.getByLabel('Heslo').fill(fixture.loginPassword);
    await page.getByRole('button', { name: 'Přihlásit se' }).click();
    await expect(page).toHaveURL(/\/admin$/u);
    await page.goto('/admin/quizzes/' + fixture.quizId + '/readiness');
    const panel = page.locator('.quiz-preflight-panel');
    await expect(panel).toContainText('Neověřené obrázky: 3 z 3');
    await expect(panel).toContainText('YouTube 1, Google Drive 1, ostatní externí odkazy 1');
    await expect(panel.locator('[data-issue-code="IMAGE_URL_ANSWER_HINT"]')).toHaveCount(1);
    expect(externalRequests).toHaveLength(0);
    expect(await panel.innerText()).not.toContain('Želva');
    expect(await panel.innerText()).not.toContain(external);
    await expect(page.getByRole('button', { name: 'Spustit kvíz', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Ověřit rozlišení obrázků' }).click();
    await expect(panel).toContainText('Neověřené obrázky: 0 z 3');
    await expect(panel).toContainText('Obrázky pod 800 px na šířku: 2');
    await expect(panel.locator('[data-issue-code="IMAGE_WIDTH_SMALL"]')).toHaveCount(2);
    expect(externalRequests).toHaveLength(2);
    await expect(page.getByRole('button', { name: 'Spustit kvíz', exact: true })).toBeEnabled();
    expect((await fixture.quizRef.collection('slides').doc(fixture.ids.image).get()).get('questionImage')).toBe(external);
  } finally { await fixture.dispose(); }
});
