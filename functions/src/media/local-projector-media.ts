import { createHash } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { parseQuizAsset } from '@filmovy-kviz/quiz-domain';
import { freshIdentity } from '../access/authorization.js';
import { mediaId, mediaInput } from './model.js';
import {
  readAssignedLocalMediaSource, readCandidates, readSource, requireDemoEmulators,
  syntheticSha256, syntheticSize,
} from './local-event-manifest.js';

const unavailable = () => new HttpsError('failed-precondition', 'Místní obrázek pro tento snímek není povolen.');

function image(reference: string, generation: string) {
  return {
    role: 'question-image', reference, generation, contentType: 'image/png', size: syntheticSize,
    sha256: syntheticSha256,
    etag: '"' + createHash('sha256').update(JSON.stringify([reference, generation, 'image/png', syntheticSize])).digest('hex') + '"',
  };
}

/** Reauthorizes a previously verified file without reading the unavailable media transport. */
export const readLocalEventMediaAuthorization = onCall({ region: 'europe-west1', cors: true, maxInstances: 2 }, async request => {
  requireDemoEmulators();
  request.rawRequest.res?.setHeader('Cache-Control', 'no-store');
  const auth = request.auth;
  if (!auth) throw new HttpsError('unauthenticated', 'Přihlaste se ke svému účtu.');
  const input = mediaInput(request.data, ['eventId', 'reference']);
  const eventId = mediaId(input.eventId);
  const reference = input.reference;
  if (typeof reference !== 'string' || !parseQuizAsset(reference)) throw unavailable();
  await freshIdentity(auth);
  const result = await getFirestore().runTransaction(async tx => {
    const source = await readSource(auth, eventId, tx);
    const { candidates, total } = await readCandidates(tx, source);
    const candidate = candidates.find(value => value.reference === reference);
    if (!candidate) throw unavailable();
    return {
      schemaVersion: 1, eventId, snapshotId: source.snapshotId, quizRevision: source.quizRevision,
      validUntilMs: source.validUntilMs, scopeKey: source.scopeKey, missing: 0, excluded: total - 1,
      media: image(reference, candidate.asset.generation),
    };
  });
  await freshIdentity(auth);
  return result;
});

/** Public, exact current prompt only. It neither publishes a slide nor serves media bytes. */
export const readLocalProjectorMediaAuthority = onCall({ region: 'europe-west1', cors: true, maxInstances: 2 }, async request => {
  requireDemoEmulators();
  request.rawRequest.res?.setHeader('Cache-Control', 'no-store');
  const startedAt = Date.now();
  const input = mediaInput(request.data, ['sessionId', 'revision', 'slidePosition', 'mediaGeneration', 'reference']);
  const sessionId = mediaId(input.sessionId);
  const reference = input.reference;
  const { revision, slidePosition, mediaGeneration } = input;
  if (typeof reference !== 'string' || !parseQuizAsset(reference)
    || ![revision, slidePosition, mediaGeneration].every(value => Number.isSafeInteger(value) && (value as number) >= 0)) {
    throw unavailable();
  }
  return getFirestore().runTransaction(async tx => {
    const db = getFirestore();
    const [privateDoc, publicDoc] = await tx.getAll(db.doc('sessions/' + sessionId), db.doc('publicSessions/' + sessionId));
    const session = privateDoc!.data(), publication = publicDoc!.data();
    if (!session || !publication || session.status !== 'active' || publication.status !== 'active'
      || publication.sessionId !== sessionId || session.revision !== revision || publication.revision !== revision
      || session.currentSlidePosition !== slidePosition || publication.slidePosition !== slidePosition
      || session.mediaGeneration !== mediaGeneration || publication.mediaGeneration !== mediaGeneration
      || session.presentationMode !== 'slide' || publication.presentationMode !== 'slide' || publication.renderMode !== 'question'
      || session.answerRevealed !== false || publication.answerRevealed !== false
      || session.interimResults || session.finalReveal || publication.interimResults || publication.finalReveal
      || publication.interimBackdrop !== undefined || publication.showCue !== undefined
      || publication.answerImage !== undefined || publication.revealedAnswer !== undefined || publication.answerExplanation !== undefined
      || publication.questionImage !== reference || publication.slideKind !== 'image'
      || typeof session.eventId !== 'string' || typeof session.snapshotId !== 'string') throw unavailable();
    const eventId = mediaId(session.eventId);
    const source = await readAssignedLocalMediaSource(eventId, tx);
    if (source.event.liveSessionId !== sessionId || source.snapshotId !== session.snapshotId || source.quizId !== session.quizId) throw unavailable();
    const { candidates } = await readCandidates(tx, source);
    const candidate = candidates.find(value => value.reference === reference
      && value.position === slidePosition && value.slideId === session.currentSlideId);
    if (!candidate || Date.now() >= startedAt + 5_000) throw unavailable();
    return {
      schemaVersion: 1, sessionId, revision, slidePosition, mediaGeneration, eventId,
      snapshotId: source.snapshotId, quizRevision: source.quizRevision, validUntilMs: source.validUntilMs,
      expiresAtMs: Math.min(source.validUntilMs, startedAt + 5_000),
      media: image(reference, candidate.asset.generation),
    };
  });
});
