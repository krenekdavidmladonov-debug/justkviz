import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase/app';
import { collection, connectFirestoreEmulator, doc, getDocFromServer, getDocs, getFirestore, query, where } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';
import { editorIdentity } from './editor-identity.mjs';
import { requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';

const env = requireFullEmulatorEnvironment(process.env, 'Event publication contracts');
const staff = await editorIdentity();
const app = initializeApp({ apiKey: 'demo-api-key', projectId: env.projectId }, randomUUID());
const db = getFirestore(app);
connectFirestoreEmulator(db, env.firestoreEndpoint.host, env.firestoreEndpoint.port);
const functions = getFunctions(app, 'europe-west1');
connectFunctionsEmulator(functions, env.functionsEndpoint.host, env.functionsEndpoint.port);
const anonymous = async (name, data) => (await httpsCallable(functions, name)(data)).data;
const paths = [];
const denied = (promise, code) => assert.rejects(promise, error => error.code === code);
const input = { title: 'Publication boundary ' + randomUUID(), description: 'Veřejný popis', startsAt: '2031-07-20T17:30:00Z', timeZone: 'Europe/Prague', venue: { name: 'Syntetický sál', publicLocation: 'Praha' }, teamCapacity: 2, peopleCapacity: 6, teamSizeMin: 1, teamSizeMax: 4 };
const member = (await staff.db.collection('memberships').where('email', '==', staff.email).get()).docs[0].ref;
const originalMember = (await member.get()).data();

try {
  const { eventId } = await staff.call('createEvent', { expectedRevision: 0, event: input });
  const privateRef = staff.db.doc('events/' + eventId);
  const publicRef = doc(db, 'publicEvents/' + eventId);
  paths.push('events/' + eventId, 'publicEvents/' + eventId);
  const state = async () => (await privateRef.get()).data();
  const visibility = async published => staff.call('configureEventRegistration', { eventId, expectedRevision: (await state()).revision, published });
  const openNow = async () => staff.call('configureEventRegistration', { eventId, expectedRevision: (await state()).revision, published: true, openRegistrationsNow: true });
  const visibleIds = async () => (await getDocs(query(collection(db, 'publicEvents'), where('registrationPublished', '==', true)))).docs.map(item => item.id);
  await privateRef.update({ privateNote: 'PRIVATE_NOTE', privateQuiz: { correctAnswer: 'PRIVATE_ANSWER' }, organizerEmail: 'private@example.test' });
  await denied(getDocFromServer(publicRef), 'permission-denied');
  assert(!(await visibleIds()).includes(eventId));
  await denied(getDocs(collection(db, 'publicEvents')), 'permission-denied');
  await denied(anonymous('configureEventRegistration', { eventId, expectedRevision: 1, published: true }), 'functions/unauthenticated');
  await denied(anonymous('configureEventRegistration', { eventId, expectedRevision: 1, published: true, openRegistrationsNow: true }), 'functions/unauthenticated');

  // Public listing has no dependency on a quiz or an open registration window.
  const published = await visibility(true);
  assert.equal(published.registrationPublished, true);
  assert.equal(published.registrationStatus, 'closed');
  assert.equal(published.registrationOpensAt, null);
  assert.equal(published.registrationClosesAt, null);
  assert.equal((await state()).quizAssignment, null);
  assert.equal((await state()).registrationOpensAt, null);
  assert((await visibleIds()).includes(eventId));
  const projection = (await getDocFromServer(publicRef)).data();
  assert.equal(projection.description, input.description);
  assert.equal(projection.lifecycleStatus, 'scheduled');
  assert(!JSON.stringify(projection).match(/PRIVATE_|private@example|quizAssignment|snapshot|organizer|contact/iu));
  await denied(staff.call('configureEventRegistration', { eventId, expectedRevision: 1, published: false }), 'functions/aborted');

  // An explicit publication action opens even an already visible event with no window.
  await denied(anonymous('createEventRegistration', { eventId, teamName: 'Closed team', memberCount: 4, contactEmail: 'synthetic@example.test' }), 'functions/failed-precondition');
  for (const invalid of [
    { openRegistrationsNow: true },
    { published: false, openRegistrationsNow: true },
    { published: true, openRegistrationsNow: 'true' },
    { published: true, openRegistrationsNow: true, registrationOpensAt: '2020-01-01T00:00:00Z', registrationClosesAt: '2035-01-01T00:00:00Z' },
  ]) await denied(staff.call('configureEventRegistration', { eventId, expectedRevision: (await state()).revision, ...invalid }), 'functions/invalid-argument');
  const revisionBeforeOpening = (await state()).revision;
  const opened = await openNow();
  const openedState = await state();
  assert.equal(opened.registrationPublished, true);
  assert.equal(opened.registrationStatus, 'open');
  assert.equal(opened.registrationOpensAt, openedState.updatedAt.toDate().toISOString());
  assert.equal(opened.registrationOpensAt, openedState.registrationOpensAt.toDate().toISOString());
  assert.equal(opened.registrationClosesAt, new Date(input.startsAt).toISOString());
  assert.equal(openedState.registrationClosesAt.toMillis(), openedState.startsAt.toMillis());
  const openedProjection = (await getDocFromServer(publicRef)).data();
  assert.equal(openedProjection.registrationStatus, 'open');
  assert.equal(openedProjection.registrationWindow.opensAt.toMillis(), openedState.registrationOpensAt.toMillis());
  assert.equal(openedProjection.registrationWindow.closesAt.toMillis(), openedState.startsAt.toMillis());
  await denied(staff.call('configureEventRegistration', { eventId, expectedRevision: revisionBeforeOpening, published: true, openRegistrationsNow: true }), 'functions/aborted');
  await visibility(false);
  await denied(getDocFromServer(publicRef), 'permission-denied');
  const reopenedHidden = await openNow();
  assert.equal(reopenedHidden.registrationPublished, true);
  assert.equal(reopenedHidden.registrationStatus, 'open');
  assert((await visibleIds()).includes(eventId));
  const team = await anonymous('createEventRegistration', { eventId, teamName: 'Synthetic publication team', memberCount: 4, contactEmail: 'synthetic@example.test' });

  // Window edits preserve publication unless the operator explicitly supplies it.
  const editedWindow = await staff.call('configureEventRegistration', { eventId, expectedRevision: (await state()).revision, registrationOpensAt: '2020-01-01T00:00:00Z', registrationClosesAt: '2035-01-01T00:00:00Z' });
  assert.equal(editedWindow.registrationOpensAt, '2020-01-01T00:00:00.000Z');
  assert.equal(editedWindow.registrationClosesAt, '2035-01-01T00:00:00.000Z');
  assert.equal((await state()).registrationPublished, true);
  assert.equal((await state()).registrationStatus, 'open');
  let publicData = (await getDocFromServer(publicRef)).data();
  assert.deepEqual(publicData.capacity, { teams: { accepted: 1, maximum: 2 }, people: { accepted: 4, maximum: 6 } });
  assert.equal(publicData.description, input.description);
  assert.equal(publicData.lifecycleStatus, 'scheduled');
  const token = { eventId, registrationId: team.registrationId, token: team.managementToken };
  await anonymous('updateEventRegistration', { ...token, teamName: team.teamName, memberCount: 3, contactEmail: 'synthetic@example.test' });
  assert.equal((await state()).registrationStatus, 'open');
  const secondTeam = await anonymous('createEventRegistration', { eventId, teamName: 'Second synthetic team', memberCount: 4, contactEmail: 'synthetic@example.test' });
  publicData = (await getDocFromServer(publicRef)).data();
  assert.equal(publicData.registrationStatus, 'full');
  assert.equal(publicData.capacity.teams.accepted, 2);
  assert.equal(publicData.capacity.people.accepted, 7);
  const fullOpened = await openNow();
  assert.equal(fullOpened.registrationStatus, 'full');
  assert.equal((await state()).acceptedPeople, 7);
  await denied(anonymous('createEventRegistration', { eventId, teamName: 'Capacity blocked team', memberCount: 1, contactEmail: 'synthetic@example.test' }), 'functions/failed-precondition');
  await anonymous('cancelEventRegistration', token);
  await anonymous('cancelEventRegistration', { eventId, registrationId: secondTeam.registrationId, token: secondTeam.managementToken });
  publicData = (await getDocFromServer(publicRef)).data();
  assert.equal(publicData.capacity.teams.accepted, 0);
  assert.equal(publicData.capacity.people.accepted, 0);
  assert.equal(publicData.description, input.description);
  const savedWindow = (await state()).registrationClosesAt.toMillis();
  await visibility(false);
  await denied(getDocFromServer(publicRef), 'permission-denied');
  assert(!(await visibleIds()).includes(eventId));
  assert.equal((await state()).registrationClosesAt.toMillis(), savedWindow);
  assert.equal((await privateRef.collection('registrations').doc(team.registrationId).get()).data().status, 'cancelled');
  await staff.call('configureEventRegistration', { eventId, expectedRevision: (await state()).revision, registrationOpensAt: '2021-01-01T00:00:00Z', registrationClosesAt: '2035-01-01T00:00:00Z' });
  assert.equal((await state()).registrationPublished, false);

  for (const override of [{ permissions: originalMember.permissions.filter(value => value !== 'event.manage') }, { events: { mode: 'selected', ids: [] } }, { status: 'disabled' }]) {
    await member.update(override);
    await denied(visibility(true), 'functions/permission-denied');
    await denied(openNow(), 'functions/permission-denied');
    await member.set(originalMember);
  }
  const lifecycle = (await state()).lifecycleStatus;
  await privateRef.update({ lifecycleStatus: 'ready' });
  await denied(getDocFromServer(publicRef), 'permission-denied');
  assert.equal((await state()).registrationPublished, false);
  // Legacy completed-but-published events retain a strictly one-way hide action.
  await privateRef.update({ lifecycleStatus: 'completed', registrationPublished: true });
  const completedRevision = (await state()).revision;
  await denied(staff.call('configureEventRegistration', { eventId, expectedRevision: completedRevision, published: false, registrationOpensAt: '2020-01-01T00:00:00Z', registrationClosesAt: '2035-01-01T00:00:00Z' }), 'functions/failed-precondition');
  await visibility(false);
  assert.equal((await state()).registrationPublished, false);
  assert.equal((await state()).lifecycleStatus, 'completed');
  await denied(visibility(true), 'functions/failed-precondition');
  for (const unavailable of [{ lifecycleStatus: 'cancelled' }, { lifecycleStatus: 'completed' }, { disposition: 'archived' }, { disposition: 'trash' }, { disposition: 'deleting' }]) {
    await privateRef.update({ lifecycleStatus: lifecycle, disposition: 'active', ...unavailable });
    await denied(visibility(true), 'functions/failed-precondition');
    await denied(openNow(), 'functions/failed-precondition');
  }
  await privateRef.update({ lifecycleStatus: lifecycle, disposition: 'active', startsAt: new Date(Date.now() - 60_000) });
  const pastRevision = (await state()).revision;
  await denied(openNow(), 'functions/failed-precondition');
  assert.equal((await state()).revision, pastRevision);
  await privateRef.update({ startsAt: new Date(input.startsAt) });
  await privateRef.update({ lifecycleStatus: lifecycle, disposition: 'active', title: '' });
  await denied(visibility(true), 'functions/failed-precondition');
  console.log(JSON.stringify({ status: 'PASS', hiddenReadDenied: true, filteredPublicList: true, noQuizOrWindowRequired: true, explicitOpenNow: true, serverDerivedWindow: true, reopenVisibleEvent: true, futureAndLifecycleGuards: true, publicationIndependentOfReadiness: true, windowVisibilityPreserved: true, capacityTeamsAndPeople: true, cancellationRestoresCapacity: true, projectionFieldsPreserved: true, privateFieldsExcluded: true, membershipScopeAndPermissions: true }));
} finally {
  for (const path of paths) await staff.db.recursiveDelete(staff.db.doc(path));
  await Promise.all([staff.dispose(), deleteApp(app)]);
}
