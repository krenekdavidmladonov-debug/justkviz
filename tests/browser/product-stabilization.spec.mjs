import { test, expect } from '@playwright/test';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { PDFDocument } from 'pdf-lib';
import { editorIdentity } from '../e2e/editor-identity.mjs';
import { mediaSlide, syntheticImage, syntheticAudio } from '../e2e/media-fixture.mjs';
import { requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';

const output = process.env.PRODUCT_QA_OUTPUT || '.local-data/product-stabilization/integration';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function localOnly(context, baseURL) {
  const origin = new URL(baseURL).origin;
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    const localHttp = ['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1'].includes(url.hostname);
    const ownBlob = url.protocol === 'blob:' && url.origin === origin;
    // Observed built-in Chromium PDF guest, not an external website or arbitrary extension.
    const pdfViewer = url.protocol === 'chrome-extension:' && url.hostname === 'mhjfbmdgcfjbbpaeojofohoefgiehjai';
    const pdfResources = url.protocol === 'chrome:' && url.hostname === 'resources';
    return localHttp || ownBlob || pdfViewer || pdfResources ? route.continue() : route.abort();
  });
  await context.route('**/stabilization.png', route => route.fulfill({ contentType: 'image/png', body: syntheticImage() }));
  await context.route('**/stabilization.wav', route => route.fulfill({ contentType: 'audio/wav', body: syntheticAudio(5) }));
  const video = await readFile('tests/fixtures/media/synthetic.webm');
  await context.route('**/stabilization.webm', route => route.fulfill({ contentType: 'video/webm', body: video }));
}
async function openEditorRounds(page) {
  await page.locator('.outline-round').first().waitFor();
  const collapsed = page.locator('.outline-collapse[aria-expanded=false]');
  while (await collapsed.count()) await collapsed.first().click();
}
async function removeOwnTree(reference, deadline) {
  if (Date.now() > deadline) throw new Error('Own fixture cleanup deadline exceeded');
  for (const collection of await reference.listCollections()) {
    for (const document of (await collection.get()).docs) await removeOwnTree(document.ref, deadline);
  }
  await reference.delete();
}

