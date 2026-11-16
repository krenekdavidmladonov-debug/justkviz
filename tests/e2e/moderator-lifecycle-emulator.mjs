import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { doc, getDocFromServer } from 'firebase/firestore';
import { finalFixture } from './final-reveal-fixture.mjs';

const denied = (promise, code) => assert.rejects(promise, error => error.code === 'functions/' + code);
const f = await finalFixture(4);
const eventRef = f.db.doc('events/' + f.eventId);
const publicEventRef = f.db.doc('publicEvents/' + f.eventId);
const event = async () => (await eventRef.get()).data();
try {
  const interim = await f.preview();
  await f.call('controlInterimResults', { eventId: f.eventId, sessionId: f.sessionId, requestId: randomUUID(), action: 'publish', expectedRevision: interim.sessionRevision, throughRoundId: 'r2', sourceFingerprint: interim.sourceFingerprint });
  let session = await f.session();
  await denied(f.call('goToSlide', { sessionId: f.sessionId, expectedRevision: session.revision - 1, position: 2 }), 'aborted');
  await f.call('goToSlide', { sessionId: f.sessionId, expectedRevision: session.revision, position: 2 });
  session = await f.session();
  assert.equal(session.interimResults, undefined); assert.equal(session.interimReturn, undefined);
  assert.equal((await f.rawPublic()).interimResults, undefined);
  await f.startFinal(await f.previewFinal());
  const versionId = (await f.session()).finalReveal.versionId;
  const versionRef = f.db.doc(`sessions/${f.sessionId}/finalVersions/${versionId}`);
  const version = (await versionRef.get()).data();
  session = await f.session();
  await f.call('goToSlide', { sessionId: f.sessionId, expectedRevision: session.revision, position: 4 });
  session = await f.session();
  assert.equal(session.finalReveal.visible, false); assert.equal(session.finalReveal.versionId, versionId);
  const jumped = await f.rawPublic();
  for (const field of ['finalReveal', 'revealedAnswer', 'answerImage', 'showCue', 'interimBackdrop']) assert.equal(jumped[field], undefined);
  assert.equal(session.answerRevealed, false); assert.equal(session.mediaCommand, 'idle');
  const otherId = 'qa-other-' + randomUUID();
  await f.db.doc('sessions/' + otherId).set({ ...session, sessionId: otherId });
  const before = await event(), publicBefore = (await publicEventRef.get()).data();
  await f.call('endLiveSession', { sessionId: f.sessionId, expectedRevision: session.revision });
  assert.deepEqual(await event(), before); assert.deepEqual((await publicEventRef.get()).data(), publicBefore);
  assert.equal((await f.db.doc('sessions/' + otherId).get()).get('status'), 'active');
  assert.equal((await f.rawPublic()).status, 'ended');
  assert.deepEqual((await versionRef.get()).data(), version);
  await f.score(0, 0, 21); // Ending one presentation leaves scoring operational.
  const restarted = await f.admin.call('createEventLiveSession', { eventId: f.eventId, expectedRevision: before.revision });
  assert.notEqual(restarted.sessionId, f.sessionId);
  await f.admin.call('goToSlide', { sessionId: restarted.sessionId, expectedRevision: 0, position: 1 });
  const restartedPreview = await f.admin.call('previewFinalResults', { eventId: f.eventId, sessionId: restarted.sessionId });
  assert.equal(restartedPreview.complete, true);
  await f.admin.call('controlFinalReveal', { eventId: f.eventId, sessionId: restarted.sessionId, expectedRevision: restartedPreview.sessionRevision,
    requestId: randomUUID(), action: 'start', versionId: restartedPreview.publishedVersionId, sourceFingerprint: restartedPreview.sourceFingerprint });
  const restartedFinal = (await f.db.doc('sessions/' + restarted.sessionId).get()).get('finalReveal');
  const revision = (await event()).revision;
  const complete = { eventId: f.eventId, expectedRevision: revision, requestId: randomUUID() };
  await denied(f.anonymous.call('completeEvent', complete), 'unauthenticated');
  await denied(f.call('completeEvent', { ...complete, endLive: true }), 'permission-denied');
  await denied(f.admin.call('completeEvent', complete), 'failed-precondition');
  await denied(f.admin.call('completeEvent', { ...complete, expectedRevision: revision - 1, endLive: true }), 'aborted');
  const memberRef = f.db.doc('memberships/' + f.admin.uid), member = (await memberRef.get()).data();
  await memberRef.update({ permissions: member.permissions.filter(permission => permission !== 'event.live') });
  await denied(f.admin.call('completeEvent', { ...complete, endLive: true }), 'permission-denied');
  await memberRef.update({ permissions: member.permissions, events: { mode: 'selected', ids: ['foreign'] } });
  await denied(f.admin.call('completeEvent', { ...complete, endLive: true }), 'permission-denied');
  await memberRef.update({ events: member.events });
  const scoresBefore = (await f.db.collection(`events/${f.eventId}/scores`).get()).docs.map(document => [document.id, document.data()]);
  const result = await f.admin.call('completeEvent', { ...complete, endLive: true });
  assert.equal(result.lifecycleStatus, 'completed'); assert.equal(result.revision, revision + 1);
  assert.equal((await event()).registrationStatus, 'closed'); assert.equal((await event()).registrationPublished, false);
  assert.equal((await publicEventRef.get()).exists, false);
  for (const id of [f.sessionId, otherId, restarted.sessionId]) {
    const ended = (await f.db.doc('sessions/' + id).get()).data();
    assert.equal(ended.status, 'ended');
    assert.equal(ended.finalReveal.versionId, id === restarted.sessionId ? restartedFinal.versionId : versionId);
    assert.equal(ended.finalReveal.visible, false);
    const projection = (await f.db.doc('publicSessions/' + id).get()).data();
    assert.equal(projection.status, 'ended'); assert.equal(projection.finalReveal, undefined); assert.equal(projection.revealedAnswer, undefined);
  }
  assert.deepEqual((await versionRef.get()).data(), version);
  assert.deepEqual((await f.db.collection(`events/${f.eventId}/scores`).get()).docs.map(document => [document.id, document.data()]), scoresBefore);
  assert.deepEqual(await f.admin.call('completeEvent', { ...complete, endLive: true }), result);
  assert.equal((await f.db.doc('sessions/' + restarted.sessionId).get()).get('finalReveal.versionId'), restartedFinal.versionId);
  await denied(f.admin.call('completeEvent', { ...complete, endLive: true, reason: 'changed' }), 'already-exists');
  await denied(f.score(0, 0, 22), 'failed-precondition');
  console.log('PASS moderator lifecycle: safe explicit result jumps, END preserves event/publication/scoring/history, restart/finale preview, scoped explicit manual completion and idempotence.');
} finally { await f.close(); }

