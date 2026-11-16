import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../functions/package.json', import.meta.url));
const { initializeApp: initializeAdminApp, deleteApp: deleteAdminApp } = require('firebase-admin/app');
const { getFirestore: getAdminFirestore } = require('firebase-admin/firestore');

import { deleteApp, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getFirestore,
  query,
  where,
  updateDoc,
} from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';

import { requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';
import { editorIdentity } from './editor-identity.mjs';

const { projectId, authEndpoint, firestoreEndpoint, functionsEndpoint } = requireFullEmulatorEnvironment(
  globalThis.process.env,
  'Events E2E',
);
// Only the validated local emulator inspector may read superseded immutable snapshots.
const adminApp = initializeAdminApp({ projectId }, 'events-snapshot-inspector-e2e');
const adminDb = getAdminFirestore(adminApp);
const app = initializeApp({
  apiKey: 'demo-api-key', authDomain: `${projectId}.firebaseapp.com`, projectId,
  appId: '1:123:web:events-e2e',
}, 'events-e2e');
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app, 'europe-west1');
connectAuthEmulator(auth, `http://${authEndpoint.host}:${authEndpoint.port}`, { disableWarnings: true });
connectFirestoreEmulator(db, firestoreEndpoint.host, firestoreEndpoint.port);
connectFunctionsEmulator(functions, functionsEndpoint.host, functionsEndpoint.port);

const invoke = async (name, data) => (await httpsCallable(functions, name)(data)).data;
const eventInput = (title = 'Events foundation E2E') => ({
  title,
  startsAt: '2026-10-20T17:00:00.000Z',
  timeZone: 'Europe/Prague',
  venue: { name: 'Syntetický sál', publicLocation: 'Praha' },
  teamCapacity: 20,
  peopleCapacity: 120,
  teamSizeMin: 2,
  teamSizeMax: 4,
});

async function expectFunctionError(action, code, reason) {
  try {
    await action();
    assert.fail(`Expected ${code}.`);
  } catch (error) {
    assert.equal(error.code, code);
    if (reason !== undefined) assert.equal(error.details?.reason, reason);
  }
}

async function inspectSnapshot(snapshotId) {
  const ref = adminDb.doc(`quizSnapshots/${snapshotId}`);
  const [root, slides, rounds] = await Promise.all([
    ref.get(), ref.collection('slides').get(), ref.collection('rounds').get(),
  ]);
  return {
    root: root.data(),
    slides: slides.docs.map(item => ({ id: item.id, data: item.data() })),
    rounds: rounds.docs.map(item => ({ id: item.id, data: item.data() })),
  };
}