test('one complete evening: saved editor, registration, real materials, media, SHOW and persisted history', async ({ page, context, browser, baseURL }) => {
  requireFullEmulatorEnvironment(process.env, 'Product stabilization integration');
  expect(['localhost', '127.0.0.1']).toContain(new URL(baseURL).hostname);
  expect(process.env.REGISTRATION_EMAIL_MODE).toBe('off');
  const identity = await editorIdentity(), suffix = randomUUID().slice(0, 8);
  const answer = 'PRIVATE_STABILIZATION_' + suffix, teamName = 'Žluťoučcí filmoví znalci ' + suffix;
  let quizId, eventId, snapshotId, sessionId, audience;
  let phase = 'fixture', bodyPassed = false;
  const phases = [], errors = [], pdfs = [], publicRequests = [];
  const checkpoint = name => { phase = name; phases.push({ name, at: new Date().toISOString() }); };
  const quiz = async () => (await identity.db.doc('quizzes/' + quizId).get()).data();
  const slides = async () => (await identity.db.collection('quizzes/' + quizId + '/slides').orderBy('position').get()).docs.map(d => ({ id: d.id, ...d.data() }));
  const event = async () => (await identity.db.doc('events/' + eventId).get()).data();
  const session = async () => (await identity.db.doc('sessions/' + sessionId).get()).data();
  const published = async () => (await identity.db.doc('publicSessions/' + sessionId).get()).data();
  const save = async () => {
    await page.getByRole('button', { name: 'Uložit vše', exact: true }).click();
    await expect(page.locator('.save-state')).toHaveText('Uloženo');
  };
  async function downloadPdf(kind, previousSource) {
    const frame = page.getByTitle('Náhled PDF', { exact: true });
    if (previousSource) await expect(frame).not.toHaveAttribute('src', previousSource);
    await expect(frame).toHaveAttribute('src', /^blob:/);
    const link = page.getByRole('link', { name: kind === 'answer-key' ? 'Stáhnout PDF se správnými odpověďmi' : 'Stáhnout PDF', exact: true });
    await expect(link).toHaveAttribute('href', (await frame.getAttribute('src')).split('#')[0]);
    const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
    const file = output + '/' + kind + '.pdf';
    await download.saveAs(file); expect(await download.failure()).toBeNull();
    const bytes = await readFile(file), pdf = await PDFDocument.load(bytes);
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.getPageCount()).toBeGreaterThan(0);
    for (const sheet of pdf.getPages()) {
      expect(Math.min(sheet.getWidth(), sheet.getHeight())).toBeCloseTo(595.28, 1);
      expect(Math.max(sheet.getWidth(), sheet.getHeight())).toBeCloseTo(841.89, 1);
    }
    const text = execFileSync(process.env.PRODUCT_QA_PYTHON || 'python', ['-c', 'from pypdf import PdfReader; import sys; print("\\n".join(p.extract_text() or "" for p in PdfReader(sys.argv[1]).pages))', file], { encoding: 'utf8', windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    // Latin-ext font runs may insert line breaks between otherwise contiguous Czech letters.
    const normalized = text.replace(/\s/gu, ''), normalizedTeam = teamName.replace(/\s/gu, '');
    if (kind === 'team-sheets') { expect(normalized).toContain(normalizedTeam); expect(normalized).not.toContain(answer); expect(normalized).not.toContain('PRIVATE_'); }
    if (kind === 'answer-key') expect(normalized).toContain(answer);
    pdfs.push({ kind, pages: pdf.getPageCount(), sha256: hash(bytes), actualDownload: true, textChecked: true });
  }
  try {
    await mkdir(output, { recursive: true }); await localOnly(context, baseURL);
    page.on('pageerror', error => errors.push({ surface: 'admin', message: error.message }));
    quizId = (await identity.call('createQuiz', { title: 'Vydání · filmový večer ' + suffix, requestId: randomUUID() })).quizId;
    const add = async (kind, extra, position) => identity.call('createQuizSlide', {
      quizId, expectedRevision: (await quiz()).revision, position: position ?? (await slides()).length + 1,
      ...(['intro', 'rules', 'end'].includes(kind) ? { scope: 'quiz' } : {}), slide: mediaSlide(kind, extra),
    });
    await add('intro', { title: 'Filmový večer', text: 'Začínáme společně.' });
    await add('rules', { title: 'Pravidla', options: ['Odpovědi pište čitelně.'] });
    await identity.call('createQuizRound', { quizId, expectedRevision: (await quiz()).revision, title: 'Světové příběhy' });
    for (const kind of ['free', 'image', 'audio', 'video']) await add(kind, {
      title: '', text: 'Otázka ' + kind, correctAnswer: answer, authoringStatus: 'ready', answerMode: 'open',
      questionImage: kind === 'image' ? baseURL + '/stabilization.png' : '',
      mediaSource: kind === 'audio' ? baseURL + '/stabilization.wav' : kind === 'video' ? baseURL + '/stabilization.webm' : '',
      clipStartSeconds: ['audio', 'video'].includes(kind) ? 0 : null, clipEndSeconds: ['audio', 'video'].includes(kind) ? 4 : null,
    }, (await slides()).find(s => s.kind === 'recap').position);
    await identity.call('createQuizRound', { quizId, expectedRevision: (await quiz()).revision, title: 'České vzpomínky' });
    await add('free', { title: '', text: 'Druhé kolo', correctAnswer: answer, authoringStatus: 'ready', answerMode: 'open' }, (await slides()).filter(s => s.kind === 'recap').at(-1).position);
    await add('end', { title: 'Děkujeme', text: 'Potlesk všem týmům.' });

    checkpoint('editor actual save and reload');
    await page.goto('/admin/login'); await page.getByLabel('E-mail').fill(identity.email); await page.getByLabel('Heslo').fill(identity.password);
    await page.getByRole('button', { name: 'Přihlásit se', exact: true }).click(); await expect(page).toHaveURL(/\/admin$/);
    await page.goto('/admin/quizzes/' + quizId + '/edit'); await openEditorRounds(page); await expect(page.locator('.outline-question')).toHaveCount(5);
    await page.locator('.outline-question').filter({ hasText: 'Otázka free' }).click();
    await page.getByLabel('Otázka *', { exact: true }).fill('Uložená otázka s diakritikou'); await save();
    await page.reload(); await openEditorRounds(page); await page.locator('.outline-question').filter({ hasText: 'Uložená otázka s diakritikou' }).click();
    await expect(page.getByLabel('Otázka *', { exact: true })).toHaveValue('Uložená otázka s diakritikou');
    expect((await slides()).find(s => s.text === 'Uložená otázka s diakritikou').correctAnswer).toBe(answer);

    checkpoint('own event and frozen quiz');
    eventId = (await identity.call('createEvent', { expectedRevision: 0, event: {
      title: 'Filmový večer ' + suffix, startsAt: '2031-11-20T18:00:00Z', timeZone: 'Europe/Prague', venue: { name: 'Syntetický sál', publicLocation: 'Praha' },
      teamCapacity: 10, peopleCapacity: 40, teamSizeMin: 2, teamSizeMax: 4,
    } })).eventId;
    await identity.call('configureEventRegistration', { eventId, expectedRevision: (await event()).revision, published: true, registrationOpensAt: '2020-01-01T00:00:00Z', registrationClosesAt: '2030-01-01T00:00:00Z' });
    await identity.call('lockEventQuiz', { eventId, quizId, expectedRevision: (await event()).revision, expectedQuizRevision: (await quiz()).revision, acknowledgeWarnings: true });
    snapshotId = (await event()).quizAssignment.snapshotId;
    expect((await identity.db.collection('quizSnapshots/' + snapshotId + '/slides').where('text', '==', 'Uložená otázka s diakritikou').get()).size).toBe(1);

    checkpoint('one actual public registration, email off');
    audience = await browser.newContext({ baseURL }); await localOnly(audience, baseURL); const player = await audience.newPage();
    await player.goto('/events/' + eventId);
    const registration = player.getByRole('region', { name: 'Přihlásit tým', exact: true });
    await expect(registration).toBeVisible();
    await expect(registration.getByText('Registrace otevřené', { exact: true })).toBeVisible();
    await expect(registration.getByRole('button', { name: 'Přihlásit tým', exact: true })).toBeEnabled();
    await player.getByLabel('Název týmu').fill(teamName); await player.getByLabel('Počet členů').fill('3');
    await player.getByLabel('E-mail').fill('stabilization-' + suffix + '@example.test');
    await player.getByRole('button', { name: 'Přihlásit tým', exact: true }).click();
    await expect(player.getByRole('heading', { name: 'Děkujeme, tým byl přihlášen.', exact: true })).toBeVisible();
    const registered = (await identity.db.collection('events/' + eventId + '/registrations').get()).docs;
    expect(registered).toHaveLength(1); expect(registered[0].get('teamName')).toBe(teamName);
    const second = await identity.call('adminAddEventTeam', { eventId, requestId: randomUUID(), teamName: 'Druhá klapka', memberCount: 2 });
    const teamIds = [registered[0].id, second.registrationId];
    await player.goto('about:blank'); // Do not retain a capability-bearing registration confirmation during later diagnostics.

    checkpoint('event materials actual downloaded PDFs');
    await page.goto('/admin/events/' + eventId); await expect(page.getByRole('heading', { name: 'Tisk a materiály', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Otevřít tisk a materiály', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Tiskové centrum', exact: true })).toBeVisible();
    await expect(page.getByText('Přijaté týmy: 2', { exact: true })).toBeVisible();
    await expect(page.locator('.print-advanced')).not.toHaveAttribute('open'); await downloadPdf('team-sheets');
    for (const width of [1920, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1080 });
      await page.getByTitle('Náhled PDF', { exact: true }).scrollIntoViewIfNeeded();
      await expect.poll(() => page.frames().some(frame => frame.url().startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/'))).toBe(true);
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    let previousPdf = await page.getByTitle('Náhled PDF', { exact: true }).getAttribute('src');
    await page.getByRole('button', { name: /^Bodovací tabulka/ }).click(); await downloadPdf('score-table', previousPdf);
    previousPdf = await page.getByTitle('Náhled PDF', { exact: true }).getAttribute('src');
    await page.getByRole('button', { name: /^Klíč správných odpovědí/ }).click();
    await expect(page.getByTitle('Náhled PDF', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Otevřít dokument se správnými odpověďmi', exact: true }).click();
    await downloadPdf('answer-key', previousPdf);

    checkpoint('moderation media and explicit answer publication');
    sessionId = (await identity.call('createEventLiveSession', { eventId, expectedRevision: (await event()).revision })).sessionId;
    await page.goto('/admin/live/' + sessionId); await expect(page.locator('.live-control')).toBeVisible();
    const projector = await audience.newPage(); projector.on('request', request => publicRequests.push(request.url()));
    projector.on('pageerror', error => errors.push({ surface: 'projector', message: error.message })); await projector.goto('/projector/' + sessionId);
    const frozen = (await identity.db.collection('quizSnapshots/' + snapshotId + '/slides').orderBy('position').get()).docs.map(d => ({ id: d.id, ...d.data() }));
    const navigate = async kind => { const slide = frozen.find(s => s.kind === kind); await identity.call('goToSlide', { sessionId, expectedRevision: (await session()).revision, position: slide.position }); await expect(page.locator('.live-control')).toHaveAttribute('data-current-position', String(slide.position)); };
    for (const kind of ['audio', 'video']) {
      await navigate(kind); await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled(); await projector.locator('body').click({ position: { x: 10, y: 10 } });
      await page.getByRole('button', { name: 'Play', exact: true }).click();
      const media = kind === 'audio' ? page.locator('.moderator-audio-player audio') : projector.locator('video');
      await expect.poll(() => media.evaluate(element => element.currentTime)).toBeGreaterThan(0.2);
      await page.getByRole('button', { name: 'Stop', exact: true }).click(); await expect.poll(async () => (await session()).mediaCommand).toBe('stop');
      await expect.poll(() => media.evaluate(element => element.paused)).toBe(true);
      if (kind === 'video') {
        await expect(projector.locator('.video-media-frame')).toHaveAttribute('aria-hidden', 'true');
        await expect(projector.locator('.video-question-copy')).toBeVisible();
        await expect(projector.locator('video,audio,iframe')).toHaveCount(1);
      }
    }
    await navigate('image'); expect(JSON.stringify(await published())).not.toContain(answer);
    expect(JSON.stringify(await published())).not.toContain('correctAnswer');
    await page.getByRole('button', { name: 'Odhalit odpověď', exact: true }).click(); await expect(projector.getByText(answer, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Skrýt odpověď', exact: true }).click(); await expect.poll(async () => JSON.stringify(await published()).includes(answer)).toBe(false);

    checkpoint('score, SHOW publication, finale and history');
    const rounds = (await identity.db.collection('quizSnapshots/' + snapshotId + '/rounds').orderBy('position').get()).docs;
    for (let index = 0; index < teamIds.length; index++) for (const round of rounds) await identity.call('saveEventScore', { eventId, snapshotId, teamId: teamIds[index], roundId: round.id, expectedRevision: 0, halfPoints: index === 0 ? 6 : 2, reason: '', requestId: randomUUID() });
    const results = page.getByRole('region', { name: 'Výsledky akce', exact: true });
    await expect(results).toBeVisible();
    expect((await published()).interimResults).toBeUndefined();
    await expect(projector.locator('.sm-scene-interim')).toHaveCount(0);
    await results.getByRole('button', { name: 'Průběžné výsledky', exact: true }).click();
    await expect(projector.locator('.sm-scene-interim .sm-table .sm-row')).toHaveCount(2);
    expect((await published()).interimResults.presentationStyle).toBe('show');
    await results.getByRole('button', { name: 'Zavřít průběžné výsledky', exact: true }).click();
    await expect.poll(async () => Boolean((await published()).interimResults)).toBe(false);
    await expect(results.getByRole('button', { name: 'Průběžné výsledky', exact: true })).toBeEnabled();
    await expect(projector.locator('.slide-renderer')).toBeVisible();
    // The current UI offers a sample-only rehearsal, not the removed real-data preview panel.
    const beforeDemo = await published();
    expect(beforeDemo.finalReveal).toBeUndefined();
    await results.getByRole('button', { name: 'Náhled závěrečné show', exact: true }).click();
    const demo = page.getByRole('dialog', { name: 'Ukázka finální show', exact: true });
    await expect(demo).toBeVisible();
    expect(await published()).toEqual(beforeDemo);
    await demo.getByRole('button', { name: 'Zavřít náhled', exact: true }).click();
    await page.getByRole('button', { name: 'Přejít na otázku', exact: true }).click();
    await page.getByRole('dialog', { name: 'Přejít na otázku', exact: true }).getByRole('button', { name: 'Finální výsledky', exact: true }).click();
    await expect(projector.locator('.sm-intro')).toBeVisible();
    for (const rank of [2, 1]) {
      await results.getByRole('button', { name: 'Odhalit další místo', exact: true }).click();
      await expect.poll(async () => (await published()).finalReveal.rank).toBe(rank);
    }
    await expect(projector.locator('.sm-winner-names h1')).toHaveText([teamName]);
    await results.getByRole('button', { name: 'Zobrazit konečné pořadí', exact: true }).click(); await expect(projector.locator('.sm-final-table .sm-row')).toHaveCount(2);
    const confirmed = (await published()).finalReveal; expect(confirmed.rows.map(row => row.halfPoints)).toEqual([12, 4]);
    await page.getByText('Další možnosti', { exact: true }).click();
    page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Ukončit kvíz', exact: true }).click();
    await expect(projector.getByRole('heading', { name: 'Kvíz skončil', exact: true })).toBeVisible();
    const ended = await session();
    expect(ended.status).toBe('ended');
    expect(ended.finalReveal.versionId).toBe(confirmed.versionId);
    expect(ended.finalReveal.visible).toBe(false);
    expect((await published()).finalReveal).toBeUndefined();
    await page.goto('/admin/events/' + eventId);
    await page.locator('.event-actions > summary').click();
    await page.getByRole('button', { name: 'Ukončit akci', exact: true }).click();
    await page.getByRole('dialog', { name: 'Ukončit akci', exact: true }).getByRole('button', { name: 'Ukončit akci', exact: true }).click();
    await expect.poll(async () => (await event()).lifecycleStatus).toBe('completed');
    expect((await session()).finalReveal.versionId).toBe(confirmed.versionId);
    await page.goto('/admin/events/' + eventId + '/results'); await expect(page.getByRole('table', { name: 'Konečné pořadí', exact: true }).locator('tbody tr')).toHaveCount(2);
    await page.reload(); await expect(page.getByRole('table', { name: 'Konečné pořadí', exact: true })).toContainText(teamName);
    expect((await identity.db.doc('sessions/' + sessionId + '/finalVersions/' + confirmed.versionId).get()).get('rows')).toEqual(confirmed.rows);
    expect(publicRequests.some(url => /\/quizzes\/|\/quizSnapshots\//.test(url))).toBe(false); expect(errors).toEqual([]);
    bodyPassed = true;
  } finally {
    await audience?.close();
    let cleanup = 'PASS';
    let cleanupTimer;
    try {
      const finish = async () => {
        const deadline = Date.now() + 20000;
        for (const [collection, id] of [['sessions', sessionId], ['quizSnapshots', snapshotId], ['events', eventId], ['quizzes', quizId]]) if (id) await removeOwnTree(identity.db.doc(collection + '/' + id), deadline);
        if (sessionId) await identity.db.doc('publicSessions/' + sessionId).delete(); if (eventId) await identity.db.doc('publicEvents/' + eventId).delete();
        await identity.dispose();
      };
      await Promise.race([finish(), new Promise((_, reject) => { cleanupTimer = setTimeout(() => reject(new Error('Own cleanup exceeded 20 seconds')), 20000); })]);
    } catch { cleanup = 'FAILED'; } finally { clearTimeout(cleanupTimer); }
    await writeFile(output + '/result.json', JSON.stringify({ status: bodyPassed && cleanup === 'PASS' ? 'PASS' : 'FAIL', bodyPassed, cleanup, phase, phases, sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), specSHA256: hash(await readFile('tests/browser/product-stabilization.spec.mjs')), pdfs, publicPrivateRequests: publicRequests.filter(url => /\/quizzes\/|\/quizSnapshots\//.test(url)).length, pageErrorCount: errors.length, emailMode: 'off', cloudOperations: 0 }, null, 2));
    expect(cleanup, 'Own fixture cleanup must finish; body result is recorded separately').toBe('PASS');
  }
});
