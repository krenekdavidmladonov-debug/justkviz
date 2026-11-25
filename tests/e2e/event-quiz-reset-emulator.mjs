import { seedEmptyQuiz } from './legacy-quiz-fixture.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { editorIdentity } from './editor-identity.mjs';
import { mediaSlide } from './media-fixture.mjs';
import { localEmulatorEndpoint, requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';

const environment = requireFullEmulatorEnvironment(process.env, 'N11 version and score reset');
assert.equal(environment.projectId, 'demo-filmovy-kviz-v2');
const hubEndpoint = localEmulatorEndpoint(process.env.FIREBASE_EMULATOR_HUB, 'Emulator Hub');
const running = await (await fetch('http://' + hubEndpoint.host + ':' + hubEndpoint.port + '/emulators')).json();
for (const [name, endpoint] of [['auth', environment.authEndpoint], ['firestore', environment.firestoreEndpoint], ['functions', environment.functionsEndpoint]]) {
  assert.equal(running[name]?.host, endpoint.host);
  assert.equal(running[name]?.port, endpoint.port);
}
console.log('PASS: explicit demo project and actual loopback Auth, Firestore and Functions verified before fixture writes');
const identity = await editorIdentity(), { db, call } = identity;
const denied = (promise, code) => assert.rejects(promise, error => error.code === 'functions/' + code);
const endpoint = 'http://' + environment.functionsEndpoint.host + ':' + environment.functionsEndpoint.port + '/' + environment.projectId + '/europe-west1/';
async function anonymous(name, data) {
  const response = await fetch(endpoint + name, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) });
  const result = await response.json();
  if (result.error) throw Object.assign(new Error(result.error.message), { code: 'functions/' + result.error.status.toLowerCase().replaceAll('_', '-') });
  return result.result;
}
let groups = 0;
const pass = message => { groups++; console.log('PASS N11: ' + message); };
try {
  const { quizId } = await seedEmptyQuiz(db, 'Synthetic N11 version quiz');
  const quizRef = db.doc('quizzes/' + quizId), quiz = async () => (await quizRef.get()).data();
  const slides = async () => (await quizRef.collection('slides').orderBy('position').get()).docs.map(row => ({ id: row.id, ...row.data() }));
  async function add(kind, extra = {}, position) {
    return call('createQuizSlide', { quizId, expectedRevision: (await quiz()).revision, position: position ?? (await slides()).length + 1,
      ...(['intro', 'end'].includes(kind) ? { scope: 'quiz' } : {}), slide: mediaSlide(kind, extra) });
  }
  await add('intro');
  await call('createQuizRound', { quizId, expectedRevision: (await quiz()).revision, title: 'Synthetic round' });
  await add('free', { correctAnswer: 'Synthetic private answer', text: 'Synthetic question' }, (await slides()).find(row => row.kind === 'recap').position);
  await add('end');
  const { eventId } = await call('createEvent', { expectedRevision: 0, event: { title: 'Synthetic N11 event', startsAt: '2031-11-20T18:00:00Z', timeZone: 'Europe/Prague',
    venue: { name: 'Synthetic', publicLocation: 'Synthetic' }, teamCapacity: 10, peopleCapacity: 40, teamSizeMin: 2, teamSizeMax: 4 } });
  const eventRef = db.doc('events/' + eventId), event = async () => (await eventRef.get()).data();
  const teams = [];
  for (let index = 0; index < 2; index++) teams.push((await call('adminAddEventTeam', { eventId, teamName: 'N11 team ' + index, memberCount: 2, requestId: randomUUID() })).registrationId);
  const lock = async options => call('lockEventQuiz', { eventId, quizId, expectedRevision: (await event()).revision, expectedQuizRevision: (await quiz()).revision, acknowledgeWarnings: false, ...options });
  let assignment = await lock();
  const roundId = (await db.collection('quizSnapshots/' + assignment.snapshotId + '/rounds').get()).docs[0].id;
  const originalSnapshot = assignment.snapshotId, originalSnapshotData = (await db.doc('quizSnapshots/' + originalSnapshot).get()).data();
  pass('first quiz assignment before rehearsal remains available');
  const base = () => ({ eventId, snapshotId: assignment.snapshotId, roundId, teamId: teams[0], expectedRevision: 0, halfPoints: 0, reason: '', requestId: randomUUID() });
  const firstRequest = base(), first = await call('saveEventScore', firstRequest);
  await call('saveEventScore', { ...base(), expectedRevision: 1, halfPoints: 2, reason: 'Synthetic rehearsal correction' });
  const oldEmptyRequest = { ...base(), teamId: teams[1] };
  const scoreRef = eventRef.collection('scores').doc(first.scoreId);
  assert.equal((await scoreRef.collection('history').get()).size, 2);
  const live = await call('createEventLiveSession', { eventId, expectedRevision: (await event()).revision });
  const sessionRef = db.doc('sessions/' + live.sessionId), session = async () => (await sessionRef.get()).data();
  const question = (await slides()).find(row => row.isQuestion);
  await call('goToSlide', { sessionId: live.sessionId, expectedRevision: 0, position: question.position });
  await call('goToSlide', { sessionId: live.sessionId, expectedRevision: (await session()).revision, position: 1 });
  assert.equal((await session()).hasPresentedQuestion, true);
  await denied(lock({ scoreAction: 'preserve', closeUnplayedSession: true }), 'failed-precondition');
  await denied(call('resetEventScores', { eventId, expectedRevision: (await event()).revision, requestId: randomUUID(), confirm: 'SMAZAT' }), 'failed-precondition');
  pass('active played session stays blocked even after navigation back to intro');
  await eventRef.update({ lifecycleStatus: 'finalizing' });
  const beforeEnd = await event();
  await call('endLiveSession', { sessionId: live.sessionId, expectedRevision: (await session()).revision });
  const afterEnd = await event();
  assert.equal(afterEnd.liveSessionId, undefined); assert.equal(afterEnd.lastEndedSessionId, live.sessionId); assert.equal(afterEnd.revision, beforeEnd.revision + 1);
  assert.equal(afterEnd.lifecycleStatus, beforeEnd.lifecycleStatus); assert.deepEqual(afterEnd.scoring, beforeEnd.scoring);
  assert.equal((await db.doc('publicSessions/' + live.sessionId).get()).get('status'), 'ended');
  // Existing historical pointer, with no production migration.
  await eventRef.update({ liveSessionId: live.sessionId });
  const view = await call('readAccessData', { operation: 'event', eventId });
  assert.equal(view.data.lastEndedSessionId, undefined);
  assert.equal(view.data.quizChangeState.hasActiveSession, false);
  assert.equal(view.data.quizChangeState.scoreDocumentCount, 1);
  const current = await event();
  await call('updateEvent', { eventId, expectedRevision: current.revision, event: { title: current.title, startsAt: current.startsAt.toDate().toISOString(), timeZone: current.timeZone, venue: current.venue,
    teamCapacity: current.teamCapacity, peopleCapacity: current.peopleCapacity, teamSizeMin: current.teamSizeMin, teamSizeMax: current.teamSizeMax } });
  pass('bare END releases event pointer; a legacy ended pointer is editable and treated as inactive');
  await call('updateQuizMetadata', { quizId, expectedRevision: (await quiz()).revision, quiz: { title: 'Synthetic N11 revised version', description: '' } });
  await quizRef.collection('rounds').doc(roundId).update({ questionCount: 77 });
  const sourceView = await call('readAccessData', { operation: 'editor', quizId });
  assert.equal(sourceView.scoringRounds.find(row => row.id === roundId).questionCount, 1);
  assignment = await lock({ scoreAction: 'preserve' });
  assert.equal((await db.doc('quizSnapshots/' + assignment.snapshotId + '/rounds/' + roundId).get()).get('questionCount'), 1);
  assert.notEqual(assignment.snapshotId, originalSnapshot);
  assert.equal((await scoreRef.get()).get('snapshotId'), assignment.snapshotId);
  assert.equal((await scoreRef.get()).get('halfPoints'), 2); assert.equal((await scoreRef.get()).get('revision'), 2);
  assert.equal((await scoreRef.collection('history').get()).size, 2);
  assert.deepEqual((await db.doc('quizSnapshots/' + originalSnapshot).get()).data(), originalSnapshotData);
  assert.equal((await event()).liveSessionId, undefined);
  pass('compatible relock after rehearsal preserves values, revisions and history and keeps the original snapshot immutable');
  await add('free', { correctAnswer: 'Synthetic second answer' }, (await slides()).find(row => row.kind === 'recap').position);
  await denied(lock({ scoreAction: 'preserve' }), 'failed-precondition');
  for (const confirm of [undefined, 'smazat', 'SMAZAT ']) await denied(lock({ scoreAction: 'discard', confirm }), 'invalid-argument');
  assert.equal((await scoreRef.get()).get('halfPoints'), 2);
  assignment = await lock({ scoreAction: 'discard', confirm: 'SMAZAT' });
  assert.equal((await event()).scoring.started, false); assert.equal((await event()).scoring.epoch, 1);
  assert.equal((await eventRef.collection('scores').get()).size, 0); assert.equal((await scoreRef.collection('history').get()).size, 0);
  await denied(call('saveEventScore', firstRequest), 'aborted'); await denied(call('saveEventScore', oldEmptyRequest), 'aborted');
  pass('incompatible rounds require exact discard confirmation; atomic relock removes scores/history and rejects old receipts and empty-cell drafts');
  const legacyUnknown = await call('createEventLiveSession', { eventId, expectedRevision: (await event()).revision });
  await call('goToSlide', { sessionId: legacyUnknown.sessionId, expectedRevision: 0, position: 1 });
  const legacyRef = db.doc('sessions/' + legacyUnknown.sessionId), { hasPresentedQuestion, ...legacySession } = (await legacyRef.get()).data();
  assert.equal(hasPresentedQuestion, false);
  await legacyRef.set(legacySession);
  const legacyView = await call('readAccessData', { operation: 'event', eventId });
  assert.equal(legacyView.data.quizChangeState.hasPresentedQuestion, false);
  assert.equal(legacyView.data.quizChangeState.hasUnknownQuestionHistory, true);
  await assert.rejects(lock({ closeUnplayedSession: true }), error => error.code === 'functions/failed-precondition' && error.message.includes('Starší moderování'));
  await call('endLiveSession', { sessionId: legacyUnknown.sessionId, expectedRevision: 1 });
  const unplayed = await call('createEventLiveSession', { eventId, expectedRevision: (await event()).revision });
  await call('goToSlide', { sessionId: unplayed.sessionId, expectedRevision: 0, position: 1 });
  assert.equal((await db.doc('sessions/' + unplayed.sessionId).get()).get('hasPresentedQuestion'), false);
  await denied(lock(), 'failed-precondition');
  const memberRef = (await db.collection('memberships').where('email', '==', identity.email).get()).docs[0].ref;
  const member = (await memberRef.get()).data();
  try {
    await memberRef.update({ permissions: member.permissions.filter(permission => permission !== 'event.live'), version: member.version + 1 });
    await denied(lock({ closeUnplayedSession: true }), 'permission-denied');
  } finally { await memberRef.set(member); }
  assignment = await lock({ closeUnplayedSession: true });
  assert.equal((await event()).liveSessionId, undefined);
  assert.equal((await db.doc('sessions/' + unplayed.sessionId).get()).get('status'), 'ended');
  pass('unplayed active moderation is closed atomically only with explicit intent and scoped event.live');
  const epochOneStaff = { ...base(), scoringEpoch: 1 };
  await call('saveEventScore', epochOneStaff);
  const issued = await call('issueRefereeAccess', { eventId, requestId: randomUUID(), label: 'Synthetic reset referee', expiresAt: new Date(Date.now() + 3600000).toISOString() });
  const credential = { eventId, accessId: issued.accessId, key: issued.key };
  assert.equal((await anonymous('readRefereeEvent', credential)).scoringEpoch, 1);
  const oldRound = { eventId, snapshotId: assignment.snapshotId, roundId, requestId: randomUUID(), scoringEpoch: 1,
    scores: [{ teamId: teams[1], expectedRevision: 0, halfPoints: 3, reason: '' }] };
  await anonymous('saveRefereeScore', { credential, score: oldRound });
  const orphanRef = eventRef.collection('scores').doc('synthetic-orphan-' + randomUUID());
  await orphanRef.collection('history').doc('1').set({ revision: 1, halfPoints: 0, previousHalfPoints: null, reason: 'Synthetic orphan history' });
  const resetInput = { eventId, expectedRevision: (await event()).revision, requestId: randomUUID(), confirm: 'SMAZAT' };
  await denied(anonymous('resetEventScores', resetInput), 'unauthenticated');
  for (const confirm of [undefined, 'smazat', 'SMAZAT ']) await denied(call('resetEventScores', { ...resetInput, confirm }), 'invalid-argument');
  await denied(call('resetEventScores', { ...resetInput, expectedRevision: resetInput.expectedRevision - 1 }), 'aborted');
  for (const patch of [
    { permissions: member.permissions.filter(permission => permission !== 'event.manage') },
    { permissions: member.permissions.filter(permission => permission !== 'event.score') },
    { events: { mode: 'selected', ids: [] } }, { status: 'suspended' },
  ]) {
    try {
      await memberRef.set({ ...member, ...patch, version: member.version + 1 });
      await denied(call('resetEventScores', resetInput), 'permission-denied');
      if (patch.permissions && !patch.permissions.includes('event.score')) await denied(lock({ scoreAction: 'discard', confirm: 'SMAZAT' }), 'permission-denied');
    } finally { await memberRef.set(member); }
    assert.equal((await eventRef.collection('scores').get()).size, 2);
    assert.equal((await event()).scoring.epoch, 1);
  }
  const reset = await call('resetEventScores', resetInput);
  assert.equal((await event()).liveSessionId, undefined); assert.equal((await event()).lastEndedSessionId, undefined);
  assert.equal(reset.deletedScoreCount, 2); assert.equal(reset.deletedHistoryCount, 3); assert.equal(reset.scoringEpoch, 2);
  assert.equal((await orphanRef.collection('history').get()).size, 0);
  assert.equal((await eventRef.collection('scores').get()).size, 0);
  assert.equal((await event()).scoring.started, false); assert.equal((await eventRef.collection('registrations').get()).size, 2);
  assert.equal((await db.doc('quizSnapshots/' + assignment.snapshotId).get()).exists, true);
  const audits = await db.collection('eventAudit').where('eventId', '==', eventId).get();
  const resetAudits = audits.docs.filter(row => row.get('action') === 'reset-scores');
  assert.equal(resetAudits.length, 1); assert.equal(resetAudits[0].get('actorUid'), member.uid); assert.equal(resetAudits[0].get('deletedScoreCount'), 2);
  pass('reset requires both current scoped permissions, exact confirmation and revision, deletes orphan history too, and records one safe audit');
  await denied(call('saveEventScore', epochOneStaff), 'aborted');
  await denied(call('saveEventScore', { ...base(), scoringEpoch: 1 }), 'aborted');
  await denied(call('saveEventScore', base()), 'aborted');
  await denied(anonymous('saveRefereeScore', { credential, score: oldRound }), 'aborted');
  await denied(anonymous('saveRefereeScore', { credential, score: { ...oldRound, requestId: randomUUID() } }), 'aborted');
  await denied(anonymous('saveRefereeScore', { credential, score: { ...base(), scoringEpoch: 1 } }), 'aborted');
  const freshView = await anonymous('readRefereeEvent', credential);
  assert.equal(freshView.scoringEpoch, 2); assert.deepEqual(freshView.scores, []);
  const freshRequest = { ...base(), scoringEpoch: 2, halfPoints: 1 };
  const fresh = await call('saveEventScore', freshRequest);
  assert.deepEqual(await call('resetEventScores', resetInput), reset);
  assert.equal((await eventRef.collection('scores').get()).size, 1);
  assert.equal((await scoreRef.get()).get('halfPoints'), 1);
  const freshReferee = { ...base(), teamId: teams[1], scoringEpoch: 2, halfPoints: 2 };
  await anonymous('saveRefereeScore', { credential, score: freshReferee });
  pass('stale staff/referee single and round writes cannot resurrect scores, while fresh forms work and reset retry preserves new scores');
  for (const patch of [{ lifecycleStatus: 'completed' }, { lifecycleStatus: 'cancelled' }, { disposition: 'archived' }, { disposition: 'trash' }]) {
    const before = await event(); await eventRef.update(patch);
    await denied(call('resetEventScores', { eventId, expectedRevision: (await event()).revision, requestId: randomUUID(), confirm: 'SMAZAT' }), 'failed-precondition');
    await denied(lock({ scoreAction: 'preserve' }), 'failed-precondition');
    assert.equal((await eventRef.collection('scores').get()).size, 2);
    await eventRef.set(before);
  }
  const tree = async () => {
    const rows = (await eventRef.collection('scores').get()).docs;
    return JSON.stringify([await event(), await Promise.all(rows.map(async row => [row.id, row.data(), (await row.ref.collection('history').get()).docs.map(history => [history.id, history.data()])]))]);
  };
  const beforeStale = await tree();
  await denied(call('resetEventScores', { ...resetInput, requestId: randomUUID() }), 'aborted');
  assert.equal(await tree(), beforeStale);
  pass('terminal events and stale confirmations reject atomically without changing score or history data');
  const resetRace = { eventId, expectedRevision: (await event()).revision, requestId: randomUUID(), confirm: 'SMAZAT' };
  const race = await Promise.allSettled([
    call('resetEventScores', resetRace),
    call('saveEventScore', { ...freshRequest, requestId: randomUUID(), expectedRevision: fresh.revision, halfPoints: 3, reason: 'Synthetic concurrent save' }),
  ]);
  assert.equal(race[0].status, 'fulfilled');
  if (race[1].status === 'rejected') assert.equal(race[1].reason.code, 'functions/aborted');
  assert.equal((await eventRef.collection('scores').get()).size, 0); assert.equal((await event()).scoring.epoch, 3);
  pass('concurrent reset and old-generation save serialize without partial data or resurrection');
  const large = await call('saveEventScore', { ...base(), scoringEpoch: 3 });
  const largeRef = eventRef.collection('scores').doc(large.scoreId);
  for (let start = 2; start <= 601; start += 300) {
    const batch = db.batch();
    for (let revision = start; revision < Math.min(start + 300, 602); revision++) batch.set(largeRef.collection('history').doc(String(revision)), { revision, halfPoints: 0, previousHalfPoints: 0, reason: 'Synthetic bounded history', actorUid: member.uid });
    await batch.commit();
  }
  await largeRef.update({ revision: 601 });
  const largeReset = await call('resetEventScores', { eventId, expectedRevision: (await event()).revision, requestId: randomUUID(), confirm: 'SMAZAT' });
  assert.equal(largeReset.deletedHistoryCount, 601); assert.equal((await largeRef.collection('history').get()).size, 0);
  pass('more than 500 score/history deletes still commit as one atomic reset');
  // Legacy ended pointers must permit soft deletion too; no data is permanently deleted by this action.
  await eventRef.update({ liveSessionId: live.sessionId });
  await call('trashEvent', { eventId, expectedRevision: (await event()).revision, requestId: randomUUID() });
  assert.equal((await event()).disposition, 'trash');
  assert.equal((await db.doc('quizSnapshots/' + assignment.snapshotId).get()).exists, true);
  pass('ended historical pointer permits moving the event to trash while retaining its snapshot');
  console.log('PASS N11 version/reset acceptance: ' + groups + ' scenario groups');
} finally {
  requireFullEmulatorEnvironment(process.env, 'N11 synthetic identity cleanup');
  await identity.dispose();
}
