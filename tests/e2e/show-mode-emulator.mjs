import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { doc, getDocFromServer } from 'firebase/firestore';
import { finalFixture } from './final-reveal-fixture.mjs';

// Reused fixture fails closed before SDK initialization unless demo-* + loopback
// Auth/Firestore/Functions emulators are explicitly configured. No cloud fallback.
const deny = (promise, code) => assert.rejects(promise, error => error.code === 'functions/' + code);
const forbidden = promise => assert.rejects(promise, error => error.code === 'permission-denied');
let groups = 0;
function safeResults(raw, fixture) {
  const text = JSON.stringify(raw);
  assert.equal(raw.answerRevealed, false); assert.equal(raw.mediaPlaybackState, 'idle');
  for (const key of ['correctAnswer', 'revealedAnswer', 'answerImage', 'answerDesign', 'answerExplanation', 'moderatorNote', 'legacy', 'raw', 'snapshotId', 'actorUid', 'staffUid', 'teamId', 'rowTeamIds', 'teamRanks', 'sourceFingerprint', 'contactEmail', 'managementTokenHash', 'mediaSource']) assert(!text.includes('"' + key + '"'), 'Private field leaked: ' + key);
  assert(!text.includes('PRIVATE ANSWER')); assert(!text.includes('PRIVATE CONTACT'));
  for (const id of fixture.teamIds) assert(!text.includes(id), 'Private stable ID leaked');
  assert(!text.includes(fixture.snapshotId));
}
async function interimCommand(f, action, extra = {}, client = f.moderator) {
  const current = await f.session();
  const request = { eventId: f.eventId, sessionId: f.sessionId, requestId: randomUUID(), expectedRevision: current.revision, action, ...extra };
  return { response: await client.call('controlInterimResults', request), request };
}
async function publish(f, extra = {}) {
  const preview = await f.preview();
  return interimCommand(f, 'publish', { throughRoundId: preview.throughRoundId, sourceFingerprint: preview.sourceFingerprint, presentationStyle: 'show', ...extra });
}
async function live(f, name, extra = {}) {
  return f.call(name, { sessionId: f.sessionId, expectedRevision: (await f.session()).revision, ...extra });
}

