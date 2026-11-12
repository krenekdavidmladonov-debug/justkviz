import { strict as assert } from 'node:assert';

import { deleteApp, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { collection, connectFirestoreEmulator, doc, getDoc, getDocs, getFirestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';

import { requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';

const { projectId, authEndpoint, firestoreEndpoint, functionsEndpoint } = requireFullEmulatorEnvironment(process.env, 'Registrations E2E');
const app = initializeApp({ apiKey: 'demo-api-key', authDomain: `${projectId}.firebaseapp.com`, projectId, appId: '1:123:web:registrations-e2e' }, 'registrations-e2e');
const auth = getAuth(app);
const firestore = getFirestore(app);
const functions = getFunctions(app, 'europe-west1');
connectAuthEmulator(auth, `http://${authEndpoint.host}:${authEndpoint.port}`, { disableWarnings: true });
connectFirestoreEmulator(firestore, firestoreEndpoint.host, firestoreEndpoint.port);
connectFunctionsEmulator(functions, functionsEndpoint.host, functionsEndpoint.port);
const invoke = async (name, data) => (await httpsCallable(functions, name)(data)).data;

const eventInput = (title, teamCapacity, peopleCapacity, teamSizeMax = 4) => ({
  title, startsAt: new Date(Date.now() + 86_400_000).toISOString(), timeZone: 'Europe/Prague',
  venue: { name: 'Syntetický sál', publicLocation: 'Praha' },
  teamCapacity, peopleCapacity, teamSizeMin: 1, teamSizeMax,
});
const form = (teamName, memberCount, contactEmail = 'team@example.test') => ({ teamName, memberCount, contactEmail });

async function createOpenEvent(title, teams, people, max = 4) {
  const created = await invoke('createEvent', { expectedRevision: 0, event: eventInput(title, teams, people, max) });
  await invoke('configureEventRegistration', {
    eventId: created.eventId, expectedRevision: 1,
    registrationOpensAt: new Date(Date.now() - 60_000).toISOString(),
    registrationClosesAt: new Date(Date.now() + 3_600_000).toISOString(), published: true,
  });
  return created.eventId;
}

async function oneWins(promises) {
  const results = await Promise.allSettled(promises);
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(results.filter((item) => item.status === 'rejected').length, 1);
  return results.find((item) => item.status === 'fulfilled').value;
}

async function run() {
  await signInWithEmailAndPassword(auth, 'admin@example.test', 'LocalQuiz123!');
  const teamRace = await createOpenEvent('Poslední týmový slot', 1, 10);
  const peopleRace = await createOpenEvent('Historický počet osob neomezuje týmy', 3, 3, 3);
  const nameRace = await createOpenEvent('Unikátní jméno', 3, 10);
  const editRace = await createOpenEvent('Editace versus create', 3, 5, 4);
  const cancelRace = await createOpenEvent('Cancel versus create', 1, 4, 4);
  const privacyEvent = await createOpenEvent('Token isolation', 3, 12, 4);
  await signOut(auth);

  await oneWins([
    invoke('createEventRegistration', { eventId: teamRace, ...form('Tým A', 2, 'a@example.test') }),
    invoke('createEventRegistration', { eventId: teamRace, ...form('Tým B', 2, 'b@example.test') }),
  ]);
  await Promise.all([
    invoke('createEventRegistration', { eventId: peopleRace, ...form('Tým C', 2, 'c@example.test') }),
    invoke('createEventRegistration', { eventId: peopleRace, ...form('Tým D', 2, 'd@example.test') }),
  ]);
  await oneWins([
    invoke('createEventRegistration', { eventId: nameRace, ...form('Filmoví borci', 2) }),
    invoke('createEventRegistration', { eventId: nameRace, ...form('  FILMOVÍ   BORCI ', 2) }),
  ]);

  const editable = await invoke('createEventRegistration', { eventId: editRace, ...form('Editovaný tým', 2, 'edit@example.test') });
  await Promise.all([
    invoke('updateEventRegistration', { eventId: editRace, registrationId: editable.registrationId, token: editable.managementToken, ...form('Editovaný tým', 4, 'edit@example.test') }),
    invoke('createEventRegistration', { eventId: editRace, ...form('Nový tým', 2, 'new@example.test') }),
  ]);

  const cancellable = await invoke('createEventRegistration', { eventId: cancelRace, ...form('Původní tým', 4, 'cancel@example.test') });
  const cancelResults = await Promise.allSettled([
    invoke('cancelEventRegistration', { eventId: cancelRace, registrationId: cancellable.registrationId, token: cancellable.managementToken }),
    invoke('createEventRegistration', { eventId: cancelRace, ...form('Náhradní tým', 4, 'replacement@example.test') }),
  ]);
  assert.equal(cancelResults[0].status, 'fulfilled');

  const tokenA = await invoke('createEventRegistration', { eventId: privacyEvent, ...form('Token tým A', 2, 'token-a@example.test') });
  const tokenB = await invoke('createEventRegistration', { eventId: privacyEvent, ...form('Token tým B', 2, 'token-b@example.test') });
  await assert.rejects(
    invoke('getEventRegistration', { eventId: privacyEvent, registrationId: tokenB.registrationId, token: tokenA.managementToken }),
    (error) => error.code === 'functions/not-found',
  );

  await signInWithEmailAndPassword(auth, 'user@example.test', 'LocalQuiz123!');
  await assert.rejects(
    invoke('createEventRegistration', { eventId: privacyEvent, ...form('Běžný uživatel', 1, 'user@example.test') }),
    (error) => error.code === 'functions/permission-denied',
  );
  await signOut(auth);

  await assert.rejects(getDocs(collection(firestore, 'events', privacyEvent, 'registrations')), /permission-denied/u);
  await signInWithEmailAndPassword(auth, 'admin@example.test', 'LocalQuiz123!');
  for (const eventId of [teamRace, peopleRace, nameRace, editRace, cancelRace]) {
    const state = (await getDoc(doc(firestore, 'events', eventId))).data();
    assert.ok(state.acceptedTeams <= state.teamCapacity);
    assert.ok(state.acceptedTeams >= 0);
    assert.ok(state.acceptedPeople >= 0);
  }
  assert.equal((await getDoc(doc(firestore, 'events', peopleRace))).data().acceptedPeople, 4);
  assert.equal((await getDoc(doc(firestore, 'events', editRace))).data().acceptedPeople, 6);
  const privateRegistration = (await getDoc(doc(firestore, 'events', privacyEvent, 'registrations', tokenA.registrationId))).data();
  assert.equal(typeof privateRegistration.managementTokenHash, 'string');
  assert.equal(JSON.stringify(privateRegistration).includes(tokenA.managementToken), false);
  const publicEvent = (await getDoc(doc(firestore, 'publicEvents', privacyEvent))).data();
  assert.equal(JSON.stringify(publicEvent).includes('example.test'), false);

  console.log(JSON.stringify({ status: 'PASS', teamSlotRace: true, nonbindingPeopleCapacity: true, normalizedNameRace: true, editCreateRace: true, cancelCreateRace: true, tokenIsolation: true, rawTokenNotStored: true }, null, 2));
}

try { await run(); } finally { await deleteApp(app); }