// The normal finale -> END -> complete path must retain the exact authoritative
// pointer used by history, including fresh scoped Firestore reads after reload.
const completed = await finalFixture(10);
try {
  await completed.startFinal(await completed.previewFinal());
  while ((await completed.session()).finalReveal.revealedCount < (await completed.session()).finalReveal.totalGroups) await completed.command('reveal');
  await completed.command('table'); await completed.command('page', { page: 1 });
  const confirmed = await completed.session();
  const versionRef = completed.db.doc(`sessions/${completed.sessionId}/finalVersions/${confirmed.finalReveal.versionId}`);
  const version = (await versionRef.get()).data();
  assert.equal(version.rows.length, 10);
  await completed.call('goToSlide', { sessionId: completed.sessionId, expectedRevision: confirmed.revision, position: 6 });
  await completed.call('endLiveSession', { sessionId: completed.sessionId, expectedRevision: (await completed.session()).revision });
  const ended = await completed.session(), eventRef = completed.db.doc('events/' + completed.eventId);
  const complete = { eventId: completed.eventId, expectedRevision: (await eventRef.get()).get('revision'), requestId: randomUUID() };
  const response = await completed.admin.call('completeEvent', complete);
  const assertHistory = async () => {
    const event = (await getDocFromServer(doc(completed.admin.store, 'events', completed.eventId))).data();
    assert.equal(event.lifecycleStatus, 'completed'); assert.equal(event.liveSessionId, completed.sessionId);
    assert.equal(event.quizAssignment.snapshotId, completed.snapshotId);
    const session = (await getDocFromServer(doc(completed.admin.store, 'sessions', event.liveSessionId))).data();
    assert.deepEqual(session.finalReveal, ended.finalReveal); assert.equal(session.finalReveal.visible, false);
    assert.equal(session.status, 'ended'); assert.equal(session.eventId, completed.eventId); assert.equal(session.snapshotId, completed.snapshotId);
    assert.equal(session.revision, ended.revision); assert.equal(session.endedAt.toMillis(), ended.endedAt.toMillis());
    const historical = (await getDocFromServer(doc(completed.admin.store, 'sessions', event.liveSessionId, 'finalVersions', session.finalReveal.versionId))).data();
    assert.equal(historical.versionId, version.versionId); assert.equal(historical.sessionId, event.liveSessionId);
    assert.equal(historical.eventId, completed.eventId); assert.equal(historical.snapshotId, completed.snapshotId);
    assert.deepEqual(historical.rows, version.rows);
    const publication = await completed.rawPublic();
    assert.equal(publication.status, 'ended');
    for (const key of ['finalReveal', 'interimResults', 'interimBackdrop', 'showCue', 'revealedAnswer', 'answerImage', 'mediaSource']) assert.equal(publication[key], undefined);
  };
  await assertHistory(); await assertHistory();
  assert.deepEqual(await completed.admin.call('completeEvent', complete), response); await assertHistory();
  await completed.admin.call('archiveEvent', { eventId: completed.eventId, expectedRevision: response.revision, requestId: randomUUID() });
  await assertHistory();
  await completed.admin.call('trashEvent', { eventId: completed.eventId, expectedRevision: (await eventRef.get()).get('revision'), requestId: randomUUID() });
  assert.equal((await eventRef.get()).get('disposition'), 'trash');
  assert.deepEqual((await completed.session()).finalReveal, ended.finalReveal);
  assert.deepEqual((await versionRef.get()).data(), version); assert.equal((await completed.rawPublic()).finalReveal, undefined);
  await denied(completed.command('resume'), 'failed-precondition');
  const restore = { eventId: completed.eventId, expectedRevision: (await eventRef.get()).get('revision'), requestId: randomUUID(), action: 'restore' };
  const restored = await completed.admin.call('restoreEvent', restore);
  assert.equal(restored.disposition, 'archived');
  await assertHistory();
  assert.deepEqual(await completed.admin.call('restoreEvent', restore), restored); await assertHistory();
  await completed.admin.call('restoreEvent', { eventId: completed.eventId, expectedRevision: restored.revision, requestId: randomUUID(), action: 'unarchive' });
  assert.equal((await eventRef.get()).get('disposition'), 'active'); await assertHistory();
  await completed.admin.call('trashEvent', { eventId: completed.eventId, expectedRevision: (await eventRef.get()).get('revision'), requestId: randomUUID() });
  await completed.admin.call('restoreEvent', { eventId: completed.eventId, expectedRevision: (await eventRef.get()).get('revision'), requestId: randomUUID(), action: 'restore' });
  assert.equal((await eventRef.get()).get('disposition'), 'active'); await assertHistory();
  await denied(completed.command('resume'), 'failed-precondition');
  console.log('PASS completion history: ten revealed rows, final pages, closing slide, END, complete, fresh scoped reads, receipt replay, archive, trash, restore and unarchive; public output stays neutral.');
} finally { await completed.close(); }