const f = await finalFixture(13);
try {
  // Question reveal is captured privately; overlay never republishes answer/design/audio.
  await live(f, 'revealAnswer');
  const before = await f.session();
  assert((await f.rawPublic()).revealedAnswer);
  const first = await publish(f);
  assert.equal(first.response.replayed, false); assert.equal(first.response.showCue.kind, 'interim');
  let raw = await f.rawPublic(); safeResults(raw, f);
  assert.equal(raw.interimResults.pageSize, 6); assert.equal(raw.interimResults.presentationStyle, 'show');
  assert.equal(raw.interimResults.rows.length, 6); assert.equal(raw.interimResults.pageCount, 3);
  assert(raw.interimBackdrop); assert.equal(raw.interimBackdrop.title, 'Synthetic question 1');
  assert.equal((await f.session()).interimReturn.answerRevealed, true);
  const publishedNames = [...raw.interimResults.rows.map(row => row.teamName)];
  for (const page of [1, 2]) {
    await interimCommand(f, 'page', { page }); raw = await f.rawPublic(); safeResults(raw, f);
    assert.equal(raw.showCue.motion, 'static'); publishedNames.push(...raw.interimResults.rows.map(row => row.teamName));
  }
  assert.equal(publishedNames.length, 13); assert.equal(new Set(publishedNames).size, 13);
  const hide = await interimCommand(f, 'hide');
  assert.equal(hide.response.returnRestored, true);
  let current = await f.session(); raw = await f.rawPublic();
  assert.equal(current.currentSlidePosition, before.currentSlidePosition);
  assert.equal(current.answerRevealed, true); assert.equal(raw.revealedAnswer, 'PRIVATE ANSWER SENTINEL');
  assert.equal(current.mediaPlaybackState, 'idle'); assert(current.mediaGeneration > before.mediaGeneration);
  assert.equal(raw.interimBackdrop, undefined); assert.equal(raw.showCue, undefined); assert.equal(current.interimReturn, undefined);
  const replay = await f.call('controlInterimResults', first.request);
  assert.equal(replay.replayed, true); assert.equal(replay.showCue, undefined); assert.deepEqual(await f.rawPublic(), raw);
  await deny(f.call('reportMediaPlayback', { sessionId: f.sessionId, mediaGeneration: before.mediaGeneration, playbackState: 'playing' }), 'aborted');
  groups++;

  // Only the prior confirmed version supplies movement. Names can change freely.
  await f.score(0, 0, 0);
  await f.db.doc(`events/${f.eventId}/registrations/${f.teamIds[0]}`).update({ teamName: 'Přejmenovaný tým', revision: 2 });
  await publish(f); raw = await f.rawPublic(); safeResults(raw, f);
  assert.equal(raw.interimResults.rows.find(row => row.teamName === 'Přejmenovaný tým').movement, -2);
  assert.equal(raw.interimResults.rows.find(row => row.teamName === 'Beta').movement, 1);
  const rowsBeforeStatic = raw.interimResults.rows, cueBefore = raw.showCue.id;
  await interimCommand(f, 'static'); raw = await f.rawPublic();
  assert.deepEqual(raw.interimResults.rows, rowsBeforeStatic); assert.equal(raw.showCue.motion, 'static'); assert.notEqual(raw.showCue.id, cueBefore);
  await interimCommand(f, 'hide'); groups++;

  // Recap selected question returns exactly, then answer permission revocation
  // allows hide but removes the right to republish that formerly explicit answer.
  await live(f, 'goToSlide', { position: 5 }); await live(f, 'selectRecapQuestion', { position: 4 });
  const recapBefore = await f.session();
  await publish(f); safeResults(await f.rawPublic(), f);
  await interimCommand(f, 'hide'); current = await f.session();
  assert.equal(current.presentationMode, 'recap'); assert.equal(current.currentSlidePosition, 5);
  assert.equal(current.recapQuestionId, recapBefore.recapQuestionId); assert.equal(current.recapQuestionPosition, 4);
  assert((await f.rawPublic()).revealedAnswer); assert.equal(current.mediaPlaybackState, 'idle');
  await publish(f);
  const memberRef = f.db.doc('memberships/' + f.moderator.uid), originalMember = (await memberRef.get()).data();
  await memberRef.update({ permissions: originalMember.permissions.filter(permission => permission !== 'event.answers.read'), version: originalMember.version + 1 });
  const fallback = await interimCommand(f, 'hide'); assert.equal(fallback.response.returnRestored, false);
  current = await f.session(); raw = await f.rawPublic();
  assert.equal(current.currentSlidePosition, 5); assert.equal(current.recapQuestionId, undefined);
  assert.equal(current.answerRevealed, false); assert.equal(raw.revealedAnswer, undefined);
  await memberRef.set({ ...originalMember, version: originalMember.version + 2 }); groups++;

  // Lower ranks are explicitly released in bulk; no podium appears in rows or history.
  const finalPreview = await f.previewFinal();
  await f.command('start', { sourceFingerprint: finalPreview.sourceFingerprint, presentationStyle: 'show' });
  raw = await f.rawPublic(); safeResults(raw, f);
  assert.equal(raw.finalReveal.mode, 'intro'); assert.deepEqual(raw.finalReveal.rows, []); assert.equal(raw.finalReveal.history, undefined);
  await deny(f.command('table'), 'failed-precondition');
  const lower = await f.command('reveal-lower'); raw = await f.rawPublic(); safeResults(raw, f);
  assert.equal(raw.finalReveal.mode, 'lower'); assert.equal(raw.finalReveal.rows.length, 6);
  assert(raw.finalReveal.rows.every(row => row.rank > 3)); assert.equal(raw.finalReveal.history, undefined);
  assert.equal((await f.session()).finalReveal.revealedCount, 1);
  await f.command('page', { page: 1 }); raw = await f.rawPublic(); assert.equal(raw.finalReveal.rows.length, 3);
  assert.equal(raw.showCue.motion, 'static'); assert(raw.finalReveal.rows.every(row => row.rank === 4));
  await deny(f.command('reveal-lower'), 'failed-precondition');
  await f.command('reveal'); raw = await f.rawPublic(); safeResults(raw, f);
  assert.equal(raw.finalReveal.rank, 3); assert.equal(raw.finalReveal.history.rows.length, 6);
  assert(raw.finalReveal.history.rows.every(row => row.rank > 3));
  const currentGroup = raw.finalReveal.rows;
  await f.command('history-page', { page: 1 }); raw = await f.rawPublic();
  assert.equal(raw.finalReveal.history.rows.length, 3); assert.deepEqual(raw.finalReveal.rows, currentGroup);
  await f.command('static'); raw = await f.rawPublic(); assert.equal(raw.showCue.motion, 'static');
  assert.equal((await f.session()).finalReveal.revealedCount, 2);
  await f.command('hide'); assert.equal((await f.rawPublic()).showCue, undefined);
  await f.command('resume'); assert.equal((await f.rawPublic()).showCue.motion, 'static');
  await f.command('reveal'); assert.equal((await f.rawPublic()).finalReveal.rank, 2);
  const winState = await f.session();
  const winRequest = { eventId: f.eventId, sessionId: f.sessionId, requestId: randomUUID(), action: 'reveal', expectedRevision: winState.revision, versionId: winState.finalReveal.versionId };
  const won = await f.call('controlFinalReveal', winRequest);
  assert.equal(won.winnerRevealed, true); raw = await f.rawPublic(); safeResults(raw, f);
  assert.equal(raw.finalReveal.groupSize, 2); assert.equal(raw.finalReveal.rows.length, 2); assert.equal(raw.showCue.kind, 'winners');
  assert(raw.finalReveal.history.rows.every(row => row.rank > 1));
  const sameVersion = (await f.session()).finalReveal.versionId;
  await forbidden(getDocFromServer(doc(f.anonymous.store, 'sessions', f.sessionId, 'finalVersions', sameVersion)));
  const retryWinner = await f.call('controlFinalReveal', winRequest);
  assert.equal(retryWinner.replayed, true); assert.equal(retryWinner.winnerRevealed, false); assert.equal(retryWinner.showCue, undefined);
  assert.deepEqual(await f.rawPublic(), raw);
  await deny(f.call('controlFinalReveal', { ...winRequest, motion: 'static' }), 'already-exists');
  await f.command('table'); raw = await f.rawPublic(); safeResults(raw, f);
  assert.equal(raw.finalReveal.rows.length, 6); assert.equal(raw.finalReveal.history, undefined); groups++;

  // Current scoped membership and fresh Auth are required even for receipt replay.
  const authorizedMember = (await memberRef.get()).data();
  await memberRef.update({ events: { mode: 'selected', ids: [] }, version: authorizedMember.version + 1 });
  await deny(f.call('controlFinalReveal', winRequest), 'permission-denied');
  await memberRef.set({ ...authorizedMember, version: authorizedMember.version + 2 });
  await f.authAdmin.updateUser(f.moderator.uid, { disabled: true });
  await deny(f.previewFinal(), 'permission-denied');
  await f.authAdmin.updateUser(f.moderator.uid, { disabled: false });
  await deny(f.anonymous.call('controlFinalReveal', { ...winRequest, requestId: randomUUID() }), 'unauthenticated');
  await f.command('hide'); await f.call('controlFinalReveal', winRequest);
  assert.equal((await f.rawPublic()).finalReveal, undefined);
  await live(f, 'endLiveSession'); current = await f.session(); raw = await f.rawPublic();
  assert.equal(raw.status, 'ended'); assert.equal(raw.showCue, undefined); assert.equal(current.interimReturn, undefined);
  await deny(f.call('controlFinalReveal', winRequest), 'failed-precondition');
  assert.equal(lower.replayed, false); groups++;
} finally { await f.close(); }

