import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';

const env = requireFullEmulatorEnvironment(process.env, 'Event team tools');
const require = createRequire(new URL('../../functions/package.json', import.meta.url));
const adminApp = require('firebase-admin/app').initializeApp({ projectId: env.projectId }, 'team-tools-fixtures');
const db = require('firebase-admin/firestore').getFirestore(adminApp);
function client(name) {
  const app = initializeApp({ apiKey: 'demo-api-key', projectId: env.projectId }, name);
  const auth = getAuth(app); connectAuthEmulator(auth, `http://${env.authEndpoint.host}:${env.authEndpoint.port}`, { disableWarnings: true });
  const functions = getFunctions(app, 'europe-west1'); connectFunctionsEmulator(functions, env.functionsEndpoint.host, env.functionsEndpoint.port);
  return { app, auth, call: async (name, data) => (await httpsCallable(functions, name)(data)).data };
}
const staff = client('manual-admin'), publicClient = client('manual-public');
const login = (client, role) => signInWithEmailAndPassword(client.auth, `${role}@example.test`, 'LocalQuiz123!');
const denied = (promise, code) => assert.rejects(promise, error => error.code === `functions/${code}`);
const state = async id => (await db.doc(`events/${id}`).get()).data();
async function event(teamCapacity = 5, peopleCapacity = 20) {
  return (await staff.call('createEvent', { expectedRevision: 0, event: { title: 'Synthetic manual QA', startsAt: '2031-01-01T18:00:00Z', timeZone: 'Europe/Prague', venue: { name: 'Test', publicLocation: 'Test' }, teamCapacity, peopleCapacity, teamSizeMin: 2, teamSizeMax: 4 } })).eventId;
}
const manual = (id, key, name = 'Manual QA', size = 2) => staff.call('adminAddEventTeam', { eventId: id, requestId: key, teamName: name, memberCount: size });
const online = (id, name = 'Online QA') => publicClient.call('createEventRegistration', { eventId: id, teamName: name, memberCount: 2, contactEmail: 'synthetic@example.test', source: 'manual', createdBy: 'spoofed' });
async function open(id) { await staff.call('configureEventRegistration', { eventId: id, expectedRevision: (await state(id)).revision, registrationOpensAt: '2020-01-01T00:00:00Z', registrationClosesAt: '2031-01-01T00:00:00Z', published: true }); }
try {
  await login(staff, 'admin');
  const id = await event();
  const before = await state(id);
  const request = { eventId: id, requestId: 'repeat-key', teamName: 'Manual QA', memberCount: 2 };
  for (const role of [null, 'user', 'moderator']) {
    if (role) await login(publicClient, role); else await signOut(publicClient.auth);
    await denied(publicClient.call('adminAddEventTeam', request), role ? 'permission-denied' : 'unauthenticated');
    await denied(publicClient.call('adminUpdateEventTeam', { ...request, registrationId: 'none', expectedRevision: 1 }), role ? 'permission-denied' : 'unauthenticated');
  }
  await signOut(publicClient.auth);
  const [first, retry] = await Promise.all([manual(id, 'repeat-key'), manual(id, 'repeat-key')]);
  assert.equal(first.registrationId, retry.registrationId);
  assert.equal(first.contactEmail, null); assert.equal(first.managementToken, undefined);
  assert.equal((await state(id)).acceptedTeams, 1);
  await denied(manual(id, 'repeat-key', 'Changed payload'), 'already-exists');
  const stored = (await db.doc(`events/${id}/registrations/${first.registrationId}`).get()).data();
  assert.equal(stored.source, 'manual'); assert.equal(stored.managementTokenHash, null); assert.equal(stored.createdBy, staff.auth.currentUser.uid);
  assert.equal((await state(id)).registrationPublished, before.registrationPublished);
  assert.deepEqual((await state(id)).quizAssignment, before.quizAssignment);
  await denied(online(id), 'failed-precondition');
  await denied(manual(id, 'size', 'Invalid size', 1), 'invalid-argument');
  for (const token of [undefined, null, '', 'A'.repeat(43)]) {
    const managed = { eventId: id, registrationId: first.registrationId, ...(token === undefined ? {} : { token }) };
    await denied(publicClient.call('getEventRegistration', managed), 'not-found');
    await denied(publicClient.call('updateEventRegistration', { ...managed, teamName: 'Attack', memberCount: 2, contactEmail: 'synthetic@example.test' }), 'not-found');
    await denied(publicClient.call('cancelEventRegistration', managed), 'not-found');
  }
  await staff.call('adminUpdateEventTeam', { eventId: id, registrationId: first.registrationId, expectedRevision: 1, teamName: 'Updated manual', memberCount: 4, contactEmail: 'optional@example.test' });
  assert.equal((await state(id)).acceptedPeople, 4);
  await denied(staff.call('adminUpdateEventTeam', { eventId: id, registrationId: first.registrationId, expectedRevision: 1, teamName: 'Stale', memberCount: 2 }), 'aborted');
  const reusedName = await manual(id, 'released-name');
  await staff.call('adminCancelEventRegistration', { eventId: id, registrationId: first.registrationId });
  assert.equal((await state(id)).acceptedPeople, 2);
  assert.equal((await manual(id, 'repeat-key')).status, 'cancelled');
  assert.equal((await state(id)).acceptedTeams, 1);
  for (const lifecycle of ['draft', 'scheduled', 'ready', 'live', 'finalizing', 'completed', 'cancelled', 'archived']) {
    const life = await event(); await db.doc(`events/${life}`).update({ lifecycleStatus: lifecycle });
    if (['draft', 'scheduled', 'ready', 'live'].includes(lifecycle)) await manual(life, 'lifecycle');
    else await denied(manual(life, 'lifecycle'), 'failed-precondition');
  }
  const raced = await event(1, 2); await open(raced);
  const racedResults = await Promise.allSettled([manual(raced, 'race'), online(raced)]);
  assert.equal(racedResults.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((await state(raced)).acceptedTeams, 1); assert.equal((await state(raced)).acceptedPeople, 2);
  const names = await event(); await open(names);
  const nameResults = await Promise.allSettled([manual(names, 'name', ' Same   NAME '), online(names, 'same name')]);
  assert.equal(nameResults.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((await state(names)).acceptedTeams, 1);
  const legacy = await event(); await open(legacy);
  await denied(publicClient.call('createEventRegistration', { eventId: legacy, teamName: 'No email', memberCount: 2, source: 'manual' }), 'invalid-argument');
  const old = await online(legacy);
  const oldRef = db.doc(`events/${legacy}/registrations/${old.registrationId}`);
  assert.notEqual((await oldRef.get()).data().source, 'manual');
  assert.notEqual((await oldRef.get()).data().createdBy, 'spoofed');
  const managed = { eventId: legacy, registrationId: old.registrationId, token: old.managementToken };
  assert.equal((await publicClient.call('getEventRegistration', managed)).teamName, 'Online QA');
  await publicClient.call('updateEventRegistration', { ...managed, teamName: 'Old edited', memberCount: 3, contactEmail: 'synthetic@example.test' });
  await publicClient.call('cancelEventRegistration', managed);
  // The canonical adapter is the one used by the real PDF endpoint.
  const { registrationToPrintTeam } = await import('../../functions/lib/registrations/print-adapter.js');
  const registrations = await db.collection(`events/${id}/registrations`).get();
  const roster = registrations.docs.map(doc => registrationToPrintTeam(doc.id, doc.data())).filter(Boolean);
  assert.deepEqual(roster, [{ id: reusedName.registrationId, name: 'Manual QA' }]);
  assert.deepEqual(Object.keys(roster[0]).sort(), ['id', 'name']);
  await staff.call('lockEventQuiz', { eventId: id, expectedRevision: (await state(id)).revision, quizId: 'preflight-ready-e2e', expectedQuizRevision: 0, acknowledgeWarnings: false });
  const endpoint = `http://${env.functionsEndpoint.host}:${env.functionsEndpoint.port}/${env.projectId}/europe-west1/generatePrintArtifact`;
  const token = await staff.auth.currentUser.getIdToken();
  async function print(options) { return fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ eventId: id, options: { disposition: 'inline', ...options } }) }); }
  for (const options of [{ artifactType: 'team-sheets', mode: 'single', teamId: reusedName.registrationId }, { artifactType: 'team-sheets', mode: 'all' }, { artifactType: 'score-table' }]) {
    const response = await print(options); assert.equal(response.status, 200);
    assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0,5).toString(), '%PDF-');
  }
  assert.notEqual((await print({ artifactType: 'team-sheets', mode: 'single', teamId: first.registrationId })).status, 200);
  console.log('PASS: manual auth/nullable email, lifecycle, closed window, capacity/name races, idempotency, edit/cancel, token denial, legacy online, minimal PDF roster.');
} finally { await Promise.all([deleteApp(staff.app), deleteApp(publicClient.app), adminApp.delete()]); }
