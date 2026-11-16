import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  localImageBackupLimits, localImageRoles, parseLocalImageRole, parseQuizAsset, readLocalImageDimensions,
  type LocalImageIdentity, type LocalImageAuthority,
} from '@filmovy-kviz/quiz-domain';
import { freshIdentity } from '../access/authorization.js';
import { mediaBucket } from './storage.js';
import { assetPath, mediaId, mediaInput } from './model.js';
import { requireDemoEmulators } from './local-event-manifest.js';
import {
  readLocalImageGraph, buildLocalImageManifest, cachedLocalImage, imageBackupUnavailable,
  imageDigest, imageEtag, publicImageSources, type ImageCandidate,
} from './local-image-graph.js';

function graphIdentity(graph: Awaited<ReturnType<typeof readLocalImageGraph>>) {
  return imageDigest(JSON.stringify({ snapshotId: graph.source.snapshotId, quizRevision: graph.source.quizRevision,
    validUntilMs: graph.source.validUntilMs, scopeKey: graph.scopeKey, excluded: graph.excluded,
    candidates: graph.candidates.map(({ reference, generation, contentType, size, visibility, uses }) => ({ reference, generation, contentType, size, visibility, uses })) }));
}

async function readPinnedImage(candidate: ImageCandidate): Promise<LocalImageIdentity> {
  const parsed = parseQuizAsset(candidate.reference)!;
  const file = mediaBucket().file(assetPath(parsed.quizId, parsed.assetId), { generation: candidate.generation });
  const [metadata] = await file.getMetadata();
  if (metadata.generation !== candidate.generation || metadata.contentType !== candidate.contentType || Number(metadata.size) !== candidate.size
    || (metadata.contentEncoding !== undefined && metadata.contentEncoding !== '')) throw imageBackupUnavailable();
  // The range, disabled content decompression and byte counter bound every allocation before hashing.
  const stream = file.createReadStream({ start: 0, end: candidate.size, decompress: false });
  const bytes = Buffer.alloc(candidate.size);
  let offset = 0;
  try {
    for await (const chunk of stream) {
      if (!Buffer.isBuffer(chunk) || offset + chunk.length > candidate.size) throw imageBackupUnavailable();
      chunk.copy(bytes, offset); offset += chunk.length;
    }
  } finally { stream.destroy(); }
  if (offset !== candidate.size) throw imageBackupUnavailable();
  const dimensions = readLocalImageDimensions(bytes, candidate.contentType);
  return { reference: candidate.reference, generation: candidate.generation, contentType: candidate.contentType,
    size: candidate.size, sha256: imageDigest(bytes), ...dimensions,
    etag: imageEtag(candidate.reference, candidate.generation, candidate.contentType, candidate.size) };
}

export const readLocalImageManifest = onCall({ region: 'europe-west1', cors: true, maxInstances: 2, timeoutSeconds: 120, memory: '256MiB', concurrency: 1 }, async request => {
  requireDemoEmulators(); request.rawRequest.res?.setHeader('Cache-Control', 'no-store');
  const eventId = mediaId(mediaInput(request.data, ['eventId']).eventId);
  if (!request.auth) throw new HttpsError('unauthenticated', 'Přihlaste se ke svému účtu.');
  await freshIdentity(request.auth);
  const db = getFirestore();
  const initial = await db.runTransaction(tx => readLocalImageGraph(tx, eventId, request.auth));
  const verified = new Map<string, LocalImageIdentity>();
  for (const candidate of initial.candidates) {
    try { verified.set(candidate.reference, await readPinnedImage(candidate)); }
    catch { /* Only a generic per-item omission is returned, never a Storage URL or raw exception. */ }
  }
  await freshIdentity(request.auth);
  const result = await db.runTransaction(async tx => {
    const current = await readLocalImageGraph(tx, eventId, request.auth);
    if (graphIdentity(initial) !== graphIdentity(current)) throw new HttpsError('aborted', 'Kvíz nebo oprávnění se během přípravy změnily.');
    // All reads precede writes. A partial preparation may retain independently verified derived metadata.
    for (const candidate of current.candidates) {
      const identity = verified.get(candidate.reference);
      if (identity) {
        const previous = cachedLocalImage(candidate);
        if (previous && JSON.stringify(previous) !== JSON.stringify(identity)) throw imageBackupUnavailable();
      }
    }
    for (const candidate of current.candidates) {
      const identity = verified.get(candidate.reference);
      if (identity) tx.update(candidate.ref, { localImageIntegrityV3: identity });
      candidate.metadata = { ...candidate.metadata, localImageIntegrityV3: identity };
    }
    return buildLocalImageManifest(current, eventId);
  });
  await freshIdentity(request.auth);
  return result;
});

export const authorizeLocalImageBackup = onCall({ region: 'europe-west1', cors: true, maxInstances: 2 }, async request => {
  requireDemoEmulators(); request.rawRequest.res?.setHeader('Cache-Control', 'no-store');
  const input = mediaInput(request.data, ['eventId', 'snapshotId', 'manifestId']);
  const eventId = mediaId(input.eventId), snapshotId = mediaId(input.snapshotId);
  if (typeof input.manifestId !== 'string' || !/^[a-f0-9]{64}$/u.test(input.manifestId)) throw imageBackupUnavailable();
  if (!request.auth) throw new HttpsError('unauthenticated', 'Přihlaste se ke svému účtu.');
  await freshIdentity(request.auth);
  const manifest = await getFirestore().runTransaction(async tx => buildLocalImageManifest(await readLocalImageGraph(tx, eventId, request.auth), eventId));
  if (manifest.snapshotId !== snapshotId || manifest.manifestId !== input.manifestId || manifest.missing.length) throw imageBackupUnavailable();
  await freshIdentity(request.auth);
  return { schemaVersion: 3, eventId, snapshotId, manifestId: manifest.manifestId, scopeKey: manifest.scopeKey, validUntilMs: manifest.validUntilMs };
});

