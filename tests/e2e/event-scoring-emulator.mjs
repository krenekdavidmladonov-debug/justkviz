import { seedEmulatorMembership } from '../../functions/lib/dev/seed-membership.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';

const env = requireFullEmulatorEnvironment(process.env, 'Scoring E2E');
const require = createRequire(new URL('../../functions/package.json', import.meta.url));
const adminSdk = require('firebase-admin/app');
const adminApp = adminSdk.initializeApp({ projectId: env.projectId }, 'score-fixtures');
const db = require('firebase-admin/firestore').getFirestore(adminApp);
const adminAuth = require('firebase-admin/auth').getAuth(adminApp);
function client(name) {
  const app = initializeApp({ apiKey: 'demo-api-key', projectId: env.projectId }, name);
  const auth = getAuth(app); connectAuthEmulator(auth, `http://${env.authEndpoint.host}:${env.authEndpoint.port}`, { disableWarnings: true });
  const functions = getFunctions(app, 'europe-west1'); connectFunctionsEmulator(functions, env.functionsEndpoint.host, env.functionsEndpoint.port);
  return { app, auth, call: async (name, data) => (await httpsCallable(functions, name)(data)).data };
}
const staff = client('score-admin'), moderator = client('score-moderator'), ordinary = client('score-user'), publicClient = client('score-public');
const login = async (client, role) => {
  const email = 'score-' + randomUUID() + '@example.test';
  const password = randomUUID();
  const user = await adminAuth.createUser({ email, password });
  await adminAuth.setCustomUserClaims(user.uid, role === 'user' ? {} : { role }); await seedEmulatorMembership(user.uid, role);
  return signInWithEmailAndPassword(client.auth, email, password);
};
const denied = (promise, code) => assert.rejects(promise, error => error.code === `functions/${code}`);
try {
  await Promise.all([login(staff, 'admin'), login(moderator, 'moderator'), login(ordinary, 'user')]);
  const { eventId } = await staff.call('createEvent', { expectedRevision: 0, event: {
    title: 'Synthetic scoring E2E', startsAt: '2031-01-01T18:00:00Z', timeZone: 'Europe/Prague',
    venue: { name: 'Synthetic', publicLocation: 'Synthetic' }, teamCapacity: 10, peopleCapacity: 40, teamSizeMin: 2, teamSizeMax: 4,
  } });
  const eventRef = db.doc(`events/${eventId}`);
  const eventData = async () => (await eventRef.get()).data();
  const manual = await staff.call('adminAddEventTeam', { eventId, requestId: randomUUID(), teamName: 'Manual no email', memberCount: 2 });
  assert.equal(manual.contactEmail, null);
  await staff.call('configureEventRegistration', { eventId, expectedRevision: (await eventData()).revision,
    registrationOpensAt: '2020-01-01T00:00:00Z', registrationClosesAt: '2031-01-01T00:00:00Z', published: true });
  const online = await publicClient.call('createEventRegistration', { eventId, teamName: 'Online team', memberCount: 2, contactEmail: 'synthetic@example.test' });
  const locked = await staff.call('lockEventQuiz', { eventId, expectedRevision: (await eventData()).revision,
    quizId: 'preflight-ready-e2e', expectedQuizRevision: 0, acknowledgeWarnings: false });
  const snapshotId = locked.snapshotId;
  const roundId = (await db.collection(`quizSnapshots/${snapshotId}/rounds`).get()).docs[0].id;
  const base = { eventId, snapshotId, teamId: manual.registrationId, roundId, expectedRevision: 0, halfPoints: 0, reason: '' };
  const write = (patch = {}, caller = staff) => caller.call('saveEventScore', { ...base, requestId: randomUUID(), ...patch });
  await denied(write({}, publicClient), 'unauthenticated');
  await denied(write({ managementToken: online.managementToken }, publicClient), 'unauthenticated');
  await denied(write({}, ordinary), 'permission-denied');
  for (const halfPoints of [-1, .5, Number.MAX_SAFE_INTEGER + 1, '0']) await denied(write({ halfPoints }), 'invalid-argument');
  await denied(write({ actorUid: 'forged' }), 'invalid-argument');
  for (const patch of [{ teamId: 'missing' }, { roundId: 'missing' }, { eventId: 'missing' }]) await denied(write(patch), 'not-found');
  await denied(write({ snapshotId: 'different' }), 'failed-precondition');
  const otherId = 'synthetic-other-' + randomUUID();
  await db.doc(`events/${otherId}/registrations/foreign`).set({ eventId: otherId, status: 'accepted' });
  await denied(write({ teamId: 'foreign' }), 'not-found');
  await db.doc(`events/${eventId}/registrations/not-accepted`).set({ eventId, status: 'pending' });
  await denied(write({ teamId: 'not-accepted' }), 'failed-precondition');
  const publicBefore = (await db.doc(`publicEvents/${eventId}`).get()).data();
  const requestId = randomUUID();
  const [first, retry] = await Promise.all([write({ requestId }), write({ requestId })]);
  assert.deepEqual(first, retry); assert.equal(first.revision, 1); assert.equal(first.halfPoints, 0);
  const scoreRef = eventRef.collection('scores').doc(first.scoreId);
  const history = async () => (await scoreRef.collection('history').orderBy('revision').get()).docs.map(doc => doc.data());
  assert.equal((await history()).length, 1);
  assert.equal((await eventData()).scoring.started, true);
  await denied(write({ requestId, halfPoints: 2 }), 'already-exists');
  await denied(write({ expectedRevision: 0, halfPoints: 3 }), 'aborted');
  await denied(write({ expectedRevision: 1, halfPoints: 3 }), 'invalid-argument');
  const revised = await write({ expectedRevision: 1, halfPoints: 3, reason: 'Recount' }, moderator);
  assert.equal(revised.revision, 2);
  // Identical IDs from different actors are separate operations, never a forged receipt.
  await denied(write({ requestId }, moderator), 'aborted');
  const race = await Promise.allSettled([
    write({ expectedRevision: 2, halfPoints: 4, reason: 'View A' }),
    write({ expectedRevision: 2, halfPoints: 5, reason: 'View B' }, moderator),
  ]);
  assert.equal(race.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(race.find(result => result.status === 'rejected').reason.code, 'functions/aborted');
  assert.equal((await history()).length, 3);
  await denied(write({ expectedRevision: 3, halfPoints: null }), 'invalid-argument');
  const clearKey = randomUUID();
  const cleared = await write({ requestId: clearKey, expectedRevision: 3, halfPoints: null, reason: 'Wrong team' });
  assert.equal(cleared.revision, 4); assert.equal(cleared.halfPoints, null);
  assert.deepEqual(await write({ requestId: clearKey, expectedRevision: 3, halfPoints: null, reason: 'Wrong team' }), cleared);
  await denied(write(), 'aborted');
  await write({ expectedRevision: 4, halfPoints: 1 });
  const entries = await history();
  assert.deepEqual(entries.map(item => item.revision), [1, 2, 3, 4, 5]);
  assert.equal(entries[0].previousHalfPoints, null); assert.equal(entries[0].halfPoints, 0);
  assert.equal(entries[1].actorUid, moderator.auth.currentUser.uid);
  for (let i = 1; i < entries.length; i++) assert.equal(entries[i].previousHalfPoints, entries[i - 1].halfPoints);
  assert(entries.every(item => item.createdAt && item.actorUid));
  assert.deepEqual(await write({ requestId }), first); // Old receipt after later corrections.
  // Current membership must be checked even with an otherwise valid stale ID token and receipt.
  await seedEmulatorMembership(staff.auth.currentUser.uid, 'user');
  try { await denied(write({ requestId }), 'permission-denied'); }
  finally { await seedEmulatorMembership(staff.auth.currentUser.uid, 'admin'); }
  // Scoring uses immutable round IDs after library edits.
  const libraryRound = db.doc(`quizzes/preflight-ready-e2e/rounds/${roundId}`);
  const originalRound = (await libraryRound.get()).data();
  await libraryRound.delete();
  try { await write({ teamId: online.registrationId, halfPoints: 9 }, moderator); }
  finally { await libraryRound.set(originalRound); }
  await denied(staff.call('lockEventQuiz', { eventId, expectedRevision: (await eventData()).revision, quizId: 'preflight-ready-e2e', expectedQuizRevision: 0, acknowledgeWarnings: false }), 'failed-precondition');
  assert.deepEqual((await db.doc(`publicEvents/${eventId}`).get()).data(), publicBefore);
  assert.equal((await db.doc(`publicSessions/${eventId}`).get()).exists, false);
  await staff.call('adminCancelEventRegistration', { eventId, registrationId: manual.registrationId });
  await denied(write({ expectedRevision: 5, halfPoints: 8, reason: 'Cancelled' }), 'failed-precondition');
  assert.deepEqual(await history(), entries);
  for (const lifecycleStatus of ['draft', 'scheduled', 'completed', 'cancelled', 'archived']) {
    await eventRef.update({ lifecycleStatus });
    await denied(write({ teamId: online.registrationId, expectedRevision: 1, halfPoints: 10, reason: 'Closed' }), 'failed-precondition');
  }
  for (const lifecycleStatus of ['ready', 'live', 'finalizing']) {
    await eventRef.update({ lifecycleStatus });
    const current = (await eventRef.collection('scores').where('teamId', '==', online.registrationId).get()).docs[0].data();
    await write({ teamId: online.registrationId, expectedRevision: current.revision, halfPoints: current.halfPoints + 1, reason: 'Operational phase' });
  }
  // A whole-round intent uses the same ledger and fails atomically on one stale team.
  const batchPublicBefore = (await db.doc(`publicEvents/${eventId}`).get()).data();
  const batchTeams = ['round-a-' + randomUUID(), 'round-b-' + randomUUID()];
  for (const teamId of batchTeams) await eventRef.collection('registrations').doc(teamId).set({ eventId, teamName: 'Synthetic round team', status: 'accepted' });
  const roundInput = { eventId, snapshotId, roundId, requestId: randomUUID(), scores: batchTeams.map((teamId, index) => ({ teamId, expectedRevision: 0, halfPoints: index === 0 ? 0 : 5, reason: '' })) };
  const roundWrite = (input = roundInput, caller = staff) => caller.call('saveEventScore', input);
  await denied(roundWrite(roundInput, publicClient), 'unauthenticated');
  await denied(roundWrite(roundInput, ordinary), 'permission-denied');
  const batch = await roundWrite(); assert.equal(batch.scores.length, 2); assert.equal(batch.scores[0].revision, 1);
  assert.deepEqual(await roundWrite({ ...roundInput, scores: [...roundInput.scores].reverse() }), batch);
  await denied(roundWrite({ ...roundInput, scores: [{ ...roundInput.scores[0], halfPoints: 7 }] }), 'already-exists');
  const staleRound = { ...roundInput, requestId: randomUUID(), scores: roundInput.scores.map((score, index) => ({ ...score, expectedRevision: index === 0 ? 0 : 1, halfPoints: 8, reason: 'Synthetic conflict' })) };
  await denied(roundWrite(staleRound, moderator), 'aborted');
  for (const score of batch.scores) {
    const ref = eventRef.collection('scores').doc(score.scoreId); assert.equal((await ref.get()).data().revision, 1); assert.equal((await ref.collection('history').get()).size, 1);
  }
  await seedEmulatorMembership(staff.auth.currentUser.uid, 'user');
  try { await denied(roundWrite(), 'permission-denied'); } finally { await seedEmulatorMembership(staff.auth.currentUser.uid, 'admin'); }
  const clearedRound = await roundWrite({ ...roundInput, requestId: randomUUID(), scores: roundInput.scores.map(score => ({ ...score, expectedRevision: 1, halfPoints: null, reason: 'Synthetic clearing' })) });
  assert(clearedRound.scores.every(score => score.revision === 2 && score.halfPoints === null));
  assert.deepEqual((await db.doc(`publicEvents/${eventId}`).get()).data(), batchPublicBefore);
  console.log('PASS: single and atomic round scoring, current authorization, immutable rounds, private publication, history and lifecycle (demo emulators only).');
} finally {
  await Promise.all([staff, moderator, ordinary, publicClient].map(client => deleteApp(client.app)));
  await adminSdk.deleteApp(adminApp);
}
