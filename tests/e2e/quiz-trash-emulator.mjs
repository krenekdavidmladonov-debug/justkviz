import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { initializeApp, deleteApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';
import { requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';
import { seedEmulatorMembership } from '../../functions/lib/dev/seed-membership.js';

// Deliberately no defaults: the caller must supply a dedicated demo project and local endpoints.
const env = requireFullEmulatorEnvironment(process.env, 'Quiz trash isolated evidence');
const require = createRequire(new URL('../../functions/package.json', import.meta.url));
const adminSdk = require('firebase-admin/app');
const server = adminSdk.initializeApp({ projectId: env.projectId }, 'trash-' + randomUUID());
const db = require('firebase-admin/firestore').getFirestore(server);
const authAdmin = require('firebase-admin/auth').getAuth(server);
const { Timestamp } = require('firebase-admin/firestore');
const prefix = 'quiz-trash-' + randomUUID();
const users = [], clients = [], roots = [];

function root(path) { const ref = db.doc(path); roots.push(ref); return ref; }
async function client(role) {
  const app = initializeApp({ projectId: env.projectId, apiKey: 'demo-api-key' }, randomUUID());
  clients.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${env.authEndpoint.host}:${env.authEndpoint.port}`, { disableWarnings: true });
  const functions = getFunctions(app, 'europe-west1');
  connectFunctionsEmulator(functions, env.functionsEndpoint.host, env.functionsEndpoint.port);
  let uid;
  if (role) {
    const email = `${prefix}-${users.length}@example.test`, password = randomUUID();
    const user = await authAdmin.createUser({ email, password, emailVerified: true }); uid = user.uid; users.push(uid);
    // A legacy admin claim alone intentionally does not authorize anything.
    await authAdmin.setCustomUserClaims(uid, { role: 'admin' });
    if (role !== 'claim-only') await seedEmulatorMembership(uid, role);
    await signInWithEmailAndPassword(auth, email, password);
  }
  return { uid, call: async (name, data) => (await httpsCallable(functions, name)(data)).data };
}
async function rejects(action, code) { await assert.rejects(action, error => error.code === `functions/${code}`); }
async function tree(ref) {
  const result = { data: (await ref.get()).data(), collections: {} };
  for (const collection of await ref.listCollections()) {
    result.collections[collection.id] = {};
    for (const doc of (await collection.get()).docs) result.collections[collection.id][doc.id] = await tree(doc.ref);
  }
  return result;
}
const evidence = [];
async function verify(label, action) { await action(); evidence.push(label); console.log('PASS ' + label); }

try {
  const admin = await client('admin'), reader = await client('moderator');
  const legacy = await client('claim-only'), anonymous = await client();
  const quizId = prefix, quiz = root('quizzes/' + quizId);
  const now = Timestamp.now();
  const media = { source: 'storage', kind: 'image', role: 'prompt', assetId: 'retained-image', reference: `quiz-asset:${quizId}:retained-image` };
  const slide = { kind: 'free', isQuestion: true, position: 1, roundId: 'round', roundTitle: 'Syntetické kolo',
    title: '', text: 'Syntetická otázka', options: [], correctAnswer: 'PRIVATE_SENTINEL_ANSWER', moderatorNote: 'PRIVATE_SENTINEL_NOTE',
    media: [media], legacy: { raw: { preserved: true } } };
  const round = { title: 'Syntetické kolo', type: 'classic', position: 1, questionCount: 1, slideCount: 1 };
  await quiz.set({ title: 'Pouze syntetický koš', description: '', status: 'ready', revision: 4,
    slideCount: 1, roundCount: 1, questionCount: 1, createdAt: now, updatedAt: now,
    createdBy: admin.uid, updatedBy: admin.uid, legacy: { sentinel: 'retained' } });
  await quiz.collection('slides').doc('question').set(slide);
  await quiz.collection('rounds').doc('round').set(round);
  await quiz.collection('rounds').doc('round').collection('questions').doc('question').set({ prompt: slide.text, correctAnswer: slide.correctAnswer, position: 1 });
  await quiz.collection('mediaAssets').doc('retained-image').set({ status: 'ready', kind: 'image', contentType: 'image/png',
    path: `quiz-assets/${quizId}/retained-image/source`, size: 4, references: [media.reference] });
  const payload = { quizId, expectedRevision: 4 };
  await verify('anonymous, legacy claim, and missing concrete permission are denied', async () => {
    for (const name of ['trashQuiz', 'restoreQuiz']) {
      await rejects(() => anonymous.call(name, payload), 'unauthenticated');
      await rejects(() => legacy.call(name, payload), 'permission-denied');
      await rejects(() => reader.call(name, payload), 'permission-denied');
    }
    await rejects(() => reader.call('readAccessData', { operation: 'quizzes', includeTrash: true }), 'permission-denied');
    assert.equal((await quiz.get()).data().revision, 4);
  });
  const member = db.doc('memberships/' + admin.uid), originalMembership = (await member.get()).data();
  await verify('current scope and suspended membership are enforced despite admin claim', async () => {
    await member.update({ quizzes: { mode: 'selected', ids: [] } });
    await rejects(() => admin.call('trashQuiz', payload), 'permission-denied');
    await member.set({ ...originalMembership, status: 'suspended' });
    await rejects(() => admin.call('trashQuiz', payload), 'permission-denied');
    await member.set(originalMembership);
  });
  await verify('malformed and stale requests do not mutate the quiz', async () => {
    await rejects(() => admin.call('trashQuiz', { quizId, expectedRevision: -1 }), 'invalid-argument');
    await rejects(() => admin.call('trashQuiz', { quizId, expectedRevision: 3 }), 'aborted');
    assert.equal((await quiz.get()).data().revision, 4);
  });
  const sourceSession = root(`sessions/${prefix}-source`);
  await verify('active source-dependent session blocks deletion, ended session does not', async () => {
    await sourceSession.set({ quizId, status: 'active', revision: 1 });
    await rejects(() => admin.call('trashQuiz', payload), 'failed-precondition');
    await sourceSession.update({ status: 'ended' });
  });
  const event = root(`events/${prefix}-event`), snapshot = root(`quizSnapshots/${prefix}-snapshot`);
  const assignment = { quizId, quizRevision: 4, snapshotId: snapshot.id, quizTitle: 'Pouze syntetický koš', roundCount: 1, questionCount: 1 };
  await event.set({ revision: 1, title: 'Syntetická událost', lifecycleStatus: 'live', quizAssignment: assignment, liveSessionId: `${prefix}-snapshot-session` });
  await verify('event missing a complete immutable snapshot blocks deletion', async () => {
    await rejects(() => admin.call('trashQuiz', payload), 'failed-precondition');
    await snapshot.set({ status: 'ready', eventId: event.id, quizId, quizRevision: 4, slideCount: 1, roundCount: 1, questionCount: 1 });
    await rejects(() => admin.call('trashQuiz', payload), 'failed-precondition');
    await snapshot.collection('slides').doc('question').set(slide);
    await snapshot.collection('rounds').doc('round').set(round);
  });
  const projection = root(`publicSessions/${prefix}-sentinel`);
  await projection.set({ title: 'Veřejný syntetický snímek', status: 'ended', revision: 1 });
  const frozenSession = root(`sessions/${prefix}-snapshot-session`);
  await frozenSession.set({ quizId, snapshotId: snapshot.id, eventId: event.id, status: 'active', revision: 2 });
  await event.collection('scores').doc('synthetic-team').set({ totalUnits: 12, roundUnits: { round: 12 } });
  await event.collection('scoreHistory').doc('synthetic-history').set({ action: 'score', teamId: 'synthetic-team', deltaUnits: 12, createdAt: now });
  const beforeSession = await tree(frozenSession);
  const beforeQuiz = await tree(quiz), beforeEvent = await tree(event), beforeSnapshot = await tree(snapshot), beforePublic = await tree(projection);
  await verify('trash changes only root disposition/audit; content, media and event snapshots survive', async () => {
    const result = await admin.call('trashQuiz', payload);
    assert.deepEqual(result, { quizId, revision: 5, disposition: 'trash' });
    const after = await tree(quiz);
    assert.deepEqual(after.collections, beforeQuiz.collections);
    for (const key of ['title', 'description', 'status', 'createdAt', 'createdBy', 'legacy', 'slideCount', 'roundCount', 'questionCount']) assert.deepEqual(after.data[key], beforeQuiz.data[key]);
    assert.equal(after.data.trashedBy, admin.uid); assert.ok(after.data.trashedAt);
    assert.deepEqual(await tree(event), beforeEvent); assert.deepEqual(await tree(snapshot), beforeSnapshot);
    assert.deepEqual(await tree(frozenSession), beforeSession);
    assert.deepEqual(await tree(projection), beforePublic);
    assert.equal(JSON.stringify(result).includes(slide.correctAnswer), false);
    await rejects(() => admin.call('createLiveSession', { quizId }), 'failed-precondition');
    await rejects(() => admin.call('updateQuizMetadata', { quizId, expectedRevision: 5, quiz: { title: 'Denied mutation', description: '' } }), 'failed-precondition');
  });
  await verify('normal library excludes trash; explicit authorized trash listing includes it', async () => {
    const normal = await admin.call('readAccessData', { operation: 'quizzes' });
    assert.equal(normal.some(item => item.id === quizId), false);
    const all = await admin.call('readAccessData', { operation: 'quizzes', includeTrash: true });
    assert.equal(all.find(item => item.id === quizId)?.data.disposition, 'trash');
    assert.equal(all.find(item => item.id === quizId)?.data.revision, 5);
    await rejects(() => admin.call('trashQuiz', { quizId, expectedRevision: 5 }), 'failed-precondition');
    await rejects(() => admin.call('restoreQuiz', payload), 'aborted');
  });
  await verify('restore increments revision and returns intact quiz to normal library', async () => {
    assert.deepEqual(await admin.call('restoreQuiz', { quizId, expectedRevision: 5 }), { quizId, revision: 6, disposition: 'active' });
    const restored = await tree(quiz);
    assert.deepEqual(restored.collections, beforeQuiz.collections);
    assert.equal(restored.data.status, 'ready');
    assert.deepEqual(await tree(event), beforeEvent); assert.deepEqual(await tree(snapshot), beforeSnapshot);
    assert.deepEqual(await tree(frozenSession), beforeSession);
    assert.deepEqual(await tree(projection), beforePublic);
    const normal = await admin.call('readAccessData', { operation: 'quizzes' });
    assert.equal(normal.find(item => item.id === quizId)?.data.disposition, 'active');
  });
  console.log(JSON.stringify({ projectId: env.projectId, syntheticOnly: true, passed: evidence.length, evidence }));
} finally {
  requireFullEmulatorEnvironment(process.env, 'Quiz trash targeted cleanup');
  for (const ref of roots.reverse()) await db.recursiveDelete(ref);
  for (const uid of users) { await db.doc('memberships/' + uid).delete(); await authAdmin.deleteUser(uid); }
  await Promise.all(clients.map(app => deleteApp(app)));
  await adminSdk.deleteApp(server);
}
