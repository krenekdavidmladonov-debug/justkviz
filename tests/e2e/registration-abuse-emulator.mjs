import { strict as assert } from 'node:assert';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { getFirestore, connectFirestoreEmulator, doc, getDoc, collection, getDocs, setDoc } from 'firebase/firestore';
import { requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';

const env = requireFullEmulatorEnvironment(process.env, 'Registration abuse acceptance');
function client(name) {
  const app = initializeApp({ apiKey: 'demo-api-key', projectId: env.projectId }, name);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${env.authEndpoint.host}:${env.authEndpoint.port}`, { disableWarnings: true });
  const functions = getFunctions(app, 'europe-west1');
  connectFunctionsEmulator(functions, env.functionsEndpoint.host, env.functionsEndpoint.port);
  const db = getFirestore(app); connectFirestoreEmulator(db, env.firestoreEndpoint.host, env.firestoreEndpoint.port);
  return { app, auth, db, call: async (name, data) => (await httpsCallable(functions, name)(data)).data };
}
const staff = client('abuse-staff-' + randomUUID()), publicClient = client('abuse-public-' + randomUUID());
const require = createRequire(new URL('../../functions/package.json', import.meta.url));
const adminApp = require('firebase-admin/app').initializeApp({ projectId: env.projectId }, 'abuse-inspector-' + randomUUID());
const privateDb = require('firebase-admin/firestore').getFirestore(adminApp);
const state = async id => (await getDoc(doc(staff.db, 'events', id))).data();
const denied = (promise, code) => assert.rejects(promise, error => error.code === 'functions/' + code);
const key = () => randomBytes(32).toString('base64url');
const input = (eventId, teamName, contactEmail = 'synthetic-abuse@example.test') => ({ eventId, teamName, memberCount: 2, contactEmail, requestKey: key() });
const create = payload => publicClient.call('createEventRegistration', payload);
const managed = (eventId, registration) => ({ eventId, registrationId: registration.registrationId, token: registration.managementToken });
async function event(capacity = 20) {
  const { eventId } = await staff.call('createEvent', { expectedRevision: 0, event: {
    title: 'Synthetic registration protection', startsAt: '2031-01-01T18:00:00Z', timeZone: 'Europe/Prague',
    venue: { name: 'Synthetic', publicLocation: 'Synthetic' }, teamCapacity: capacity, peopleCapacity: capacity * 4, teamSizeMin: 2, teamSizeMax: 4,
  } });
  await staff.call('configureEventRegistration', { eventId, expectedRevision: (await state(eventId)).revision, published: true,
    registrationOpensAt: '2020-01-01T00:00:00Z', registrationClosesAt: '2099-01-01T00:00:00Z' });
  return eventId;
}
async function run() {
  await signInWithEmailAndPassword(staff.auth, 'admin@example.test', 'LocalQuiz123!');
  const id = await event();
  const requests = Array.from({ length: 8 }, (_, n) => input(id, 'Synthetic burst ' + n));
  const results = await Promise.allSettled(requests.map(create));
  const successes = results.flatMap((result, index) => result.status === 'fulfilled' ? [{ payload: requests[index], registration: result.value }] : []);
  assert.equal(successes.length, 3, 'Exactly three simultaneous creates from one contact may reserve capacity');
  for (const result of results.filter(result => result.status === 'rejected')) {
    assert.equal(result.reason.code, 'functions/resource-exhausted');
    assert.equal(result.reason.details.reason, 'registration-rate-limit');
    assert(result.reason.details.retryAfterSeconds > 0);
  }
  assert.equal((await state(id)).acceptedTeams, 3);
  assert.equal((await state(id)).acceptedPeople, 6);
  const bucketBefore = (await privateDb.collection('events/' + id + '/registrationAbuse').get()).docs.map(item => item.data());
  assert.equal(bucketBefore.length, 1);
  assert.deepEqual(Object.keys(bucketBefore[0]).sort(), ['tokens', 'updatedAtMillis']);
  const first = successes[0];
  const replay = await create(first.payload);
  assert.equal(replay.registrationId, first.registration.registrationId);
  assert.equal(replay.managementToken, first.registration.managementToken);
  assert.deepEqual((await privateDb.collection('events/' + id + '/registrationAbuse').get()).docs.map(item => item.data()), bucketBefore, 'Replay does not debit or touch budget');
  await denied(create({ ...first.payload, teamName: 'Changed replay' }), 'already-exists');
  await publicClient.call('cancelEventRegistration', managed(id, first.registration));
  assert.equal((await state(id)).acceptedTeams, 2);
  await denied(create(input(id, 'Cancel does not refund')), 'resource-exhausted');
  await create(input(id, 'Independent contact', 'independent@example.test'));
  assert.equal((await state(id)).acceptedTeams, 3);

  const other = await event();
  await create(input(other, 'Independent event'));
  assert.equal((await state(other)).acceptedTeams, 1);
  await denied(publicClient.call('getEventRegistration', { ...managed(other, first.registration) }), 'not-found');

  const invalid = await event();
  await denied(create({ ...input(invalid, 'Invalid size'), memberCount: 0 }), 'invalid-argument');
  const original = await create(input(invalid, 'Unique name'));
  await denied(create(input(invalid, 'Unique name')), 'already-exists');
  await create(input(invalid, 'Second valid'));
  await create(input(invalid, 'Third valid'));
  await denied(create(input(invalid, 'Fourth valid')), 'resource-exhausted');
  await denied(publicClient.call('cancelEventRegistration', { ...managed(invalid, original), token: key() }), 'not-found');

  const full = await event(1);
  const firstFull = await create(input(full, 'Capacity one'));
  await denied(create(input(full, 'Capacity rejected')), 'failed-precondition');
  await publicClient.call('cancelEventRegistration', managed(full, firstFull));
  const secondFull = await create(input(full, 'Capacity two'));
  await publicClient.call('cancelEventRegistration', managed(full, secondFull));
  await create(input(full, 'Capacity three'));

  const protectedRef = doc(publicClient.db, 'events', id, 'registrationAbuse', 'synthetic');
  await assert.rejects(getDoc(protectedRef), error => error.code === 'permission-denied');
  await assert.rejects(getDocs(collection(staff.db, 'events', id, 'registrationAbuse')), error => error.code === 'permission-denied');
  await assert.rejects(setDoc(protectedRef, { tokens: 3, updatedAtMillis: 0 }), error => error.code === 'permission-denied');

  const disposable = await event();
  await create(input(disposable, 'Delete cleanup'));
  await staff.call('trashEvent', { eventId: disposable, expectedRevision: (await state(disposable)).revision, requestId: randomUUID() });
  // Trashed roots are correctly hidden by client Rules; only the guarded synthetic inspector reads the revision.
  const deletionRevision = async () => (await privateDb.doc('events/' + disposable).get()).data().revision;
  let deleted = await staff.call('deleteEvent', { eventId: disposable, expectedRevision: await deletionRevision(), confirmTitle: 'Synthetic registration protection' });
  for (let n = 0; deleted.state !== 'complete' && n < 5; n++) {
    deleted = await staff.call('deleteEvent', { eventId: disposable, expectedRevision: await deletionRevision(), confirmTitle: 'Synthetic registration protection' });
  }
  assert.equal(deleted.state, 'complete');
  assert.equal((await privateDb.doc('events/' + disposable).get()).exists, false);
  assert.equal((await privateDb.collection('events/' + disposable + '/registrationAbuse').get()).size, 0, 'Event deletion removes contact budget without an orphan');
  assert.equal((await privateDb.collection('events/' + id + '/registrationAbuse').get()).size, 2, 'Deleting another event preserves its budget');
  console.log(JSON.stringify({ status: 'PASS', concurrentBurst: true, replayExhausted: true, eventContactIsolation: true,
    failuresFree: true, capacityFailureFree: true, cancellationNoRefund: true, rulesDenied: true, deletionCleanup: true }));
}
try { await run(); }
finally { await Promise.all([deleteApp(staff.app), deleteApp(publicClient.app), require('firebase-admin/app').deleteApp(adminApp)]); }