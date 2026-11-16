import { strict as assert } from 'node:assert';

import { deleteApp, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { collection, connectFirestoreEmulator, getDocs, getFirestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';

import { requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';

const { projectId, authEndpoint, firestoreEndpoint, functionsEndpoint } = requireFullEmulatorEnvironment(
  globalThis.process.env,
  'Migrated events E2E',
);
const app = initializeApp({
  apiKey: 'demo-api-key', authDomain: `${projectId}.firebaseapp.com`, projectId,
  appId: '1:123:web:events-migrated-e2e',
}, 'events-migrated-e2e');
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app, 'europe-west1');
connectAuthEmulator(auth, `http://${authEndpoint.host}:${authEndpoint.port}`, { disableWarnings: true });
connectFirestoreEmulator(db, firestoreEndpoint.host, firestoreEndpoint.port);
connectFunctionsEmulator(functions, functionsEndpoint.host, functionsEndpoint.port);

const invoke = async (name, data) => (await httpsCallable(functions, name)(data)).data;

async function run() {
  await signInWithEmailAndPassword(auth, 'admin@example.test', 'LocalQuiz123!');
  const quizzes = (await getDocs(collection(db, 'quizzes'))).docs;
  assert.equal(quizzes.length, 4);

  let blockedCount = 0;
  for (const [index, quiz] of quizzes.entries()) {
    const quizData = quiz.data();
    const event = await invoke('createEvent', {
      expectedRevision: 0,
      event: {
        title: `Migrated lock verification ${index + 1}`,
        startsAt: '2026-12-01T18:00:00.000Z',
        timeZone: 'Europe/Prague',
        venue: { name: 'Local emulator', publicLocation: 'Česko' },
        teamCapacity: 20,
        peopleCapacity: 120,
        teamSizeMin: 2,
        teamSizeMax: 4,
      },
    });
    try {
      await invoke('lockEventQuiz', {
        eventId: event.eventId,
        expectedRevision: event.revision,
        quizId: quiz.id,
        expectedQuizRevision: Number.isInteger(quizData.revision) ? quizData.revision : 0,
        acknowledgeWarnings: true,
      });
    } catch (error) {
      if (error.code === 'functions/failed-precondition' && error.details?.reason === 'QUIZ_BLOCKED') {
        blockedCount += 1;
        continue;
      }
      throw error;
    }
  }

  assert.equal(blockedCount > 0, true, 'At least one existing migrated quiz must be rejected by server-side preflight.');
  globalThis.console.log(JSON.stringify({
    status: 'PASS',
    migratedQuizzesChecked: quizzes.length,
    blockedMigratedQuizzesRejected: blockedCount,
    privateQuizValuesPrinted: false,
  }, null, 2));
}

try { await run(); }
finally { await deleteApp(app); }
