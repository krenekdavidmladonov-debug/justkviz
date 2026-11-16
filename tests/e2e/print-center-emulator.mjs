import { strict as assert } from 'node:assert';

import { deleteApp, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';

import { requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';

const { projectId, authEndpoint, functionsEndpoint } = requireFullEmulatorEnvironment(process.env, 'Print Center E2E');
const app = initializeApp({ apiKey: 'demo-api-key', authDomain: `${projectId}.firebaseapp.com`, projectId, appId: '1:123:web:print-e2e' }, 'print-e2e');
const auth = getAuth(app);
const functions = getFunctions(app, 'europe-west1');
connectAuthEmulator(auth, `http://${authEndpoint.host}:${authEndpoint.port}`, { disableWarnings: true });
connectFunctionsEmulator(functions, functionsEndpoint.host, functionsEndpoint.port);

const endpoint = `http://${functionsEndpoint.host}:${functionsEndpoint.port}/${projectId}/europe-west1/generatePrintArtifact`;
const invoke = async (name, data) => (await httpsCallable(functions, name)(data)).data;
const eventInput = (title) => ({
  title,
  startsAt: '2026-11-12T18:00:00.000Z',
  timeZone: 'Europe/Prague',
  venue: { name: 'Syntetický sál', publicLocation: 'Praha' },
  teamCapacity: 30,
  peopleCapacity: 180,
  teamSizeMin: 2,
  teamSizeMax: 4,
});

async function request(eventId, options, token) {
  return fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ eventId, options }),
  });
}

async function login(email) {
  const credential = await signInWithEmailAndPassword(auth, email, 'LocalQuiz123!');
  return credential.user.getIdToken();
}

async function expectPdf(response, disposition) {
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /^application\/pdf/iu);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-disposition') ?? '', new RegExp(`^${disposition};`, 'u'));
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-');
  assert.ok(bytes.byteLength > 1_000);
}

async function run() {
  const noAuth = await request('missing', { artifactType: 'answer-key', disposition: 'inline' });
  assert.equal(noAuth.status, 401);

  let token = await login('admin@example.test');
  const unlocked = await invoke('createEvent', { expectedRevision: 0, event: eventInput('Neuzamčená tisková akce') });
  const unlockedResponse = await request(unlocked.eventId, { artifactType: 'answer-key', disposition: 'inline' }, token);
  assert.equal(unlockedResponse.status, 409);

  const created = await invoke('createEvent', { expectedRevision: 0, event: eventInput('PDF Print Center E2E') });
  const locked = await invoke('lockEventQuiz', {
    eventId: created.eventId,
    expectedRevision: 1,
    quizId: 'preflight-ready-e2e',
    expectedQuizRevision: 0,
    acknowledgeWarnings: false,
  });
  assert.equal(locked.lifecycleStatus, 'ready');

  await expectPdf(await request(created.eventId, { artifactType: 'answer-key', disposition: 'attachment' }, token), 'attachment');
  await expectPdf(await request(created.eventId, { artifactType: 'team-sheets', disposition: 'inline', mode: 'generic' }, token), 'inline');
  await invoke('configureEventRegistration', {
    eventId: created.eventId, expectedRevision: 2,
    registrationOpensAt: new Date(Date.now() - 60_000).toISOString(),
    registrationClosesAt: new Date(Date.now() + 3_600_000).toISOString(), published: true,
  });
  await signOut(auth);

  await invoke('createEventRegistration', {
    eventId: created.eventId, teamName: 'Syntetický tým', memberCount: 4, contactEmail: 'print@example.test',
  });

  token = await login('moderator@example.test');
  const forbiddenKey = await request(created.eventId, { artifactType: 'answer-key', disposition: 'inline' }, token);
  assert.equal(forbiddenKey.status, 403);
  await expectPdf(await request(created.eventId, { artifactType: 'score-table', disposition: 'inline' }, token), 'inline');
  await signOut(auth);

  token = await login('user@example.test');
  const forbiddenOrdinary = await request(created.eventId, { artifactType: 'team-sheets', disposition: 'inline', mode: 'generic' }, token);
  assert.equal(forbiddenOrdinary.status, 403);
  const rejectedPayload = await request(created.eventId, { artifactType: 'answer-key', disposition: 'inline', correctAnswers: ['secret'] }, token);
  assert.equal(rejectedPayload.status, 400);

  console.log(JSON.stringify({ status: 'PASS', adminAll: true, moderatorAnswerKeyDenied: true, ordinaryDenied: true, unlockedDenied: true, binaryHeaders: true }, null, 2));
}

try { await run(); }
finally { await deleteApp(app); }