const tied = await finalFixture(13, false, true);
try {
  const preview = await tied.previewFinal();
  await tied.command('start', { sourceFingerprint: preview.sourceFingerprint, presentationStyle: 'show' });
  await deny(tied.command('reveal-lower'), 'failed-precondition');
  const reveal = await tied.command('reveal'); assert.equal(reveal.winnerRevealed, true);
  const names = [];
  for (const page of [0, 1, 2]) {
    if (page) { const response = await tied.command('page', { page }); assert.equal(response.winnerRevealed, false); }
    const raw = await tied.rawPublic(); safeResults(raw, tied);
    assert.equal(raw.finalReveal.groupSize, 13); assert.equal(raw.finalReveal.rank, 1);
    assert.equal(raw.finalReveal.history, undefined); assert.equal(raw.finalReveal.rows.length, page === 2 ? 1 : 6);
    names.push(...raw.finalReveal.rows.map(row => row.teamName));
  }
  assert.equal(new Set(names).size, 13); assert.equal((await tied.session()).finalReveal.revealedCount, 1); groups++;
} finally { await tied.close(); }

const legacy = await finalFixture(9, false, true);
try {
  await legacy.startFinal(await legacy.previewFinal());
  const classicPublic = await legacy.rawPublic();
  assert.equal(classicPublic.finalReveal.presentationStyle, undefined);
  assert.equal(classicPublic.finalReveal.pageSize, undefined);
  assert.deepEqual(Object.keys(classicPublic.finalReveal).sort(), ['versionId','mode','rank','page','pageCount','groupSize','rows'].sort());
  // Reconstruct the exact pre-feature persisted metadata shape, never public input.
  const current = await legacy.session(), versionRef = legacy.db.doc(`sessions/${legacy.sessionId}/finalVersions/${current.finalReveal.versionId}`);
  const saved = (await versionRef.get()).data();
  const { presentationStyle: oldStyle, pageSize: oldSize, ...oldPointer } = current.finalReveal;
  const { presentationStyle: savedStyle, pageSize: savedSize, ...oldVersion } = saved;
  assert.equal(oldStyle, 'classic'); assert.equal(oldSize, 8); assert.equal(savedStyle, 'classic'); assert.equal(savedSize, 8);
  await versionRef.set(oldVersion); await legacy.db.doc('sessions/' + legacy.sessionId).update({ finalReveal: oldPointer });
  await legacy.command('reveal'); assert.equal((await legacy.rawPublic()).finalReveal.rows.length, 8);
  await legacy.command('page', { page: 1 }); assert.equal((await legacy.rawPublic()).finalReveal.rows.length, 1);
  await deny(legacy.command('reveal-lower'), 'failed-precondition'); groups++;
} finally { await legacy.close(); }