async function verifyCreationRecovery() {
  const creator = await editorIdentity(), other = await editorIdentity();
  try {
    const member = (await adminDb.collection('memberships').where('email', '==', creator.email).get()).docs[0];
    await member.ref.update({ role: 'owner', events: { mode: 'selected', ids: [] } });
    const initialMember = (await member.ref.get()).data();
    const payload = { expectedRevision: 0, requestId: 'same-request-different-actor', event: eventInput('Concurrent synthetic recovery') };
    const results = await Promise.all(Array.from({ length: 3 }, () => creator.call('createEvent', payload)));
    assert.deepEqual(results[1], results[0]); assert.deepEqual(results[2], results[0]);
    const receipt = results[0], root = adminDb.doc('events/' + receipt.eventId), projection = adminDb.doc('publicEvents/' + receipt.eventId);
    const grantedMember = (await member.ref.get()).data();
    assert.equal(grantedMember.version, initialMember.version + 1);
    assert.deepEqual(grantedMember.events, { mode: 'selected', ids: [receipt.eventId] });
    assert.equal((await adminDb.collection('accessAudit').where('resourceId', '==', receipt.eventId).get()).size, 1);
    const publicData = (await projection.get()).data();
    assert.equal('creationFingerprint' in publicData, false);
    assert.equal('createdBy' in publicData, false);
    const changedConfigurations = [
      { title: 'Changed title' }, { description: 'Changed description' }, { startsAt: '2026-10-21T17:00:00Z' }, { timeZone: 'UTC' },
      { venue: { ...payload.event.venue, name: 'Changed venue' } }, { venue: { ...payload.event.venue, publicLocation: 'Changed location' } },
      { teamCapacity: 21 }, { peopleCapacity: 121 }, { teamSizeMin: 1 }, { teamSizeMax: 3 },
      { pricing: { mode: 'per-event', amountCzk: 2000 } },
      { pricing: { mode: 'per-team', amountCzk: 700 } },
      { pricing: { mode: 'per-team', amountCzk: 350, hidden: true } },
    ];
    const originalRoot = (await root.get()).data();
    for (const change of changedConfigurations) await expectFunctionError(
      () => creator.call('createEvent', { ...payload, event: { ...payload.event, ...change } }), 'functions/already-exists');
    await expectFunctionError(() => creator.call('createEvent', { ...payload, requestId: '../invalid' }), 'functions/invalid-argument');
    assert.deepEqual((await root.get()).data(), originalRoot);
    assert.deepEqual((await projection.get()).data(), publicData);
    const foreign = await other.call('createEvent', payload);
    assert.notEqual(foreign.eventId, receipt.eventId);

    await creator.call('updateEvent', { eventId: receipt.eventId, expectedRevision: 1, event: { ...payload.event, title: 'Later edit must survive retry' } });
    const edited = (await root.get()).data(), editedPublic = (await projection.get()).data();
    assert.deepEqual(await creator.call('createEvent', payload), receipt);
    assert.deepEqual((await root.get()).data(), edited);
    assert.deepEqual((await projection.get()).data(), editedPublic);
    assert.equal((await member.ref.get()).data().version, grantedMember.version);
    assert.equal((await adminDb.collection('accessAudit').where('resourceId', '==', receipt.eventId).get()).size, 1);

    for (const revoked of [
      { events: { mode: 'selected', ids: [] } }, { status: 'suspended' },
      { permissions: grantedMember.permissions.filter(permission => permission !== 'event.create') },
      { permissions: grantedMember.permissions.filter(permission => permission !== 'event.read') },
    ]) {
      await member.ref.set({ ...grantedMember, ...revoked, version: grantedMember.version + 1 });
      await expectFunctionError(() => creator.call('createEvent', payload), 'functions/permission-denied');
      assert.deepEqual((await root.get()).data(), edited);
      assert.deepEqual((await projection.get()).data(), editedPublic);
      assert.equal((await adminDb.collection('accessAudit').where('resourceId', '==', receipt.eventId).get()).size, 1);
    }
    await member.ref.set({ ...grantedMember, version: grantedMember.version + 2 });
    const cancelled = await creator.call('cancelEvent', { eventId: receipt.eventId, expectedRevision: edited.revision });
    await creator.call('trashEvent', { eventId: receipt.eventId, expectedRevision: cancelled.revision });
    await expectFunctionError(() => creator.call('createEvent', payload), 'functions/permission-denied');
    const trashed = (await root.get()).data();
    const deleted = await creator.call('deleteEvent', { eventId: receipt.eventId, expectedRevision: trashed.revision, confirmTitle: trashed.title });
    assert.equal(deleted.state, 'complete');
    assert.equal((await root.get()).exists, false);
    assert.equal((await adminDb.doc('eventTombstones/' + receipt.eventId).get()).exists, true);
    await expectFunctionError(() => creator.call('createEvent', payload), 'functions/failed-precondition');
    assert.equal((await root.get()).exists, false); assert.equal((await projection.get()).exists, false);
  } finally { await Promise.all([creator.dispose(), other.dispose()]); }
}

