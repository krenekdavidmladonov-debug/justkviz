/* global document */
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { editorIdentity } from '../e2e/editor-identity.mjs';
import { assertFinalPayload } from '../e2e/final-payload.mjs';
import { requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';

async function loopbackOnly(context) {
  await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
}
const tableRows = table => table.getByRole('row').evaluateAll(nodes => nodes.filter(row => row.querySelector('td,[role="cell"]')).map(row => [...row.children].map(cell => cell.textContent.trim())));
async function openRounds(page) {
  await page.locator('.outline-round').first().waitFor();
  const collapsed = page.locator('.outline-collapse[aria-expanded=false]');
  while (await collapsed.count()) await collapsed.first().click();
}
function safeFinal(raw, expectedRows, mode, allRows) {
  expect(JSON.stringify(raw)).not.toMatch(/PRIVATE|actorUid|staffUid|snapshotId|sourceFingerprint|contactEmail|teamId|accessId|managementToken|correctAnswer/);
  const { showCue, ...base } = raw, { history, ...finalReveal } = raw.finalReveal;
  assertFinalPayload({ ...base, finalReveal }, expectedRows, mode);
  if (showCue) expect(Object.keys(showCue).sort()).toEqual(['durationMs', 'id', 'intensity', 'kind', 'motion', 'startedAt', 'topThree', 'winnerAnimation'].sort());
  const historyAllowed = mode === 'group' && finalReveal.presentationStyle === 'show' && Number.isSafeInteger(finalReveal.rank) && finalReveal.rank > 0;
  if (!historyAllowed) expect(history).toBeUndefined();
  if (history) {
    expect(historyAllowed).toBe(true);
    expect(Object.keys(history).sort()).toEqual(['page', 'pageCount', 'pageSize', 'rows']);
    expect(history.pageSize).toBe(6);
    expect(Number.isSafeInteger(history.page)).toBe(true);
    expect(Number.isSafeInteger(history.pageCount)).toBe(true);
    expect(history.page).toBeGreaterThanOrEqual(0);
    expect(history.pageCount).toBeGreaterThan(0);
    expect(history.page).toBeLessThan(history.pageCount);
    expect(Array.isArray(history.rows)).toBe(true);
    expect(history.rows.length).toBeLessThanOrEqual(6);
    for (const row of history.rows) { expect(Object.keys(row).sort()).toEqual(['halfPoints', 'rank', 'teamName']); expect(allRows).toContainEqual(row); expect(row.rank).toBeGreaterThan(raw.finalReveal.rank); }
  }
}

test('one authored event: quiz, immutable snapshot, public teams, scores, staged finale and history', async ({ page, context, browser, baseURL }) => {
  requireFullEmulatorEnvironment(process.env, 'Restart event acceptance');
  const identity = await editorIdentity(); // Auth/membership setup only; no content fixture.
  const ownUid = getApps().map(app => getAuth(app).currentUser).find(user => user?.email === identity.email)?.uid;
  const suffix = randomUUID().slice(0, 8), title = 'Restart synthetic ' + suffix;
  const snapshotPrompt = 'Synthetic question revised ' + suffix;
  const answer = 'PRIVATE_RESTART_ANSWER_' + suffix;
  const teams = ['Synthetic Alfa ' + suffix, 'Synthetic Beta ' + suffix];
  const finalRows = [{ rank: 1, teamName: teams[0], halfPoints: 6 }, { rank: 2, teamName: teams[1], halfPoints: 2 }];
  let quizId, eventId, snapshotId, sessionId, publicContext;
  const save = async () => {
    await page.getByRole('button', { name: 'Uložit vše', exact: true }).click();
    await expect(page.locator('.save-state')).toHaveText('Uloženo');
  };
  const publicState = async () => (await identity.db.doc('publicSessions/' + sessionId).get()).data();
  async function next() {
    const before = (await identity.db.doc('sessions/' + sessionId).get()).data();
    await page.getByRole('button', { name: 'Další →', exact: true }).click();
    await expect.poll(async () => (await identity.db.doc('sessions/' + sessionId).get()).get('revision')).toBeGreaterThan(before.revision);
    const state = (await identity.db.doc('sessions/' + sessionId).get()).data();
    await expect(page.locator('.live-control')).toHaveAttribute('data-current-position', String(state.currentSlidePosition));
  }

  try {
    expect(ownUid).toBeTruthy();
    await loopbackOnly(context);
    await page.goto('/admin/login');
    await page.getByLabel('E-mail').fill(identity.email); await page.getByLabel('Heslo').fill(identity.password);
    await page.getByRole('button', { name: 'Přihlásit se', exact: true }).click(); await expect(page).toHaveURL(/\/admin$/);
    await page.goto('/admin/quizzes/new'); await page.getByLabel('Název kvízu').fill(title);
    await page.getByRole('button', { name: 'Vytvořit', exact: true }).click(); await expect(page).toHaveURL(/\/edit$/);
    quizId = page.url().split('/').at(-2);
    await page.getByRole('button', { name: '+ Přidat kolo', exact: true }).click();
    await page.getByLabel('Název kola *', { exact: true }).fill('Synthetic round'); await save();
    await page.getByRole('button', { name: '+ Přidat otázku', exact: true }).click();
    await page.getByLabel('Otázka *', { exact: true }).fill('Initial synthetic question');
    await page.getByLabel('Správná odpověď *', { exact: true }).fill(answer); await save();
    await page.getByLabel('Otázka *', { exact: true }).fill(snapshotPrompt); await save();
    await page.getByRole('link', { name: '← Knihovna kvízů', exact: true }).click();
    await page.goto('/admin/quizzes/' + quizId + '/edit');
    await openRounds(page); await page.locator('.outline-question').click();
    await expect(page.getByLabel('Otázka *', { exact: true })).toHaveValue(snapshotPrompt);
    await expect(page.getByLabel('Správná odpověď *', { exact: true })).toHaveValue(answer);
    const quizSlides = (await identity.db.collection('quizzes/' + quizId + '/slides').get()).docs;
    const question = quizSlides.find(doc => doc.data().isQuestion);
    expect(question.data().text).toBe(snapshotPrompt);

    await page.goto('/admin/events/new'); await page.getByLabel('Název akce', { exact: true }).fill(title);
    await page.getByLabel('Datum a čas v Praze').fill('2031-07-20T19:30');
    await page.getByLabel('Místo', { exact: true }).fill('Synthetic hall');
    await page.getByLabel('Veřejné upřesnění místa').fill('Synthetic location');
    await page.getByRole('button', { name: 'Vytvořit akci', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Upravit akci', exact: true })).toBeVisible();
    eventId = page.url().split('/').at(-1);
    await page.getByLabel('Název akce', { exact: true }).fill(title + ' revised');
    await page.getByRole('button', { name: 'Uložit změny', exact: true }).click();
    await expect(page.getByText('Změny akce byly uloženy.')).toBeVisible();
    await page.getByTestId('event-quiz-assignment').getByRole('combobox').selectOption(quizId);
    const warning = page.getByLabel('Potvrzuji upozornění pro tuto verzi kvízu.');
    if (await warning.count()) await warning.check();
    await page.getByRole('button', { name: 'Připravit ke hraní', exact: true }).click();
    await expect(page.getByText('Kvíz je připraven ke hraní.', { exact: true })).toBeVisible();
    const assigned = (await identity.db.doc('events/' + eventId).get()).data();
    snapshotId = assigned.quizAssignment.snapshotId;
    expect(assigned.quizAssignment.quizId).toBe(quizId);
    const snapshotRoot = (await identity.db.doc('quizSnapshots/' + snapshotId).get()).data();
    expect(snapshotRoot.eventId).toBe(eventId);
    const snapshotSlides = (await identity.db.collection('quizSnapshots/' + snapshotId + '/slides').get()).docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const snapshotQuestion = snapshotSlides.find(slide => slide.isQuestion);
    expect(snapshotQuestion.text).toBe(snapshotPrompt);
    // A normal source edit after locking must not alter this event's snapshot.
    const sourceRevision = (await identity.db.doc('quizzes/' + quizId).get()).get('revision');
    await page.goto('/admin/quizzes/' + quizId + '/edit'); await openRounds(page); await page.locator('.outline-question').click();
    await page.getByLabel('Otázka *', { exact: true }).fill('Later source edit ' + suffix); await save();
    expect((await identity.db.doc('quizzes/' + quizId + '/slides/' + question.id).get()).get('text')).toBe('Later source edit ' + suffix);
    expect((await identity.db.doc('quizzes/' + quizId).get()).get('revision')).toBeGreaterThan(sourceRevision);
    expect((await identity.db.doc('quizSnapshots/' + snapshotId).get()).data()).toEqual(snapshotRoot);
    expect((await identity.db.collection('quizSnapshots/' + snapshotId + '/slides').get()).docs.map(doc => ({ id: doc.id, ...doc.data() }))).toEqual(snapshotSlides);

    await page.goto('/admin/events/' + eventId + '/registrations');
    await page.getByLabel('Otevření').fill('2020-01-01T00:00');
    await page.getByLabel('Uzavření').fill('2030-01-01T00:00');
    await page.getByRole('button', { name: 'Uložit nastavení', exact: true }).click();
    await expect(page.getByText('Nastavení registrací bylo uloženo.')).toBeVisible();
    await page.goto('/admin/events/' + eventId);
    await page.getByRole('button', { name: 'Zveřejnit a otevřít registrace', exact: true }).click();
    await page.getByRole('dialog', { name: 'Zveřejnit a otevřít registrace?', exact: true }).getByRole('button', { name: 'Zveřejnit a otevřít registrace', exact: true }).click();
    await expect.poll(async () => (await identity.db.doc('events/' + eventId).get()).get('registrationPublished')).toBe(true);
    publicContext = await browser.newContext({ baseURL }); await loopbackOnly(publicContext);
    const publicPage = await publicContext.newPage();
    for (const [index, team] of teams.entries()) {
      await publicPage.goto('/events/' + eventId);
      await expect(publicPage.getByRole('region', { name: 'Přihlásit tým', exact: true })).toBeVisible();
      await expect(publicPage.getByText('Registrace otevřené', { exact: true })).toBeVisible();
      await publicPage.getByLabel('Název týmu').fill(team); await publicPage.getByLabel('Počet členů').fill('2');
      await publicPage.getByLabel('E-mail').fill('restart-' + suffix + '-' + index + '@example.test');
      await publicPage.getByRole('button', { name: 'Přihlásit tým', exact: true }).click();
      await expect(publicPage.getByRole('heading', { name: 'Děkujeme, tým byl přihlášen.' })).toBeVisible();
      const publicChecks = await publicPage.evaluate(({ eventId, answer }) => {
        const link = [...document.querySelectorAll('a')].find(element => element.textContent.startsWith('Spravovat registraci'));
        const url = link ? new URL(link.href) : null, params = new URLSearchParams(url?.hash.slice(1) ?? '');
        return { managementLink: Boolean(url && url.pathname === '/events/' + eventId + '/registration/manage' && params.get('registration') && params.get('token')), answerHidden: !document.body.textContent.includes(answer) };
      }, { eventId, answer });
      await publicPage.goto('about:blank');
      expect(publicChecks).toEqual({ managementLink: true, answerHidden: true });
    }
    expect((await identity.db.collection('events/' + eventId + '/registrations').get()).docs.filter(doc => doc.data().status === 'accepted')).toHaveLength(2);
    await page.goto('/admin/events/' + eventId + '/scoring');
    for (const [index, team] of teams.entries()) await page.getByLabel('Body — ' + team, { exact: true }).fill(index === 0 ? '3' : '1');
    await page.getByRole('button', { name: 'Uložit body celého kola', exact: true }).click();
    await expect(page.getByText('Body kola jsou uložené. Potvrzeno serverem.', { exact: true })).toBeVisible();
    await page.reload(); await expect(page.getByLabel('Body — ' + teams[0], { exact: true })).toHaveValue('3');
    await page.goto('/admin/events/' + eventId);
    await page.getByRole('button', { name: 'Otevřít moderování akce', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/live\//); sessionId = page.url().split('/').at(-1);
    expect((await identity.db.doc('sessions/' + sessionId).get()).get('eventId')).toBe(eventId);
    await publicPage.goto('/projector/' + sessionId);
    for (let step = 0; step < snapshotSlides.length; step++) {
      const state = (await identity.db.doc('sessions/' + sessionId).get()).data();
      if (state.currentSlidePosition === snapshotQuestion.position) break;
      await next();
    }
    await expect(publicPage.getByText(snapshotPrompt, { exact: true })).toBeVisible();
    const beforeAnswer = await publicState();
    expect(beforeAnswer.answerRevealed).toBe(false); expect(beforeAnswer.revealedAnswer).toBeUndefined();
    expect(JSON.stringify(beforeAnswer)).not.toContain(answer);
    await expect(publicPage.getByText(answer, { exact: true })).toHaveCount(0);
    await next();
    await expect(page.getByRole('button', { name: 'Zobrazit odpověď na otázku 1', exact: true })).toBeVisible();
    expect(JSON.stringify(await publicState())).not.toContain(answer);
    await page.getByRole('button', { name: 'Zobrazit odpověď na otázku 1', exact: true }).click();
    await expect(publicPage.getByText(answer, { exact: true })).toBeVisible();
    expect((await publicState()).revealedAnswer).toBe(answer);

    const finale = page.getByRole('region', { name: 'Výsledky akce', exact: true });
    expect((await publicState()).finalReveal).toBeUndefined();
    const beforePreview = await publicState();
    await finale.getByRole('button', { name: 'Náhled závěrečné show', exact: true }).click();
    const demo = page.getByRole('dialog', { name: 'Ukázka finální show', exact: true });
    await expect(demo).toBeVisible(); expect(await publicState()).toEqual(beforePreview);
    await demo.getByRole('button', { name: 'Zavřít náhled', exact: true }).click();
    await page.getByRole('button', { name: 'Přejít na otázku', exact: true }).click();
    await page.getByRole('dialog', { name: 'Přejít na otázku', exact: true }).getByRole('button', { name: 'Finální výsledky', exact: true }).click();
    await expect(publicPage.locator('.sm-intro')).toBeVisible();
    safeFinal(await publicState(), [], 'intro', finalRows);
    const tableButton = finale.getByRole('button', { name: 'Zobrazit konečné pořadí', exact: true });
    await expect(tableButton).toHaveCount(0);
    for (const rank of [2, 1]) {
      await finale.getByRole('button', { name: 'Odhalit další místo', exact: true }).click();
      await expect.poll(async () => (await publicState()).finalReveal.rank).toBe(rank);
      safeFinal(await publicState(), finalRows.filter(row => row.rank === rank), 'group', finalRows);
      await expect(publicPage.getByText(teams[rank - 1], { exact: true })).toBeVisible();
      if (rank === 2) { await expect(tableButton).toHaveCount(0); await expect(publicPage.getByText(teams[0], { exact: true })).toHaveCount(0); }
    }
    await tableButton.click();
    const projectorTable = publicPage.getByRole('table', { name: 'Konečné pořadí', exact: true });
    await expect(projectorTable.getByRole('row').filter({ has: publicPage.getByRole('cell') })).toHaveCount(2);
    safeFinal(await publicState(), finalRows, 'table', finalRows);
    const confirmedTable = await tableRows(projectorTable);
    expect(confirmedTable).toEqual([['1.', teams[0], '3'], ['2.', teams[1], '1']]);
    const confirmedVersion = (await publicState()).finalReveal.versionId;
    await page.getByText('Další možnosti', { exact: true }).click();
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Ukončit kvíz', exact: true }).click();
    await expect(publicPage.getByRole('heading', { name: 'Kvíz skončil', exact: true })).toBeVisible();
    await page.goto('/admin/events/' + eventId);
    await page.locator('.event-actions > summary').click();
    await page.getByRole('button', { name: 'Ukončit akci', exact: true }).click();
    await page.getByRole('dialog', { name: 'Ukončit akci', exact: true }).getByRole('button', { name: 'Ukončit akci', exact: true }).click();
    await expect.poll(async () => (await identity.db.doc('events/' + eventId).get()).get('lifecycleStatus')).toBe('completed');
    await page.getByRole('link', { name: 'Zobrazit výsledky', exact: true }).click();
    await expect(page).toHaveURL(new RegExp('/admin/events/' + eventId + '/results$'));
    const history = page.getByRole('table', { name: 'Konečné pořadí', exact: true });
    await expect(history.locator('tbody tr')).toHaveCount(2); expect(await tableRows(history)).toEqual(confirmedTable);
    await page.reload(); await expect(history.locator('tbody tr')).toHaveCount(2); expect(await tableRows(history)).toEqual(confirmedTable);
    expect((await identity.db.doc('sessions/' + sessionId + '/finalVersions/' + confirmedVersion).get()).get('rows')).toEqual(finalRows);
    expect((await identity.db.doc('events/' + eventId).get()).get('lifecycleStatus')).toBe('completed');
    expect((await identity.db.doc('quizSnapshots/' + snapshotId).get()).data()).toEqual(snapshotRoot);
  } finally {
    await publicContext?.close();
    requireFullEmulatorEnvironment(process.env, 'Restart event acceptance cleanup');
    // Validate every root and relationship before deleting anything. On a mismatch,
    // retain the entire fixture for inspection instead of trusting URL-derived IDs.
    if (quizId) {
      const ownedQuiz = await identity.db.doc('quizzes/' + quizId).get();
      expect(ownedQuiz.get('title')).toBe(title);
      expect(ownedQuiz.get('createdBy')).toBe(ownUid);
    }
    if (eventId) {
      const ownedEvent = await identity.db.doc('events/' + eventId).get();
      expect([title, title + ' revised']).toContain(ownedEvent.get('title'));
      expect(ownedEvent.get('createdBy')).toBe(ownUid);
      if (snapshotId) expect(ownedEvent.get('quizAssignment.snapshotId')).toBe(snapshotId);
    }
    if (sessionId) {
      const ownedSession = await identity.db.doc('sessions/' + sessionId).get();
      expect(ownedSession.get('eventId')).toBe(eventId);
      expect(ownedSession.get('snapshotId')).toBe(snapshotId);
    }
    if (snapshotId) {
      const ownedSnapshot = await identity.db.doc('quizSnapshots/' + snapshotId).get();
      expect(ownedSnapshot.get('eventId')).toBe(eventId);
      expect(ownedSnapshot.get('quizId')).toBe(quizId);
    }
    if (sessionId) {
      await identity.db.recursiveDelete(identity.db.doc('sessions/' + sessionId));
      await identity.db.doc('publicSessions/' + sessionId).delete();
    }
    if (snapshotId) {
      await identity.db.recursiveDelete(identity.db.doc('quizSnapshots/' + snapshotId));
    }
    if (eventId) { await identity.db.recursiveDelete(identity.db.doc('events/' + eventId)); await identity.db.doc('publicEvents/' + eventId).delete(); }
    if (quizId) await identity.db.recursiveDelete(identity.db.doc('quizzes/' + quizId));
    await identity.dispose();
  }
});
