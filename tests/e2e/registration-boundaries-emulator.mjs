import { strict as assert } from 'node:assert';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { getFirestore, connectFirestoreEmulator, doc, getDoc, getDocs, collection, setDoc } from 'firebase/firestore';
import { requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';

const env = requireFullEmulatorEnvironment(process.env, 'Registration boundaries');
function client(name) {
  const app = initializeApp({ apiKey: 'demo-api-key', projectId: env.projectId }, name);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${env.authEndpoint.host}:${env.authEndpoint.port}`, { disableWarnings: true });
  const functions = getFunctions(app, 'europe-west1');
  connectFunctionsEmulator(functions, env.functionsEndpoint.host, env.functionsEndpoint.port);
  const db = getFirestore(app);
  connectFirestoreEmulator(db, env.firestoreEndpoint.host, env.firestoreEndpoint.port);
  return { app, auth, db, call: async (name, data) => (await httpsCallable(functions, name)(data)).data };
}
const admin = client('boundary-admin');
const user = client('boundary-user');
const login = (client, role) => signInWithEmailAndPassword(client.auth, `${role}@example.test`, 'LocalQuiz123!');
const form = (teamName, memberCount) => ({ teamName, memberCount, contactEmail: 'synthetic@example.test' });
const config = (teams = 3, people = 12) => ({ title: 'Syntetické hranice', startsAt: '2031-01-01T18:00:00Z', timeZone: 'Europe/Prague', venue: { name: 'Test', publicLocation: 'Test' }, teamCapacity: teams, peopleCapacity: people, teamSizeMin: 2, teamSizeMax: 4 });
const state = async (id) => (await getDoc(doc(admin.db, 'events', id))).data();
async function window(id, published, expired = false) {
  return admin.call('configureEventRegistration', { eventId: id, expectedRevision: (await state(id)).revision, published,
    registrationOpensAt: '2020-01-01T00:00:00Z', registrationClosesAt: expired ? '2021-01-01T00:00:00Z' : '2030-01-01T00:00:00Z' });
}
async function event(teams = 3, people = 12) {
  const result = await admin.call('createEvent', { expectedRevision: 0, event: config(teams, people) });
  await window(result.eventId, true);
  return result.eventId;
}
const managed = (id, registration) => ({ eventId: id, registrationId: registration.registrationId, token: registration.managementToken });
const denied = (promise, code) => assert.rejects(promise, (error) => error.code === `functions/${code}`);
const registrationState = async (id, registrationId) => (await getDoc(doc(admin.db, 'events', id, 'registrations', registrationId))).data();
const reissue = (id, registrationId, expectedRevision, requestId) => admin.call('adminUpdateEventTeam', {
  eventId: id, registrationId, expectedRevision, requestId, action: 'reissueLink',
});
async function revisionBoundaries() {
  const id = await event(1, 6);
  const original = form('Revizní tým', 3);
  const team = await user.call('createEventRegistration', { eventId: id, ...original });
  const initial = await registrationState(id, team.registrationId);
  assert.equal(initial.revision, undefined, 'The existing online create shape covers legacy missing revision');
  const credential = managed(id, team);
  await user.call('updateEventRegistration', { ...credential, ...original, requestId: 'revision-initial-noop' });
  assert.equal((await registrationState(id, team.registrationId)).revision, undefined, 'A legacy no-op must not manufacture a revision');
  const changed = { ...original, contactEmail: 'changed@example.test' };
  const request = { ...credential, ...changed, requestId: 'revision-contact-change' };
  const response = await user.call('updateEventRegistration', request);
  assert.equal(response.contactEmail, changed.contactEmail);
  assert(!Object.hasOwn(response, 'revision') && !Object.hasOwn(response, 'managementTokenHash'), 'Public DTO remains unchanged');
  const current = await registrationState(id, team.registrationId);
  assert.equal(current.revision, 1);
  assert.equal(current.managementTokenHash, initial.managementTokenHash, 'An edit must preserve the bearer capability');
  await denied(reissue(id, team.registrationId, 0, 'revision-stale-reissue'), 'aborted');
  await user.call('updateEventRegistration', request);
  await user.call('updateEventRegistration', { ...credential, ...changed, requestId: 'revision-current-noop' });
  assert.equal((await registrationState(id, team.registrationId)).revision, 1, 'Replay and no-op do not advance the revision');
  await user.call('updateEventRegistration', { ...credential, ...changed, memberCount: 2, requestId: 'revision-second-change' });
  const delayed = await user.call('updateEventRegistration', request);
  assert.equal(delayed.memberCount, 2, 'Delayed replay returns the current registration without reverting it');
  assert.equal((await registrationState(id, team.registrationId)).revision, 2);
  const rotated = await reissue(id, team.registrationId, 2, 'revision-current-reissue');
  assert.equal(typeof rotated.managementToken, 'string');
  assert.equal((await registrationState(id, team.registrationId)).revision, 3);
  await denied(user.call('getEventRegistration', credential), 'not-found');
  await denied(user.call('updateEventRegistration', { ...credential, ...changed }), 'not-found');
  await denied(user.call('cancelEventRegistration', credential), 'not-found');
  const fresh = { ...credential, token: rotated.managementToken };
  assert.equal((await user.call('getEventRegistration', fresh)).memberCount, 2);
  await user.call('updateEventRegistration', { ...fresh, ...changed, memberCount: 2, requestId: 'revision-rotated-noop' });
  assert.equal((await registrationState(id, team.registrationId)).revision, 3, 'A no-op after rotation keeps its revision');

  const raceId = await event(1, 6);
  const raceTeam = await user.call('createEventRegistration', { eventId: raceId, ...form('Souběžná revize', 3) });
  const raceCredential = managed(raceId, raceTeam);
  const raceForm = { ...form('Souběžná revize', 3), contactEmail: 'race-change@example.test' };
  const results = await Promise.allSettled([
    user.call('updateEventRegistration', { ...raceCredential, ...raceForm, requestId: 'revision-race-update' }),
    reissue(raceId, raceTeam.registrationId, 0, 'revision-race-reissue'),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1, 'Edit and stale rotation cannot both succeed');
  const failed = results.find(result => result.status === 'rejected');
  assert(['functions/aborted', 'functions/not-found'].includes(failed.reason.code));
  const raceState = await registrationState(raceId, raceTeam.registrationId);
  assert.equal(raceState.revision, 1);
  const updateWon = results[0].status === 'fulfilled';
  assert.equal(raceState.contactEmail, updateWon ? raceForm.contactEmail : 'synthetic@example.test');
  const raceToken = updateWon
    ? (await reissue(raceId, raceTeam.registrationId, 1, 'revision-race-after-update')).managementToken
    : results[1].value.managementToken;
  await denied(user.call('getEventRegistration', raceCredential), 'not-found');
  assert.equal((await user.call('getEventRegistration', { ...raceCredential, token: raceToken })).contactEmail, raceState.contactEmail);
  assert.equal((await state(raceId)).acceptedTeams, 1);
  assert.equal((await state(raceId)).acceptedPeople, 3);
}
async function run() {
  await login(admin, 'admin');
  const id = await event();
  const own = await user.call('createEventRegistration', { eventId: id, ...form('Vlastní tým', 3) });
  const other = await user.call('createEventRegistration', { eventId: id, ...form('Jiný tým', 3) });
  for (const role of [null, 'user', 'moderator']) {
    if (role) await login(user, role); else await signOut(user.auth);
    assert.equal((await user.call('getEventRegistration', managed(id, own))).teamName, 'Vlastní tým');
    await user.call('updateEventRegistration', { ...managed(id, own), ...form('Vlastní tým', 2) });
    await denied(user.call('getEventRegistration', { ...managed(id, other), token: own.managementToken }), 'not-found');
    await denied(user.call('updateEventRegistration', { ...managed(id, other), token: own.managementToken, ...form('Cizí změna', 2) }), 'not-found');
    await denied(user.call('cancelEventRegistration', { ...managed(id, other), token: own.managementToken }), 'not-found');
    await denied(user.call('adminCancelEventRegistration', { eventId: id, registrationId: other.registrationId }), role ? 'permission-denied' : 'unauthenticated');
    await assert.rejects(setDoc(doc(user.db, 'events', id, 'registrations', own.registrationId), { status: 'cancelled' }));
    if (role !== 'moderator') await assert.rejects(getDocs(collection(user.db, 'events', id, 'registrations')));
  }
  await user.call('cancelEventRegistration', managed(id, own));
  await signOut(user.auth);
  await revisionBoundaries();
  const full = await event(1, 6);
  const fullTeam = await user.call('createEventRegistration', { eventId: full, ...form('Plný tým', 4) });
  await denied(user.call('createEventRegistration', { eventId: full, ...form('Další tým', 2) }), 'failed-precondition');
  await user.call('updateEventRegistration', { ...managed(full, fullTeam), ...form('Plný tým', 3) });
  await user.call('cancelEventRegistration', managed(full, fullTeam));
  assert.equal((await state(full)).acceptedTeams, 0);
  for (const expired of [false, true]) {
    const closed = await event(1, 6);
    const team = await user.call('createEventRegistration', { eventId: closed, ...form('Uzavřený tým', 4) });
    await window(closed, expired, expired);
    await denied(user.call('updateEventRegistration', { ...managed(closed, team), ...form('Uzavřený tým', 2) }), 'failed-precondition');
    await denied(user.call('cancelEventRegistration', managed(closed, team)), 'failed-precondition');
    await admin.call('adminCancelEventRegistration', { eventId: closed, registrationId: team.registrationId });
    assert.equal((await state(closed)).registrationStatus, 'closed');
    await denied(user.call('createEventRegistration', { eventId: closed, ...form('Znovu tým', 2) }), 'failed-precondition');
  }
  const shrink = await event(3, 12);
  await user.call('createEventRegistration', { eventId: shrink, ...form('První tým', 4) });
  await user.call('createEventRegistration', { eventId: shrink, ...form('Druhý tým', 4) });
  for (const change of [{ ...config(), teamCapacity: 1 }]) {
    await denied(admin.call('updateEvent', { eventId: shrink, expectedRevision: (await state(shrink)).revision, event: change }), 'failed-precondition');
  }
  await admin.call('updateEvent', { eventId: shrink, expectedRevision: (await state(shrink)).revision, event: { ...config(), peopleCapacity: 6 } });
  assert.equal((await state(shrink)).acceptedPeople, 8);
  const race = await event(2, 12);
  await user.call('createEventRegistration', { eventId: race, ...form('Základní tým', 4) });
  const revision = (await state(race)).revision;
  const results = await Promise.allSettled([
    admin.call('updateEvent', { eventId: race, expectedRevision: revision, event: config(1, 6) }),
    user.call('createEventRegistration', { eventId: race, ...form('Souběžný tým', 4) }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const final = await state(race);
  assert.ok(final.acceptedTeams <= final.teamCapacity);
  console.log('PASS: full versus closed, capacity shrink, registration revision/reissue races, token rotation and negative authorization');
}
try { await run(); } finally { await Promise.all([deleteApp(admin.app), deleteApp(user.app)]); }
