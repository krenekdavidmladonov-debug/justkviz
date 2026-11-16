// Real callable integration; fixtures and inspection are restricted to demo loopback emulators.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { getFirestore, connectFirestoreEmulator, doc, getDocFromServer } from 'firebase/firestore';
import { seedEmulatorMembership } from '../../functions/lib/dev/seed-membership.js';
import { requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';

const env = requireFullEmulatorEnvironment(process.env, 'Extraordinary stress E2E');
const require = createRequire(new URL('../../functions/package.json', import.meta.url));
const adminSdk = require('firebase-admin/app');
const adminApp = adminSdk.initializeApp({ projectId: env.projectId }, 'stress-' + randomUUID());
const db = require('firebase-admin/firestore').getFirestore(adminApp);
const adminAuth = require('firebase-admin/auth').getAuth(adminApp);
const apps = [], users = [], scenarios = [], metrics = [];
function client() {
  const app = initializeApp({ apiKey: 'demo-api-key', projectId: env.projectId }, randomUUID());
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${env.authEndpoint.host}:${env.authEndpoint.port}`, { disableWarnings: true });
  const functions = getFunctions(app, 'europe-west1');
  connectFunctionsEmulator(functions, env.functionsEndpoint.host, env.functionsEndpoint.port);
  const store = getFirestore(app);
  connectFirestoreEmulator(store, env.firestoreEndpoint.host, env.firestoreEndpoint.port);
  return { auth, store, call: async (name, data) => (await httpsCallable(functions, name)(data)).data };
}
async function staff(role) {
  const c = client(), credentials = { email: randomUUID() + '@example.test', password: randomUUID() };
  const user = await adminAuth.createUser(credentials);
  users.push(user.uid);
  await seedEmulatorMembership(user.uid, role);
  await signInWithEmailAndPassword(c.auth, credentials.email, credentials.password);
  return c;
}
const deny = (promise, code) => assert.rejects(promise, error => error.code === `functions/${code}`);
const privateDenied = promise => assert.rejects(promise, error => error.code === 'permission-denied');
const safePublic = value => assert(!/PRIVATE_STRESS|"(?:correctAnswer|revealedAnswer|contactEmail|managementTokenHash|actorUid|sourceFingerprint|snapshotId|teamId|rowTeamIds|teamRanks)"/iu.test(JSON.stringify(value)));

try {
  const admin = await staff('admin'), moderator = await staff('moderator'), anonymous = client();
  // This unique library fixture follows the established preflight-ready seed shape.
  const quizId = 'stress-' + randomUUID(), quizRef = db.doc(`quizzes/${quizId}`);
  const batch = db.batch(), now = require('firebase-admin/firestore').Timestamp.now();
  batch.set(quizRef, { title: 'JustKvíz synthetic stress', description: 'Local synthetic fixture', status: 'ready', revision: 0,
    createdBy: admin.auth.currentUser.uid, updatedBy: admin.auth.currentUser.uid, createdAt: now, updatedAt: now,
    slideCount: 6, roundCount: 2, questionCount: 2 });
  for (let r = 1; r <= 2; r++) {
    const roundId = `r${r}`, title = `Synthetic round ${r}`;
    batch.set(quizRef.collection('rounds').doc(roundId), { title, type: 'classic', position: r, slideCount: 3, questionCount: 1 });
    const slides = [
      { kind: 'round', isQuestion: false, title, text: '', correctAnswer: '' },
      { kind: 'free', isQuestion: true, title: '', text: 'Synthetic prompt', correctAnswer: 'PRIVATE_STRESS_ANSWER',
        mediaSource: '', clipStartSeconds: null, clipEndSeconds: null, questionNumber: 1, questionCount: 1 },
      { kind: 'recap', isQuestion: false, title: 'Synthetic recap', text: '', correctAnswer: '' },
    ];
    slides.forEach((slide, index) => batch.set(quizRef.collection('slides').doc(`s${(r - 1) * 3 + index + 1}`), {
      ...slide, position: (r - 1) * 3 + index + 1, roundId, roundTitle: title, options: [], media: [], presentation: {},
    }));
    batch.set(quizRef.collection('rounds').doc(roundId).collection('questions').doc(`s${(r - 1) * 3 + 2}`), {
      type: 'text', prompt: 'Synthetic prompt', correctAnswer: 'PRIVATE_STRESS_ANSWER', position: 1,
    });
  }
  await batch.commit();
  const { eventId } = await admin.call('createEvent', { expectedRevision: 0, event: {
    title: 'JustKvíz synthetic ten-team stress', startsAt: '2031-11-20T18:00:00Z', timeZone: 'Europe/Prague',
    venue: { name: 'Synthetic', publicLocation: 'Synthetic' }, teamCapacity: 10, peopleCapacity: 40, teamSizeMin: 2, teamSizeMax: 4,
  } });
  const eventRef = db.doc(`events/${eventId}`), event = async () => (await eventRef.get()).data();
  const teams = [];
  for (let i = 1; i <= 10; i++) {
    const teamName = `QA${String(i).padStart(2, '0')}`;
    const contactEmail = i === 1 ? 'PRIVATE_STRESS_CONTACT@example.test' : null;
    const added = await admin.call('adminAddEventTeam', { eventId, requestId: randomUUID(), teamName, memberCount: 2,
      ...(contactEmail ? { contactEmail } : {}) });
    assert.equal(added.contactEmail?.toLowerCase() ?? null, contactEmail?.toLowerCase() ?? null);
    teams.push({ teamName, teamId: added.registrationId, round1HalfPoints: 2 * i, round2HalfPoints: 2 * (11 - i) });
  }
  assert.equal((await event()).acceptedTeams, 10);
  await deny(admin.call('adminAddEventTeam', { eventId, requestId: randomUUID(), teamName: 'QA11', memberCount: 2 }), 'resource-exhausted');
  const { snapshotId } = await admin.call('lockEventQuiz', { eventId, expectedRevision: (await event()).revision,
    quizId, expectedQuizRevision: 0, acknowledgeWarnings: false });
  assert.equal((await db.collection(`quizSnapshots/${snapshotId}/rounds`).get()).size, 2);
  scenarios.push('Ten accepted QA01..QA10 manual registrations, capacity overflow denied, real immutable quiz lock');
  const { sessionId } = await moderator.call('createEventLiveSession', { eventId, expectedRevision: (await event()).revision });
  await moderator.call('nextSlide', { sessionId, expectedRevision: 0 });
  const sessionRef = db.doc(`sessions/${sessionId}`), session = async () => (await sessionRef.get()).data();
  const publicState = async () => (await getDocFromServer(doc(anonymous.store, 'publicSessions', sessionId))).data();
  await moderator.call('nextSlide', { sessionId, expectedRevision: (await session()).revision });
  const score = (team, roundId, halfPoints, extra = {}, caller = admin) => caller.call('saveEventScore', {
    eventId, snapshotId, teamId: team.teamId, roundId, expectedRevision: 0, halfPoints, reason: '', requestId: randomUUID(), ...extra,
  });
  await deny(score(teams[0], 'r1', 2, {}, anonymous), 'unauthenticated');
  await privateDenied(getDocFromServer(doc(anonymous.store, 'quizSnapshots', snapshotId)));
  await privateDenied(getDocFromServer(doc(anonymous.store, 'events', eventId, 'registrations', teams[0].teamId)));
  const before = await publicState(); safePublic(before);
  assert.equal(before.text, 'Synthetic prompt'); assert.equal(before.answerRevealed, false);
  // First write opens scoring; the subsequent ten independent cells run concurrently.
  const firstRequestId = randomUUID();
  const first = await score(teams[0], 'r1', 2, { requestId: firstRequestId });
  for (let i = 1; i < 10; i++) await score(teams[i], 'r1', teams[i].round1HalfPoints);
  const started = performance.now(), durations = [];
  const round2 = await Promise.all(teams.map(async team => {
    const start = performance.now();
    const receipt = await score(team, 'r2', team.round2HalfPoints);
    durations.push(performance.now() - start);
    return receipt;
  }));
  const wallMs = performance.now() - started;
  durations.sort((a, b) => a - b);
  assert(round2.every(receipt => receipt.revision === 1));
  metrics.push({ operation: 'saveEventScore round2', concurrentRequests: 10, succeeded: round2.length,
    wallMs: Math.round(wallMs), p50Ms: Math.round(durations[4]), p95Ms: Math.round(durations[9]), scope: 'local emulator callable latency; no production load claim' });
  assert.deepEqual(await publicState(), before);
  const operationsBeforeRetry = (await eventRef.collection('scoreOperations').get()).size;
  assert.equal(operationsBeforeRetry, 20);
  assert.deepEqual(await score(teams[0], 'r1', 2, { requestId: firstRequestId }), first);
  assert.equal((await eventRef.collection('scoreOperations').get()).size, operationsBeforeRetry);
  assert.equal((await eventRef.collection('scores').doc(first.scoreId).collection('history').get()).size, 1);
  await deny(score(teams[0], 'r1', 4, { expectedRevision: 0, reason: 'Synthetic stale tab' }), 'aborted');
  const cellsBeforeConflict = (await eventRef.collection('scores').get()).docs.map(item => ({ id: item.id, ...item.data() }));
  await deny(admin.call('saveEventScore', { eventId, snapshotId, roundId: 'r2', requestId: randomUUID(),
    scores: teams.map((team, i) => ({ teamId: team.teamId, expectedRevision: i === 0 ? 0 : 1,
      halfPoints: team.round2HalfPoints + 2, reason: 'Synthetic batch conflict' })) }), 'aborted');
  assert.deepEqual((await eventRef.collection('scores').get()).docs.map(item => ({ id: item.id, ...item.data() })), cellsBeforeConflict);
  assert.equal((await eventRef.collection('scoreOperations').get()).size, operationsBeforeRetry);
  scenarios.push('Twenty score cells through Functions; ten concurrent round2 requests; retry idempotency and stale revision rejection; no implicit publication');
  scenarios.push('Atomic ten-team round conflict leaves every score and operation cardinality unchanged');
  const interim = await moderator.call('previewInterimResults', { eventId, sessionId, throughRoundId: 'r1' });
  assert.equal(interim.complete, true); assert.equal(interim.rows.length, 10);
  assert.equal(interim.rows[0].teamName, 'QA10'); assert.equal(interim.rows[0].halfPoints, 20);
  await moderator.call('controlInterimResults', { eventId, sessionId, action: 'publish', requestId: randomUUID(),
    expectedRevision: interim.sessionRevision, throughRoundId: 'r1', sourceFingerprint: interim.sourceFingerprint });
  const interimPublished = await publicState(); safePublic(interimPublished);
  assert.deepEqual(interimPublished.interimResults.rows, interim.rows.slice(0, 8));
  const final = await moderator.call('previewFinalResults', { eventId, sessionId });
  assert.equal(final.complete, true); assert.equal(final.includedRounds.length, 2);
  const expectedRows = teams.map(team => ({ rank: 1, teamName: team.teamName, halfPoints: 22 }));
  assert.deepEqual(final.rows, expectedRows);
  const confirmed = await moderator.call('controlFinalReveal', { eventId, sessionId, action: 'start', requestId: randomUUID(),
    expectedRevision: final.sessionRevision, versionId: final.publishedVersionId, sourceFingerprint: final.sourceFingerprint });
  const finalCommand = async (action, extra = {}) => moderator.call('controlFinalReveal', { eventId, sessionId, action,
    requestId: randomUUID(), expectedRevision: (await session()).revision, versionId: confirmed.versionId, ...extra });
  assert.deepEqual((await publicState()).finalReveal.rows, []);
  assert.equal((await finalCommand('reveal')).winnerRevealed, true);
  const page1 = await publicState(); safePublic(page1);
  assert.equal(page1.finalReveal.groupSize, 10); assert.equal(page1.finalReveal.pageCount, 2);
  assert.deepEqual(page1.finalReveal.rows, expectedRows.slice(0, 8));
  await finalCommand('page', { page: 1 });
  const page2 = await publicState(); safePublic(page2);
  assert.deepEqual(page2.finalReveal.rows, expectedRows.slice(8));
  scenarios.push('Explicit interim publication; final total22/rank1 for all ten actual teams; unrevealed intro and both tied winner pages');
  // A correction must append history without mutating either confirmed result version.
  const finalRef = sessionRef.collection('finalVersions').doc(confirmed.versionId);
  const versionBefore = (await finalRef.get()).data();
  const originalHistory = (await eventRef.collection('scores').doc(first.scoreId).collection('history').doc('1').get()).data();
  const race = await Promise.allSettled([
    score(teams[0], 'r1', 4, { expectedRevision: 1, reason: 'Synthetic recount A' }),
    score(teams[0], 'r1', 6, { expectedRevision: 1, reason: 'Synthetic recount B' }, moderator),
  ]);
  assert.equal(race.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(race.find(result => result.status === 'rejected').reason.code, 'functions/aborted');
  assert.deepEqual(await publicState(), page2);
  assert.deepEqual((await finalRef.get()).data(), versionBefore);
  assert.deepEqual((await eventRef.collection('scores').doc(first.scoreId).collection('history').doc('1').get()).data(), originalHistory);
  await score(teams[0], 'r1', 2, { expectedRevision: 2, reason: 'Synthetic recount restored' });
  assert.deepEqual(await score(teams[0], 'r1', 2, { requestId: firstRequestId }), first);
  const storedScores = await eventRef.collection('scores').get();
  assert.equal(storedScores.size, 20);
  const rows = [];
  let historyCount = 0;
  for (const team of teams) {
    const cells = storedScores.docs.filter(item => item.data().teamId === team.teamId);
    assert.equal(cells.length, 2);
    const values = Object.fromEntries(cells.map(item => [item.data().roundId, item.data().halfPoints]));
    assert.equal(values.r1, team.round1HalfPoints); assert.equal(values.r2, team.round2HalfPoints);
    for (const cell of cells) {
      const history = (await cell.ref.collection('history').orderBy('revision').get()).docs.map(item => item.data());
      historyCount += history.length;
      assert.equal(history.length, cell.data().revision);
      assert.deepEqual(history.map(item => item.revision), Array.from({ length: history.length }, (_, i) => i + 1));
      assert.equal(history[0].previousHalfPoints, null);
      assert(history.every(item => item.actorUid && item.createdAt));
      for (let i = 1; i < history.length; i++) assert.equal(history[i].previousHalfPoints, history[i - 1].halfPoints);
    }
    rows.push({ teamName: team.teamName, round1HalfPoints: values.r1, round2HalfPoints: values.r2,
      totalHalfPoints: values.r1 + values.r2, points: (values.r1 + values.r2) / 2, rank: final.rows.find(row => row.teamName === team.teamName).rank });
  }
  assert.equal(historyCount, 22);
  assert.deepEqual((await moderator.call('previewFinalResults', { eventId, sessionId })).rows, expectedRows);
  await privateDenied(getDocFromServer(doc(anonymous.store, 'sessions', sessionId, 'finalVersions', confirmed.versionId)));
  await privateDenied(getDocFromServer(doc(anonymous.store, 'events', eventId, 'scores', first.scoreId)));
  scenarios.push('Correction and restoration append immutable history; all 20 final stored cells and 22 history entries verified; confirmed version/public projection unchanged; private reads denied');
  scenarios.push('Two staff callers racing the same cell revision produce exactly one accepted correction');
  console.log(JSON.stringify({ status: 'PASS', projectId: env.projectId, eventId, snapshotId, sessionId,
    rows, scoreCellCount: storedScores.size, historyCount, metrics, scenarios,
    limitations: ['Synthetic local emulators only', 'Ten concurrent callable requests share one staff identity', 'No physical monitors, audio output, printer or live cloud verification'] }, null, 2));
} finally {
  await Promise.all(apps.map(app => deleteApp(app)));
  await Promise.all(users.map(uid => adminAuth.deleteUser(uid)));
  await adminSdk.deleteApp(adminApp);
}
