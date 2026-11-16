import { seedEmulatorMembership } from '../../functions/lib/dev/seed-membership.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { doc, getDocFromServer, getDocs, collection, setDoc } from 'firebase/firestore';
import { finalFixture } from './final-reveal-fixture.mjs';
const deny = (promise, code) => assert.rejects(promise, e => e.code === 'functions/' + code);
const forbidden = promise => assert.rejects(promise, e => e.code === 'permission-denied');
import { assertFinalPayload } from './final-payload.mjs';
const f = await finalFixture();
let groups = 0;
try {
  let p = await f.previewFinal();
  assert.deepEqual(p.rows.slice(0, 4).map(r => r.halfPoints), [40,35,35,30]);
  assert.equal(p.includedRounds.length, 3);
  assert(!(await f.rawPublic()).finalReveal);
  await deny(f.command('reveal'), 'failed-precondition');
  await deny(f.anonymous.call('previewFinalResults', { eventId: f.eventId, sessionId: f.sessionId }), 'unauthenticated');
  const grant = await f.referee();
  await deny(f.anonymous.call('controlFinalReveal', { ...grant, sessionId: f.sessionId, action: 'start', token: 'management' }), 'unauthenticated');
  await seedEmulatorMembership(f.moderator.uid, 'user');
  await deny(f.previewFinal(), 'permission-denied');
  await seedEmulatorMembership(f.moderator.uid, 'moderator'); groups++;

  await f.score(0, 2, null); p = await f.previewFinal();
  assert.equal(p.complete, false); assert(p.missing.some(m => m.teamId === f.teamIds[0] && m.roundId === 'r3'));
  await deny(f.startFinal(p), 'failed-precondition');
  await f.score(0, 2, 0); p = await f.previewFinal();
  await f.score(0, 1, 21); await deny(f.startFinal(p), 'aborted');
  p = await f.previewFinal();
  const team = f.db.doc(`events/${f.eventId}/registrations/${f.teamIds[0]}`);
  await team.update({ teamName: 'Alfa renamed' }); await deny(f.startFinal(p), 'aborted');
  p = await f.previewFinal(); await team.update({ status: 'cancelled' }); await deny(f.startFinal(p), 'aborted');
  await team.update({ status: 'accepted', teamName: 'Alfa' }); groups++;

  // Last-round recap and reveal are reachable before manual END, and entry clears them.
  let s = await f.session(); await f.call('goToSlide', { sessionId: f.sessionId, expectedRevision: s.revision, position: 5 });
  s = await f.session(); await f.call('selectRecapQuestion', { sessionId: f.sessionId, expectedRevision: s.revision, position: 4 });
  assert((await f.rawPublic()).revealedAnswer);
  p = await f.previewFinal(); await f.startFinal(p);
  assertFinalPayload(await f.rawPublic(), [], 'intro');
  await deny(f.command('table'), 'failed-precondition');
  await deny(f.command('page', { page: 1 }), 'invalid-argument');
  await deny(f.command('reveal', { rank: 1, rows: p.rows }), 'invalid-argument');
  await deny(f.call('nextSlide', { sessionId: f.sessionId, expectedRevision: (await f.session()).revision }), 'failed-precondition');
  const interim = await f.preview();
  await deny(f.call('controlInterimResults', { eventId: f.eventId, sessionId: f.sessionId, requestId: randomUUID(), action: 'publish', expectedRevision: interim.sessionRevision, throughRoundId: 'r2', sourceFingerprint: interim.sourceFingerprint }), 'failed-precondition'); groups++;

  s = await f.session();
  const race = await Promise.allSettled([f.command('reveal', { expectedRevision: s.revision }), f.command('reveal', { expectedRevision: s.revision }, f.admin)]);
  assert.equal(race.filter(r => r.status === 'fulfilled').length, 1); assert.equal(race.find(r => r.status === 'rejected').reason.code, 'functions/aborted');
  assertFinalPayload(await f.rawPublic(), p.rows.filter(r => r.rank === 4).slice(0, 8), 'group');
  await f.command('page', { page: 1 }); assertFinalPayload(await f.rawPublic(), p.rows.filter(r => r.rank === 4).slice(8), 'group');
  assert.equal((await f.session()).finalReveal.revealedCount, 1);
  await f.score(0, 1, 0); // Confirmed version stays immutable across correction and pages.
  await f.command('hide'); assert(!(await f.rawPublic()).finalReveal);
  assert.equal((await f.session()).currentSlidePosition, 5); assert.equal((await f.session()).answerRevealed, false);
  await f.command('resume'); assertFinalPayload(await f.rawPublic(), p.rows.filter(r => r.rank === 4).slice(8), 'group');
  await f.command('reveal'); assertFinalPayload(await f.rawPublic(), p.rows.filter(r => r.rank === 3), 'group');
  await f.command('reveal'); assertFinalPayload(await f.rawPublic(), p.rows.filter(r => r.rank === 2), 'group'); groups++;

  s = await f.session();
  const win = { eventId: f.eventId, sessionId: f.sessionId, requestId: randomUUID(), action: 'reveal', expectedRevision: s.revision, versionId: s.finalReveal.versionId };
  const won = await f.call('controlFinalReveal', win); assert.equal(won.winnerRevealed, true);
  assertFinalPayload(await f.rawPublic(), p.rows.filter(r => r.rank === 1), 'group');
  const receipts = async () => (await f.db.collection(`sessions/${f.sessionId}/finalOperations`).get()).size;
  const count = await receipts();
  const retry = await f.call('controlFinalReveal', win); assert.equal(retry.replayed, true); assert.equal(retry.winnerRevealed, false); assert.equal(await receipts(), count);
  await deny(f.call('controlFinalReveal', { ...win, expectedRevision: win.expectedRevision + 1 }), 'already-exists');
  await f.command('table'); assertFinalPayload(await f.rawPublic(), p.rows.slice(0, 8), 'table');
  await f.command('hide'); await f.call('controlFinalReveal', win); assert(!(await f.rawPublic()).finalReveal);
  await f.command('resume'); assertFinalPayload(await f.rawPublic(), p.rows.slice(0, 8), 'table'); groups++;

  for (const child of ['finalVersions','finalOperations']) {
    await forbidden(getDocFromServer(doc(f.anonymous.store, 'sessions', f.sessionId, child, won.versionId)));
    await forbidden(getDocs(collection(f.anonymous.store, 'sessions', f.sessionId, child)));
    await forbidden(setDoc(doc(f.admin.store, 'sessions', f.sessionId, child, 'injected'), { rows: p.rows }));
  }
  await forbidden(getDocs(collection(f.anonymous.store, 'publicSessions')));
  await forbidden(setDoc(doc(f.anonymous.store, 'publicSessions', f.sessionId), { finalReveal: { rows: p.rows } }));
  await forbidden(getDocFromServer(doc(f.anonymous.store, 'publicSessions', f.sessionId, 'finalVersions', won.versionId))); groups++;

  const corrected = await f.previewFinal(); await f.startFinal(corrected, 'replace');
  assertFinalPayload(await f.rawPublic(), [], 'intro');
  assert.equal((await f.session()).finalReveal.revealedCount, 0);
  assert.notEqual((await f.session()).finalReveal.versionId, won.versionId);
  assert.equal((await f.db.collection(`sessions/${f.sessionId}/finalVersions`).get()).size, 2);
  await f.call('controlFinalReveal', win); assertFinalPayload(await f.rawPublic(), [], 'intro');
  await deny(f.call('controlFinalReveal', { ...win, requestId: randomUUID() }), 'aborted');
  await deny(f.call('previewFinalResults', { eventId: 'foreign', sessionId: f.sessionId }), 'not-found');
  s = await f.session(); await f.call('endLiveSession', { sessionId: f.sessionId, expectedRevision: s.revision });
  assert.equal((await f.rawPublic()).status, 'ended'); assert(!(await f.rawPublic()).finalReveal);
  assert.equal((await f.session()).finalReveal.visible, false);
  await deny(f.call('controlFinalReveal', win), 'failed-precondition'); await deny(f.command('resume'), 'failed-precondition'); groups++;

  for (const action of ['cancelEvent','archiveEvent']) {
    const other = await finalFixture(1, true);
    try {
      const q = await other.previewFinal(); assert.equal(q.includedRounds.length, 1);
      await other.startFinal(q); const r = await other.command('reveal'); assert.equal(r.winnerRevealed, true);
      assert.equal((await other.rawPublic()).finalReveal.rank, 1);
      // Archive accepts only a closed event; finish it through the real server path.
      if (action === 'archiveEvent') { const session = await other.session(); await other.admin.call('endLiveSession', { sessionId: other.sessionId, expectedRevision: session.revision }); const before=(await other.db.doc('events/'+other.eventId).get()).data(); await other.admin.call('completeEvent',{eventId:other.eventId,expectedRevision:before.revision,requestId:randomUUID()}); }
      const event = (await other.db.doc('events/' + other.eventId).get()).data();
      await other.admin.call(action, { eventId: other.eventId, expectedRevision: event.revision, ...(action === 'cancelEvent' ? { endLive: true } : {}) });
      assert.equal((await other.rawPublic()).status, 'ended'); assert(!(await other.rawPublic()).finalReveal);
      await deny(other.command('resume'), 'failed-precondition');
    } finally { await other.close(); }
  } groups++;
  console.log(`Final reveal emulator contracts: ${groups} groups PASS (including raw anonymous payloads, version replacement, concurrency and closure).`);
} finally { await f.close(); }