export const readLocalImageAuthority = onCall({ region: 'europe-west1', cors: true, maxInstances: 2 }, async request => {
  requireDemoEmulators(); request.rawRequest.res?.setHeader('Cache-Control', 'no-store');
  const startedAt = Date.now();
  const input = mediaInput(request.data, ['sessionId', 'revision', 'slidePosition', 'mediaGeneration', 'reference', 'role']);
  const sessionId = mediaId(input.sessionId);
  if (!localImageRoles.some(role => role === input.role)) throw imageBackupUnavailable();
  const role = parseLocalImageRole(input.role);
  const { revision, slidePosition, mediaGeneration, reference } = input;
  if (![revision, slidePosition, mediaGeneration].every(value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
    || typeof reference !== 'string' || !parseQuizAsset(reference)) throw imageBackupUnavailable();
  return getFirestore().runTransaction(async tx => {
    const db = getFirestore();
    const [privateDoc, publicDoc] = await tx.getAll(db.doc('sessions/' + sessionId), db.doc('publicSessions/' + sessionId));
    const session = privateDoc!.data(), publication = publicDoc!.data();
    if (!session || !publication || session.status !== 'active' || publication.status !== 'active' || publication.sessionId !== sessionId
      || session.revision !== revision || publication.revision !== revision || session.currentSlidePosition !== slidePosition || publication.slidePosition !== slidePosition
      || session.mediaGeneration !== mediaGeneration || publication.mediaGeneration !== mediaGeneration
      || session.presentationMode !== publication.presentationMode || session.answerRevealed !== publication.answerRevealed
      || session.interimResults || session.finalReveal || publication.interimResults || publication.finalReveal || publication.interimBackdrop || publication.showCue
      || typeof session.eventId !== 'string' || typeof session.snapshotId !== 'string') throw imageBackupUnavailable();
    if (typeof publication.answerRevealed !== 'boolean') throw imageBackupUnavailable();
    if (publication.answerRevealed) {
      if (publication.renderMode !== 'recap' || typeof publication.revealedAnswer !== 'string' || !publication.revealedAnswer.trim()) throw imageBackupUnavailable();
    } else if (publication.answerImage !== undefined || publication.revealedAnswer !== undefined || publication.answerExplanation !== undefined) throw imageBackupUnavailable();
    const recap = session.presentationMode === 'recap';
    if ((!recap && session.presentationMode !== 'slide') || (recap && (session.recapQuestionPosition !== publication.recapQuestionPosition || publication.answerRevealed !== true))) throw imageBackupUnavailable();
    const sourcePosition: unknown = recap ? session.recapQuestionPosition : session.currentSlidePosition;
    if (typeof sourcePosition !== 'number' || !Number.isSafeInteger(sourcePosition)) throw imageBackupUnavailable();
    const visible = publicImageSources(publication);
    if (!visible.some(value => value.role === role && value.reference === reference)) throw imageBackupUnavailable();
    const eventId = mediaId(session.eventId);
    const graph = await readLocalImageGraph(tx, eventId).catch(() => { throw imageBackupUnavailable(); });
    if (graph.source.event.liveSessionId !== sessionId || graph.source.snapshotId !== session.snapshotId || graph.source.quizId !== session.quizId
      || (!recap && graph.slides.get(sourcePosition)?.id !== session.currentSlideId)
      || (recap && graph.slides.get(sourcePosition)?.id !== session.recapQuestionId)) throw imageBackupUnavailable();
    const candidate = graph.candidates.find(value => value.reference === reference && value.uses.some(use => use.role === role && use.slidePosition === sourcePosition));
    const identity = candidate && cachedLocalImage(candidate);
    if (!candidate || !identity || (candidate.visibility === 'answer' && publication.answerRevealed !== true)) throw imageBackupUnavailable();
    let framePixels = 0;
    for (const { reference: frameReference } of visible) {
      if (!parseQuizAsset(frameReference)) continue;
      const frameCandidate = graph.candidates.find(value => value.reference === frameReference);
      const frameImage = frameCandidate && cachedLocalImage(frameCandidate);
      if (frameImage) framePixels += frameImage.width * frameImage.height;
    }
    if (framePixels > localImageBackupLimits.framePixels || Date.now() >= startedAt + 5_000) throw imageBackupUnavailable();
    const result: LocalImageAuthority = { schemaVersion: 3, sessionId, revision: revision as number, slidePosition: slidePosition as number,
      mediaGeneration: mediaGeneration as number, eventId, snapshotId: graph.source.snapshotId, quizRevision: graph.source.quizRevision,
      validUntilMs: graph.source.validUntilMs, expiresAtMs: Math.min(graph.source.validUntilMs, startedAt + 5_000), media: { ...identity, role } };
    return result;
  });
});
