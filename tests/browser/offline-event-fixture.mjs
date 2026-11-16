import assert from 'node:assert/strict';
import { createHash, createPublicKey, randomUUID, verify } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { createRequire } from 'node:module';
import { deleteApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { applyOfflineOperation, canonicalOfflineJson, initialOfflineState, offlineOperationContent } from '../../packages/quiz-domain/lib/index.js';
import { editorIdentity } from '../e2e/editor-identity.mjs';
import { mediaSlide } from '../e2e/media-fixture.mjs';
import { requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';

export const offlinePrivateAnswer = 'PRIVATE_OFFLINE_ACTUAL_ANSWER';
export const offlinePrivateNote = 'PRIVATE_OFFLINE_ACTUAL_NOTE';
export const hashOffline = value => createHash('sha256').update(typeof value === 'string' ? value : canonicalOfflineJson(value)).digest('hex');

/** Keeps only this fixture's emulator resources for a subsequent stop/import phase. */
export async function detachOfflineFixture(fixture) {
  const require = createRequire(new URL('../../functions/package.json', import.meta.url));
  const client = getApps().find(app => getAuth(app).currentUser?.uid === fixture.user.uid);
  if (client) await deleteApp(client);
  await require('firebase-admin/app').deleteApp(fixture.adminApp);
}

/** Creates only random owned demo resources through the real administrative boundary. */
export async function offlineEventFixture({ assets = [], imageOnly = false, lockInBrowser = false } = {}) {
  if (imageOnly) assert(assets.length === 1 && assets[0].kind === 'image' && assets[0].contentType === 'image/png', 'Single-image regression requires exactly one owned PNG.');
  const environment = requireFullEmulatorEnvironment(process.env, 'Complete offline QA fixture');
  assert.equal(environment.projectId, 'demo-filmovy-kviz-v2');
  const require = createRequire(new URL('../../functions/package.json', import.meta.url));
  const sdk = require('firebase-admin/app'), existingApps = new Set(sdk.getApps().map(app => app.name));
  const identity = await editorIdentity();
  const adminApp = sdk.getApps().find(app => !existingApps.has(app.name));
  assert(adminApp, 'The fixture must own its newly created Admin app.');
  const bucket = require('firebase-admin/storage').getStorage(adminApp).bucket(environment.projectId + '.appspot.com');
  let quizId, eventId, snapshotId;
  const call = identity.call;
  async function dispose() {
    requireFullEmulatorEnvironment(process.env, 'Complete offline QA cleanup');
    if (eventId) {
      const sessions = await identity.db.collection('sessions').where('eventId', '==', eventId).get();
      for (const row of sessions.docs) {
        await identity.db.recursiveDelete(row.ref);
        await identity.db.doc('publicSessions/' + row.id).delete();
      }
      await identity.db.recursiveDelete(identity.db.doc('events/' + eventId));
      await identity.db.doc('publicEvents/' + eventId).delete();
    }
    if (snapshotId) await identity.db.recursiveDelete(identity.db.doc('quizSnapshots/' + snapshotId));
    if (quizId) {
      await bucket.deleteFiles({ prefix: 'quiz-assets/' + quizId + '/' });
      await identity.db.recursiveDelete(identity.db.doc('quizzes/' + quizId));
    }
    await identity.dispose();
  }
  try {
    ({ quizId } = await call('createQuiz', { title: 'Syntetický úplný offline kvíz', requestId: randomUUID() }));
    const media = [];
    for (const [index, asset] of assets.entries()) {
      // Synthetic trusted-worker output only. Real MP4 bytes use the existing owned MP4 boundary;
      // this does not claim browser upload of video is an authorized product operation.
      const assetId = createHash('sha256').update(quizId + ':' + index).update(asset.bytes).digest('hex');
      const storagePath = `quiz-assets/${quizId}/${assetId}/source`, file = bucket.file(storagePath);
      await file.save(asset.bytes, { resumable: false, metadata: { contentType: asset.contentType } });
      const [metadata] = await file.getMetadata();
      await identity.db.doc(`quizzes/${quizId}/mediaAssets/${assetId}`).set({ quizId, assetId,
        kind: asset.kind, contentType: asset.contentType, size: asset.bytes.length, generation: metadata.generation,
        status: 'ready', storageBackend: 'storage' });
      media.push({ ...asset, assetId, reference: `quiz-asset:${quizId}/${assetId}`, generation: metadata.generation });
    }
    const quiz = async () => (await identity.db.doc('quizzes/' + quizId).get()).data();
    const slides = async () => (await identity.db.collection(`quizzes/${quizId}/slides`).orderBy('position').get()).docs.map(row => ({ id: row.id, ...row.data() }));
    const add = async (kind, extra = {}, position) => call('createQuizSlide', { quizId, expectedRevision: (await quiz()).revision,
      position: position ?? (await slides()).length + 1, ...(['intro', 'end'].includes(kind) ? { scope: 'quiz' } : {}),
      slide: mediaSlide(kind, { title: 'Syntetický ' + kind, text: 'Syntetická otázka ' + kind,
        correctAnswer: ['free', 'image', 'audio', 'video'].includes(kind) ? offlinePrivateAnswer : '',
        moderatorNote: offlinePrivateNote, ...(['free', 'image', 'audio', 'video'].includes(kind) ? { authoringStatus: 'ready' } : {}), ...extra }) });
    await add('intro');
    for (let round = 1; round <= 2; round++) {
      await call('createQuizRound', { quizId, expectedRevision: (await quiz()).revision, title: `Kolo ${round}` });
      const recap = (await slides()).filter(slide => slide.kind === 'recap').at(-1);
      await add('free', { text: `Syntetická otázka kola ${round}` }, recap.position);
      if (imageOnly) {
        if (round === 1) await add('image', { questionImage: media[0].reference, answerImage: '' }, (await slides()).filter(slide => slide.kind === 'recap').at(-1).position);
      } else if (media.length) {
        const addBeforeRecap = async (kind, extra) => add(kind, extra, (await slides()).filter(slide => slide.kind === 'recap').at(-1).position);
        if (round === 1) {
          const images = media.filter(asset => asset.kind === 'image');
          assert.equal(images.length, 3, 'Full fixture requires distinct PNG/JPEG/WebP images.');
          await addBeforeRecap('image', { questionImage: images[0].reference, answerImage: images[1].reference,
            backgroundImage: images[2].reference, design: { logoImage: images[2].reference, showLogo: true },
            answerDesign: { backgroundImage: images[1].reference }, correctAnswer: offlinePrivateAnswer + '_IMAGE' });
          const video = media.find(asset => asset.kind === 'video'); assert(video);
          await addBeforeRecap('video', { mediaSource: video.reference, clipStartSeconds: 1, clipEndSeconds: 3,
            correctAnswer: offlinePrivateAnswer + '_VIDEO' });
        }
        const audio = media.filter(asset => asset.kind === 'audio')[round - 1]; assert(audio);
        await addBeforeRecap('audio', { mediaSource: audio.reference, clipStartSeconds: 1, clipEndSeconds: 3,
          correctAnswer: offlinePrivateAnswer + '_AUDIO_' + round });
      }
    }
    await add('end');
    ({ eventId } = await call('createEvent', { expectedRevision: 0, event: {
      title: 'Syntetický offline večer', startsAt: '2031-11-20T18:00:00Z', timeZone: 'Europe/Prague',
      venue: { name: 'Syntetický sál', publicLocation: 'Pouze lokální QA' }, teamCapacity: 30, peopleCapacity: 120, teamSizeMin: 2, teamSizeMax: 4,
    } }));
    const event = async () => (await identity.db.doc('events/' + eventId).get()).data();
    if (!lockInBrowser) {
      await call('lockEventQuiz', { eventId, quizId, expectedRevision: (await event()).revision,
        expectedQuizRevision: (await quiz()).revision, acknowledgeWarnings: true });
      snapshotId = (await event()).quizAssignment.snapshotId;
    }
    for (let index = 1; index <= 10; index++) await call('adminAddEventTeam', { eventId,
      teamName: `QA${String(index).padStart(2, '0')}`, memberCount: 2, requestId: randomUUID() });
    const app = getApps().find(app => getAuth(app).currentUser?.email === identity.email);
    assert(app, 'Actual signed-in synthetic identity must exist.');
    const user = getAuth(app).currentUser;
    const memberRef = identity.db.doc('memberships/' + user.uid);
    const raw = async (name, data, { anonymous = false, base } = {}) => {
      const endpoint = base ?? `http://${environment.functionsEndpoint.host}:${environment.functionsEndpoint.port}/${environment.projectId}/europe-west1/`;
      return fetch(endpoint + name, { method: 'POST', headers: { 'Content-Type': 'application/json',
        ...(anonymous ? {} : { Authorization: 'Bearer ' + await user.getIdToken() }) }, body: JSON.stringify({ data }) });
    };
    return { identity, adminApp, environment, quizId, eventId, get snapshotId() { return snapshotId; }, event, memberRef, user, raw, call, add, slides, dispose, media,
      confirmBrowserLock: async () => {
        const assignment = (await event()).quizAssignment;
        assert(assignment?.snapshotId && assignment.quizId === quizId);
        snapshotId = assignment.snapshotId;
      },
      prepare: (requestId = randomUUID()) => call('prepareOfflineEvent', { eventId, requestId }) };
  } catch (error) { await dispose(); throw error; }
}

export function verifyServerOfflineGrant(prepared, trust) {
  assert.equal(prepared.ok, true);
  const { manifest, grant } = prepared;
  assert.equal(trust.environment, manifest.environment); assert.equal(trust.audience, manifest.audience);
  assert.equal(trust.keyId, hashOffline(trust.publicJwk)); assert.equal(grant.keyId, trust.keyId);
  assert.equal(grant.payload.manifestDigest, hashOffline(manifest)); assert.equal(grant.digest, hashOffline(grant.payload));
  assert.equal(Buffer.from(grant.signature, 'base64url').length, 64);
  const key = createPublicKey({ key: trust.publicJwk, format: 'jwk' });
  assert(verify('sha256', Buffer.from(canonicalOfflineJson(grant.payload)), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(grant.signature, 'base64url')));
}

export function offlineJournal(manifest, { ended = true } = {}) {
  let state = initialOfflineState(manifest);
  const operations = [];
  const append = command => {
    const content = { ...command, operationId: randomUUID(), sequence: state.sequence + 1, previousHash: state.headHash,
      observedAtMs: Math.max(manifest.issuedAtMs, Date.now()) };
    const operation = { ...content, hash: hashOffline(offlineOperationContent(content)) };
    state = applyOfflineOperation(manifest, state, operation); operations.push(operation);
  };
  append({ type: 'start', payload: {} });
  const question = manifest.slides.find(slide => slide.isQuestion);
  append({ type: 'navigate', payload: { position: question.position } });
  append({ type: 'reveal', payload: { position: question.position } });
  append({ type: 'hide', payload: {} });
  for (const [index, round] of manifest.rounds.entries()) {
    append({ type: 'round-scores', payload: { roundId: round.id, changes: manifest.teams.map(team => ({ teamId: team.id,
      expectedRevision: 0, halfPoints: 2 * (index === 0 ? Number(team.name.slice(2)) : 11 - Number(team.name.slice(2))), reason: '' })) } });
    for (const page of [0, 1]) append({ type: 'results', payload: { throughRoundId: round.id, final: index === 1, page } });
    append({ type: 'results-hide', payload: {} });
  }
  append({ type: 'navigate', payload: { position: manifest.slides.at(-1).position } });
  if (ended) append({ type: 'end', payload: {} });
  return { operations, state, append };
}

/** A real loopback TCP response is dropped only after upstream responds to the committed callable. */
export async function withLostOfflineAcknowledgement(fixture, work) {
  let dropped = 0;
  const server = createServer((incoming, outgoing) => {
    const upstream = httpRequest({ hostname: fixture.environment.functionsEndpoint.host, port: fixture.environment.functionsEndpoint.port,
      path: `/${fixture.environment.projectId}/europe-west1${incoming.url}`, method: incoming.method, headers: incoming.headers }, response => {
      if (response.statusCode === 200) { dropped++; response.resume(); outgoing.destroy(); }
      else { outgoing.writeHead(response.statusCode, response.headers); response.pipe(outgoing); }
    });
    upstream.on('error', () => outgoing.destroy()); incoming.pipe(upstream);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try {
    const address = server.address();
    await work(`http://127.0.0.1:${address.port}/`);
    assert.equal(dropped, 1, 'Exactly one committed callable acknowledgement must have been lost.');
  } finally { await new Promise(resolve => server.close(resolve)); }
}