async function run() {
  await expectFunctionError(
    () => invoke('createEvent', { expectedRevision: 0, event: eventInput() }),
    'functions/unauthenticated',
  );

  await signInWithEmailAndPassword(auth, 'user@example.test', 'LocalQuiz123!');
  await expectFunctionError(
    () => invoke('createEvent', { expectedRevision: 0, event: eventInput() }),
    'functions/permission-denied',
  );
  await signOut(auth);

  await signInWithEmailAndPassword(auth, 'moderator@example.test', 'LocalQuiz123!');
  await expectFunctionError(
    () => invoke('createEvent', { expectedRevision: 0, event: eventInput() }),
    'functions/permission-denied',
  );
  await signOut(auth);

  await signInWithEmailAndPassword(auth, 'admin@example.test', 'LocalQuiz123!');
  const retryPayload = { expectedRevision: 0, requestId: 'events-lost-ack-recovery', event: eventInput('Synthetic lost ACK creation') };
  let committed;
  await assert.rejects(async () => {
    committed = await invoke('createEvent', retryPayload);
    throw new Error('Synthetic transport failure after real server commit');
  }, /Synthetic transport failure/u);
  const recovered = await invoke('createEvent', retryPayload);
  assert.equal(recovered.eventId, committed.eventId, 'A lost creation ACK must retry the same event, not create a duplicate.');
  assert.deepEqual(recovered, committed);
  const matchingRoots = await adminDb.collection('events').where('title', '==', retryPayload.event.title).get();
  const matchingPublic = await adminDb.collection('publicEvents').where('title', '==', retryPayload.event.title).get();
  assert.equal(matchingRoots.size, 1);
  assert.equal(matchingPublic.size, 1);
  await verifyCreationRecovery();
  const created = await invoke('createEvent', { expectedRevision: 0, event: eventInput() });
  assert.equal(created.revision, 1);
  const eventRef = doc(db, 'events', created.eventId);
  const publicRef = doc(db, 'publicEvents', created.eventId);
  const privateCreated = (await getDoc(eventRef)).data();
  assert.equal(privateCreated.scoring.unitScale, 2);
  assert.equal(privateCreated.scoring.rankingMode, 'dense');
  assert.equal(privateCreated.scoring.started, false);
  await assert.rejects(getDocFromServer(publicRef), /permission-denied/u);
  const publicCreated = (await adminDb.doc('publicEvents/' + created.eventId).get()).data();
  assert.deepEqual(Object.keys(publicCreated).sort(), [
    'availability', 'capacity', 'description', 'lifecycleStatus', 'pricing', 'publicLocation', 'registrationPublished', 'registrationStatus', 'registrationWindow',
    'revision', 'startsAt', 'teamSize', 'timeZone', 'title', 'updatedAt', 'venueName',
  ]);
  assert.deepEqual(publicCreated.capacity, { teams: { accepted: 0, maximum: 20 }, people: { accepted: 0, maximum: 120 } });
  assert.equal('quizAssignment' in publicCreated, false);
  await assert.rejects(updateDoc(eventRef, { title: 'Direct bypass' }), /permission-denied/u);

  const updated = await invoke('updateEvent', {
    eventId: created.eventId, expectedRevision: 1, event: eventInput('Upravená Events E2E akce'),
  });
  assert.equal(updated.revision, 2);
  await expectFunctionError(
    () => invoke('updateEvent', { eventId: created.eventId, expectedRevision: 1, event: eventInput('Stale') }),
    'functions/aborted',
  );

  for (const [quizId, status] of [['preflight-blocked-e2e', 'BLOCKED'], ['preflight-warning-e2e', 'READY_WITH_WARNINGS']]) {
    const advisoryEvent = await invoke('createEvent', { expectedRevision: 0, event: eventInput('Optional review synthetic') });
    const advisoryLock = await invoke('lockEventQuiz', { eventId: advisoryEvent.eventId, expectedRevision: 1, quizId, expectedQuizRevision: 0 });
    assert.equal(advisoryLock.preflight.status, status);
    assert.equal(advisoryLock.lifecycleStatus, 'ready');
    const safePublic = (await adminDb.doc('publicEvents/' + advisoryEvent.eventId).get()).data();
    assert.equal('preflight' in safePublic, false);
    assert.equal('quizAssignment' in safePublic, false);
  }

  const locked = await invoke('lockEventQuiz', {
    eventId: created.eventId, expectedRevision: 2, quizId: 'preflight-ready-e2e',
    expectedQuizRevision: 0, acknowledgeWarnings: false,
  });
  assert.equal(locked.revision, 3);
  assert.equal(locked.lifecycleStatus, 'ready');
  assert.equal(locked.preflight.status, 'READY');
  assert.equal((await getDocFromServer(eventRef)).data().registrationPublished, false);
  assert.equal((await adminDb.doc('publicEvents/' + created.eventId).get()).data().lifecycleStatus, 'ready');
  await assert.rejects(getDocFromServer(publicRef), /permission-denied/u);
  const firstSnapshotId = locked.snapshotId;
  const firstSnapshotRef = doc(db, 'quizSnapshots', firstSnapshotId);
  const firstSnapshot = (await getDoc(firstSnapshotRef)).data();
  assert.equal(firstSnapshot.quizId, 'preflight-ready-e2e');
  assert.equal(firstSnapshot.quizRevision, 0);
  assert.equal((await getDoc(doc(db, 'quizSnapshots', firstSnapshotId, 'slides', 'slide-002'))).data().correctAnswer, 'Syntetická odpověď');
  await assert.rejects(updateDoc(firstSnapshotRef, { quizRevision: 999 }), /permission-denied/u);
  const firstSnapshotContents = await inspectSnapshot(firstSnapshotId);

  const relocked = await invoke('lockEventQuiz', {
    eventId: created.eventId, expectedRevision: 3, quizId: 'preflight-ready-e2e',
    expectedQuizRevision: 0, acknowledgeWarnings: false,
  });
  assert.equal(relocked.revision, 4);
  assert.notEqual(relocked.snapshotId, firstSnapshotId);
  await assert.rejects(getDocFromServer(firstSnapshotRef), /permission-denied/u);
  await assert.rejects(getDocFromServer(doc(db, 'quizSnapshots', firstSnapshotId, 'slides', 'slide-002')), /permission-denied/u);
  await assert.rejects(getDocs(collection(db, 'quizSnapshots', firstSnapshotId, 'slides')), /permission-denied/u);
  const preservedSnapshot = await inspectSnapshot(firstSnapshotId);
  assert.equal(preservedSnapshot.root.quizRevision, 0);
  assert.deepEqual(preservedSnapshot, firstSnapshotContents);
  const currentSnapshot = await getDocFromServer(doc(db, 'quizSnapshots', relocked.snapshotId));
  assert.equal(currentSnapshot.data().quizId, 'preflight-ready-e2e');
  assert.equal(currentSnapshot.data().quizRevision, 0);
  assert.equal((await getDocFromServer(doc(db, 'quizSnapshots', relocked.snapshotId, 'slides', 'slide-002'))).data().correctAnswer, 'Syntetická odpověď');

  const warningLocked = await invoke('lockEventQuiz', {
    eventId: created.eventId, expectedRevision: 4, quizId: 'preflight-warning-e2e',
    expectedQuizRevision: 0, acknowledgeWarnings: true,
  });
  assert.equal(warningLocked.revision, 5);
  assert.equal(warningLocked.preflight.status, 'READY_WITH_WARNINGS');

  const toctouEvent = await invoke('createEvent', { expectedRevision: 0, event: eventInput('TOCTOU event') });
  await invoke('updateQuizMetadata', {
    quizId: 'events-toctou-e2e', expectedRevision: 0,
    quiz: { title: 'Změněný kvíz', description: 'Revize změněna před lockem.' },
  });
  await expectFunctionError(
    () => invoke('lockEventQuiz', {
      eventId: toctouEvent.eventId, expectedRevision: 1, quizId: 'events-toctou-e2e',
      expectedQuizRevision: 0, acknowledgeWarnings: false,
    }),
    'functions/aborted',
  );

  await signOut(auth);
  await assert.rejects(getDocFromServer(publicRef), /permission-denied/u);
  assert.equal((await getDocs(query(collection(db, 'publicEvents'), where('registrationPublished', '==', true)))).docs.some((item) => item.id === created.eventId), false);
  await assert.rejects(getDoc(eventRef), /permission-denied/u);
  await assert.rejects(getDoc(firstSnapshotRef), /permission-denied/u);
  await assert.rejects(updateDoc(publicRef, { title: 'Forged' }), /permission-denied/u);

  await signInWithEmailAndPassword(auth, 'moderator@example.test', 'LocalQuiz123!');
  assert.equal((await getDoc(eventRef)).exists(), true);
  await assert.rejects(updateDoc(eventRef, { title: 'Moderator bypass' }), /permission-denied/u);
  await signOut(auth);

  await signInWithEmailAndPassword(auth, 'admin@example.test', 'LocalQuiz123!');
  const cancelled = await invoke('cancelEvent', { eventId: created.eventId, expectedRevision: 5 });
  assert.equal(cancelled.lifecycleStatus, 'cancelled');
  assert.equal((await adminDb.doc('publicEvents/' + created.eventId).get()).data().cancelled, true);
  const archived = await invoke('archiveEvent', { eventId: created.eventId, expectedRevision: 6 });
  assert.equal(archived.lifecycleStatus, 'cancelled');
  assert.equal(archived.disposition, 'archived');

  globalThis.console.log(JSON.stringify({
    status: 'PASS', adminCrud: true, moderatorReadOnly: true, publicProjectionSanitized: true,
    directWritesDenied: true, editorialFindingsAdvisory: true, warningAcknowledgementOptional: true,
    immutableSnapshots: true, supersededSnapshotReadsDenied: true, currentSnapshotReadsAllowed: true,
    relockBeforeScoring: true, staleQuizRevisionDenied: true,
    creationLostAcknowledgementRecovery: true, concurrentCreateDeduplicated: true,
    retryPreservesEditsAndGrants: true, replayRevocationEnforced: true, deletedEventNotResurrected: true,
  }, null, 2));
}

try { await run(); }
finally { await Promise.all([deleteApp(app), deleteAdminApp(adminApp)]); }