const cancelled = await finalFixture(1);
try {
  await cancelled.startFinal(await cancelled.previewFinal());
  const confirmed = await cancelled.session(), eventRef = cancelled.db.doc('events/' + cancelled.eventId);
  await cancelled.admin.call('cancelEvent', { eventId: cancelled.eventId, expectedRevision: (await eventRef.get()).get('revision'), endLive: true, requestId: randomUUID() });
  assert.equal((await eventRef.get()).get('lifecycleStatus'), 'cancelled');
  assert.equal((await cancelled.session()).finalReveal.versionId, confirmed.finalReveal.versionId);
  assert.equal((await cancelled.session()).finalReveal.visible, false); assert.equal((await cancelled.rawPublic()).finalReveal, undefined);
  await denied(cancelled.command('resume'), 'failed-precondition');
  await cancelled.admin.call('trashEvent', { eventId: cancelled.eventId, expectedRevision: (await eventRef.get()).get('revision'), requestId: randomUUID() });
  assert.equal((await cancelled.session()).finalReveal.versionId, confirmed.finalReveal.versionId);
  assert.equal((await cancelled.rawPublic()).status, 'ended'); assert.equal((await cancelled.rawPublic()).finalReveal, undefined);
  await cancelled.admin.call('restoreEvent', { eventId: cancelled.eventId, expectedRevision: (await eventRef.get()).get('revision'), requestId: randomUUID(), action: 'restore' });
  assert.equal((await eventRef.get()).get('lifecycleStatus'), 'cancelled');
  assert.equal((await eventRef.get()).get('liveSessionId'), undefined);
  assert.equal((await cancelled.session()).status, 'ended');
  assert.equal((await cancelled.rawPublic()).finalReveal, undefined);
  console.log('PASS cancellation/trash/restore: outcome stays cancelled, confirmed private identity retained, live event pointer cleared, publication neutral and resume rejected.');
} finally { await cancelled.close(); }