// The one-button current standings command accepts incomplete rounds, while
// the finale keeps its stricter all-cells-complete boundary and fixed show cues.
const partial = await finalFixture(8);
try {
  await live(partial, 'revealAnswer');
  const before = await partial.session();
  const ledger = await partial.db.collection(`events/${partial.eventId}/scores`).get();
  const missing = ledger.docs.find(score => score.data().teamId === partial.teamIds[0] && score.data().roundId === 'r1');
  const cleared = ledger.docs.find(score => score.data().teamId === partial.teamIds[1] && score.data().roundId === 'r2');
  const last = ledger.docs.find(score => score.data().teamId === partial.teamIds[0] && score.data().roundId === 'r3');
  assert(missing && cleared && last);
  await missing.ref.delete(); await cleared.ref.update({ halfPoints: null, revision: 2 }); await last.ref.update({ halfPoints: 9, revision: 2 });
  const readLedger = async () => (await partial.db.collection(`events/${partial.eventId}/scores`).get()).docs.map(score => [score.id, score.data()]);
  const partialLedger = await readLedger();
  const first = await interimCommand(partial, 'current');
  let raw = await partial.rawPublic(); safeResults(raw, partial);
  assert.equal(raw.interimResults.presentationStyle, 'show'); assert.equal(raw.interimResults.pageSize, 6);
  assert.equal(raw.interimResults.rows.length, 6); assert.equal(raw.interimResults.pageCount, 2);
  assert.equal(raw.interimResults.rows.find(row => row.teamName === 'Alfa').halfPoints, 29);
  assert.equal(raw.interimResults.rows.find(row => row.teamName === 'Beta').halfPoints, 20);
  const version = (await partial.db.doc(`sessions/${partial.sessionId}/interimVersions/${raw.interimResults.versionId}`).get()).data();
  assert.equal(version.scope, 'current'); assert.equal(version.complete, false);
  assert.equal(version.expectedScoreCount, 24); assert.equal(version.presentScoreCount, 22); assert.equal(version.missingScoreCount, 2);
  assert.match(version.sourceFingerprint, /^[a-f0-9]{64}$/u);
  assert.deepEqual(await readLedger(), partialLedger, 'Current standings mutated the score ledger');
  await interimCommand(partial, 'page', { page: 1 }); raw = await partial.rawPublic(); safeResults(raw, partial);
  assert.equal(raw.interimResults.rows.length, 2);
  const hidden = await interimCommand(partial, 'hide');
  assert.equal(hidden.response.returnRestored, true); raw = await partial.rawPublic();
  assert.equal(raw.revealedAnswer, 'PRIVATE ANSWER SENTINEL');
  assert.equal((await partial.session()).currentSlidePosition, before.currentSlidePosition);
  assert.equal((await partial.session()).mediaPlaybackState, 'idle');
  const replayed = await partial.call('controlInterimResults', first.request);
  assert.equal(replayed.replayed, true); assert.equal((await partial.rawPublic()).interimResults, undefined);
  const incompleteFinal = await partial.previewFinal(); assert.equal(incompleteFinal.complete, false);
  await deny(partial.command('start', { sourceFingerprint: incompleteFinal.sourceFingerprint, presentationStyle: 'show' }), 'failed-precondition');
  await missing.ref.set(missing.data()); await cleared.ref.set(cleared.data());
  // Stored old preferences are deliberately disabled. The simplified finale
  // issues its own fixed cues, without modifying those persisted preferences.
  const oldPreferences = { schemaVersion: 1, motion: 'none', lowerRanks: 'step', topThree: false, winnerAnimation: false,
    audioEnabled: false, volume: .25, fadeInMs: 300, fadeOutMs: 500, cues: {} };
  await partial.db.doc(`events/${partial.eventId}`).update({ showPreferences: oldPreferences });
  const complete = await partial.previewFinal(); assert.equal(complete.complete, true);
  await partial.command('start', { sourceFingerprint: complete.sourceFingerprint, presentationStyle: 'show' });
  raw = await partial.rawPublic(); safeResults(raw, partial);
  assert.equal(raw.showCue.intensity, 'show'); assert.equal(raw.showCue.motion, 'animate');
  let winner;
  while ((await partial.session()).finalReveal.revealedCount < (await partial.session()).finalReveal.totalGroups) winner = await partial.command('reveal');
  assert.equal(winner.winnerRevealed, true); raw = await partial.rawPublic(); safeResults(raw, partial);
  assert.equal(raw.showCue.kind, 'winners'); assert.equal(raw.showCue.motion, 'animate'); assert.equal(raw.showCue.winnerAnimation, true);
  assert.deepEqual((await partial.db.doc(`events/${partial.eventId}`).get()).data().showPreferences, oldPreferences);
  groups++;
} finally { await partial.close(); }
console.log(`Show Mode emulator contracts: ${groups} groups PASS (anonymous payloads, exact return, six-row ties, lower/history, legacy eight, current partial scores, fixed finale, current authorization).`);
