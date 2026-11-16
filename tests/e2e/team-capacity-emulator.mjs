import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';

const env = requireFullEmulatorEnvironment(process.env, 'Team capacity contracts');
const require = createRequire(new URL('../../functions/package.json', import.meta.url));
const adminApp = require('firebase-admin/app').initializeApp({ projectId: env.projectId }, 'team-capacity-fixtures');
const db = require('firebase-admin/firestore').getFirestore(adminApp);
function client(name) {
  const app = initializeApp({ apiKey: 'demo-api-key', projectId: env.projectId }, name);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${env.authEndpoint.host}:${env.authEndpoint.port}`, { disableWarnings: true });
  const functions = getFunctions(app, 'europe-west1');
  connectFunctionsEmulator(functions, env.functionsEndpoint.host, env.functionsEndpoint.port);
  return { app, auth, call: async (name, data) => (await httpsCallable(functions, name)(data)).data };
}
const staff = client('team-capacity-staff'), publicClient = client('team-capacity-public');
const denied = (promise, code) => assert.rejects(promise, error => error.code === `functions/${code}`);
const configuration = (overrides = {}) => ({ title: 'Synthetic team capacity', startsAt: '2031-01-01T18:00:00Z', timeZone: 'Europe/Prague', venue: { name: 'Test', publicLocation: 'Test' }, teamCapacity: 3, peopleCapacity: 1, teamSizeMin: 2, teamSizeMax: 4, ...overrides });
const form = (teamName, memberCount) => ({ teamName, memberCount, contactEmail: 'synthetic@example.test' });
const state = async id => (await db.doc(`events/${id}`).get()).data();
const registration = async (id, registrationId) => (await db.doc(`events/${id}/registrations/${registrationId}`).get()).data();
const managed = (id, team) => ({ eventId: id, registrationId: team.registrationId, token: team.managementToken });
const manual = (id, key, name, size) => staff.call('adminAddEventTeam', { eventId: id, requestId: key, ...form(name, size) });
async function publish(id, published = true) {
  return staff.call('configureEventRegistration', { eventId: id, expectedRevision: (await state(id)).revision, published,
    registrationOpensAt: '2020-01-01T00:00:00Z', registrationClosesAt: '2031-01-01T00:00:00Z' });
}
async function event(overrides = {}) {
  return (await staff.call('createEvent', { expectedRevision: 0, event: configuration(overrides) })).eventId;
}
async function run() {
  await signInWithEmailAndPassword(staff.auth, 'admin@example.test', 'LocalQuiz123!');
  await denied(staff.call('createEvent', { expectedRevision: 0, event: configuration({ teamSizeMax: 5 }) }), 'invalid-argument');
  const id = await event({ teamCapacity: 2 });
  await publish(id);
  await denied(publicClient.call('createEventRegistration', { eventId: id, ...form('Five public', 5) }), 'invalid-argument');
  await denied(manual(id, 'five-manual', 'Five manual', 5), 'invalid-argument');
  const online = await publicClient.call('createEventRegistration', { eventId: id, ...form('Four public', 4) });
  assert.equal((await state(id)).acceptedPeople, 4);
  assert.equal((await state(id)).registrationStatus, 'open', 'Historical person capacity cannot fill the event');
  const added = await manual(id, 'four-manual', 'Four manual', 2);
  assert.equal((await state(id)).registrationStatus, 'full');
  await publicClient.call('updateEventRegistration', { ...managed(id, online), ...form('Four public', 3) });
  await staff.call('adminUpdateEventTeam', { eventId: id, registrationId: added.registrationId, expectedRevision: 1, ...form('Four manual', 4) });
  assert.equal((await state(id)).acceptedPeople, 7, 'Public and manual edits keep aggregate people bookkeeping');
  assert.equal((await state(id)).registrationStatus, 'full', 'Only the team count determines fullness');
  await denied(publicClient.call('updateEventRegistration', { ...managed(id, online), ...form('Four public', 5) }), 'invalid-argument');
  await denied(staff.call('adminUpdateEventTeam', { eventId: id, registrationId: added.registrationId, expectedRevision: 2, ...form('Four manual', 5) }), 'invalid-argument');
  await denied(staff.call('updateEvent', { eventId: id, expectedRevision: (await state(id)).revision, event: configuration({ teamCapacity: 1 }) }), 'failed-precondition');
  await staff.call('updateEvent', { eventId: id, expectedRevision: (await state(id)).revision, event: configuration() });
  assert.equal((await state(id)).registrationStatus, 'open', 'Increasing team capacity reopens an event despite old person limit');
  await publicClient.call('cancelEventRegistration', managed(id, online));
  await staff.call('adminCancelEventRegistration', { eventId: id, registrationId: added.registrationId });
  assert.equal((await state(id)).acceptedPeople, 0);
  assert.equal((await state(id)).acceptedTeams, 0);

  const legacy = await event();
  await db.doc(`events/${legacy}`).update({ teamSizeMax: 6 });
  await publish(legacy);
  const older = await publicClient.call('createEventRegistration', { eventId: legacy, ...form('Legacy public', 4) });
  await db.doc(`events/${legacy}/registrations/${older.registrationId}`).update({ memberCount: 6 });
  await db.doc(`events/${legacy}`).update({ acceptedPeople: 6 });
  assert.equal((await publicClient.call('getEventRegistration', managed(legacy, older))).memberCount, 6);
  await denied(publicClient.call('updateEventRegistration', { ...managed(legacy, older), ...form('Legacy public', 5) }), 'invalid-argument');
  await denied(publicClient.call('createEventRegistration', { eventId: legacy, ...form('Legacy max bypass', 5) }), 'invalid-argument');
  assert.equal((await registration(legacy, older.registrationId)).memberCount, 6, 'Denied edits must not clamp old team records');
  await publish(legacy, false);
  await publish(legacy, true);
  assert.equal((await state(legacy)).teamSizeMax, 6, 'Publication does not rewrite retained team settings');
  await db.doc(`events/${legacy}`).update({ teamSizeMin: 5 });
  await denied(publicClient.call('createEventRegistration', { eventId: legacy, ...form('Legacy minimum', 4) }), 'invalid-argument');
  await publicClient.call('cancelEventRegistration', managed(legacy, older));
  assert.equal((await state(legacy)).acceptedPeople, 0, 'Old teams above four remain cancellable, even with a legacy minimum above four');
  assert.equal((await registration(legacy, older.registrationId)).memberCount, 6);

  const legacyManual = await event();
  const oldManual = await manual(legacyManual, 'legacy-manual', 'Legacy manual', 4);
  await db.doc(`events/${legacyManual}/registrations/${oldManual.registrationId}`).update({ memberCount: 6 });
  await db.doc(`events/${legacyManual}`).update({ acceptedPeople: 6, teamSizeMax: 6 });
  await denied(staff.call('adminUpdateEventTeam', { eventId: legacyManual, registrationId: oldManual.registrationId, expectedRevision: 1, ...form('Legacy manual', 5) }), 'invalid-argument');
  await staff.call('adminCancelEventRegistration', { eventId: legacyManual, registrationId: oldManual.registrationId });
  assert.equal((await state(legacyManual)).acceptedPeople, 0);
  assert.equal((await registration(legacyManual, oldManual.registrationId)).memberCount, 6);

  const smaller = await event({ teamSizeMin: 3, teamSizeMax: 3 });
  await publish(smaller);
  for (const size of [2, 4]) {
    await denied(publicClient.call('createEventRegistration', { eventId: smaller, ...form(`Public invalid ${size}`, size) }), 'invalid-argument');
    await denied(manual(smaller, `manual-invalid-${size}`, `Manual invalid ${size}`, size), 'invalid-argument');
  }
  await publicClient.call('createEventRegistration', { eventId: smaller, ...form('Three public', 3) });
  await manual(smaller, 'three-manual', 'Three manual', 3);
  assert.equal((await state(smaller)).acceptedPeople, 6);

  const race = await event({ teamCapacity: 1 });
  await publish(race);
  const results = await Promise.allSettled([
    publicClient.call('createEventRegistration', { eventId: race, ...form('Racing public', 4) }),
    manual(race, 'racing-manual', 'Racing manual', 4),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  assert.equal((await state(race)).acceptedTeams, 1);
  assert.equal((await state(race)).acceptedPeople, 4);
  assert.equal((await state(race)).registrationStatus, 'full');
  console.log('PASS: team-only capacity, four-member public/manual writes, legacy read/hide/cancel, lower event bounds and transactional final team slot');
}
try { await run(); } finally { await Promise.all([deleteApp(staff.app), deleteApp(publicClient.app), require('firebase-admin/app').deleteApp(adminApp)]); }
