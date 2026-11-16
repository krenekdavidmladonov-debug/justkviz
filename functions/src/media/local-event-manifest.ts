import { createHash } from 'node:crypto';
import { getApp } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Transaction } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { parseQuizAsset } from '@filmovy-kviz/quiz-domain';
import { authorize, freshIdentity, type AuthIdentity } from '../access/authorization.js';
import { assertEventOperational } from '../events/guards.js';
import { assetPath, mediaId, mediaInput, mediaSignature } from './model.js';
import { mediaBucket } from './storage.js';

const projectId = 'demo-filmovy-kviz-v2';
// Exact 8×4 PNG produced by tests/e2e/media-fixture.mjs syntheticImage().
export const syntheticSize = 84;
export const syntheticSha256 = '11cfcd3c87baa4071b698ef6cfe28c4d359d9a3dbb7ad2cc9b7d5f683b725adc';
const maximumCandidates = 8;
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const unavailable = () => new HttpsError('failed-precondition', 'Místní zkušební balíček médií není dostupný.');

function isLoopbackHost(value: string | undefined): boolean {
  const match = /^(?:127\.0\.0\.1|localhost|\[::1\]):([1-9]\d{0,4})$/u.exec(value ?? '');
  return match !== null && Number(match[1]) <= 65_535;
}

export function requireDemoEmulators() {
  const env = process.env;
  const storage = env.FIREBASE_STORAGE_EMULATOR_HOST;
  if (env.FUNCTIONS_EMULATOR !== 'true' || env.GCLOUD_PROJECT !== projectId
    || (env.GOOGLE_CLOUD_PROJECT !== undefined && env.GOOGLE_CLOUD_PROJECT !== projectId)
    || !isLoopbackHost(env.FIREBASE_AUTH_EMULATOR_HOST) || !isLoopbackHost(env.FIRESTORE_EMULATOR_HOST)
    || !isLoopbackHost(storage) || env.STORAGE_EMULATOR_HOST !== 'http://' + storage
    || getApp().options.projectId !== projectId) {
    throw unavailable();
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype
    ? value as Record<string, unknown> : undefined;
}

function countAssetReferences(value: unknown, counts: Map<string, number>): void {
  if (typeof value === 'string' && value.startsWith('quiz-asset:')) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) countAssetReferences(entry, counts);
    return;
  }
  const object = record(value);
  if (object) for (const entry of Object.values(object)) countAssetReferences(entry, counts);
}

function mediaSlots(data: Record<string, unknown>): number {
  const design = (value: unknown) => {
    const appearance = record(value);
    return [appearance?.backgroundImage, appearance?.logoImage];
  };
  const media: unknown[] = Array.isArray(data.media) ? data.media : [];
  return [
    data.questionImage, data.backgroundImage, data.mediaSource,
    ...design(data.design), ...design(data.defaultDesign), record(data.defaultAppearance)?.backgroundImage,
    ...media.map(item => {
      const source = record(item);
      return source?.role === 'prompt' || source?.role === 'background' ? source.source || source.value || source.url : undefined;
    }),
  ].filter(value => typeof value === 'string' && value.length > 0).length;
}

export async function readSource(auth: AuthIdentity, eventId: string, tx: Transaction) {
  const member = await authorize(auth, ['event.read', 'event.export'], { kind: 'event', id: eventId }, tx);
  const source = await readAssignedLocalMediaSource(eventId, tx);
  return { ...source, scopeKey: sha256(JSON.stringify(['local-event-media-v1', member.uid, member.version, eventId, source.snapshotId])) };
}

export async function readAssignedLocalMediaSource(eventId: string, tx: Transaction) {
  const db = getFirestore();
  const event = (await tx.get(db.doc('events/' + eventId))).data();
  assertEventOperational(event);
  const assignment = record(event.quizAssignment);
  const { snapshotId, quizId, quizRevision } = assignment ?? {};
  if (typeof snapshotId !== 'string' || typeof quizId !== 'string'
    || typeof quizRevision !== 'number' || !Number.isSafeInteger(quizRevision)
    || quizRevision < 0 || !(event.startsAt instanceof Timestamp)) throw unavailable();
  const validUntilMs = event.startsAt.toMillis() + 6 * 60 * 60_000;
  if (!Number.isSafeInteger(validUntilMs) || Date.now() >= validUntilMs) throw unavailable();
  const snapshotRef = db.doc('quizSnapshots/' + mediaId(snapshotId));
  const snapshot = (await tx.get(snapshotRef)).data();
  if (!snapshot || snapshot.status !== 'ready' || snapshot.eventId !== eventId
    || snapshot.quizId !== quizId || snapshot.quizRevision !== quizRevision) throw unavailable();
  return {
    snapshotRef, snapshot, quizId, quizRevision, snapshotId, validUntilMs, event,
  };
}

export async function readCandidates(tx: Transaction, source: Awaited<ReturnType<typeof readAssignedLocalMediaSource>>) {
  const [slides, rounds] = await Promise.all([
    tx.get(source.snapshotRef.collection('slides').orderBy('position').limit(401)),
    tx.get(source.snapshotRef.collection('rounds').limit(401)),
  ]);
  if (slides.size > 400 || rounds.size > 400 || slides.size !== source.snapshot.slideCount
    || rounds.size !== source.snapshot.roundCount) throw unavailable();
  const frozenSlides = slides.docs.map(slide => slide.data());
  const otherRecords = [source.snapshot, ...rounds.docs.map(round => round.data())];
  const allRecords = [...frozenSlides, ...otherRecords];
  const total = allRecords.reduce((sum, data) => sum + mediaSlots(data), 0);
  const counts = new Map<string, number>();
  for (const data of allRecords) countAssetReferences(data, counts);
  const references = slides.docs.flatMap(document => {
    const { questionImage, kind, hidden } = document.data();
    const position: unknown = document.data().position;
    const parsed = parseQuizAsset(questionImage);
    if (typeof questionImage !== 'string' || kind !== 'image' || hidden === true || typeof position !== 'number' || !Number.isSafeInteger(position)
      || parsed?.quizId !== source.quizId || counts.get(questionImage) !== 1) return [];
    return [{ reference: questionImage, assetId: parsed.assetId, slideId: document.id, position }];
  });
  const db = getFirestore();
  const assetRefs = references.map(({ assetId }) => db.doc('quizzes/' + source.quizId + '/mediaAssets/' + assetId));
  const assets = assetRefs.length ? await tx.getAll(...assetRefs) : [];
  const byId = new Map(assets.map(snapshot => [snapshot.id, snapshot.data()]));
  const candidates = references.flatMap(({ reference, assetId, slideId, position }) => {
    const asset = pinnedAsset(source.quizId, assetId, byId.get(assetId));
    return asset ? [{ reference, asset, slideId, position }] : [];
  });
  if (candidates.length > maximumCandidates) throw unavailable();
  return { candidates, total };
}

function pinnedAsset(quizId: string, assetId: string, asset: Record<string, unknown> | undefined) {
  if (!asset || asset.assetId !== assetId || asset.quizId !== quizId
    || asset.status !== 'ready' || asset.kind !== 'image' || asset.contentType !== 'image/png'
    || asset.size !== syntheticSize || asset.drive !== undefined
    || (asset.storageBackend !== undefined && asset.storageBackend !== 'storage')
    || typeof asset.generation !== 'string' || !/^[1-9]\d{0,19}$/u.test(asset.generation)) return null;
  return { path: assetPath(quizId, assetId), generation: asset.generation };
}

export const readLocalEventMediaManifest = onCall({ region: 'europe-west1', cors: true, maxInstances: 2 }, async request => {
  requireDemoEmulators();
  const auth = request.auth;
  if (!auth) throw new HttpsError('unauthenticated', 'Přihlaste se ke svému účtu.');
  const eventId = mediaId(mediaInput(request.data, ['eventId']).eventId);
  await freshIdentity(auth);
  const db = getFirestore();
  const { source, total, candidates } = await db.runTransaction(async tx => {
    const source = await readSource(auth, eventId, tx);
    const { candidates, total } = await readCandidates(tx, source);
    return { source, total, candidates };
  });
  const manifest = {
    schemaVersion: 1, eventId, snapshotId: source.snapshotId, quizRevision: source.quizRevision,
    validUntilMs: source.validUntilMs, scopeKey: source.scopeKey,
  };
  const missing = { ...manifest, media: null, missing: 1, excluded: total };
  let selected: { reference: string; generation: string; sha256: string } | undefined;
  for (const { reference, asset } of candidates) {
    const file = mediaBucket().file(asset.path, { generation: asset.generation });
    const [metadata] = await file.getMetadata().catch(() => { throw unavailable(); });
    if (metadata.generation !== asset.generation || metadata.contentType !== 'image/png' || Number(metadata.size) !== syntheticSize) {
      continue;
    }
    const [bytes] = await file.download({ start: 0, end: syntheticSize - 1 }).catch(() => { throw unavailable(); });
    const digest = sha256(bytes);
    if (bytes.byteLength !== syntheticSize || !mediaSignature(bytes, 'image/png') || digest !== syntheticSha256) continue;
    selected = { reference, generation: asset.generation, sha256: digest };
    break;
  }
  const selectedAsset = selected;
  await freshIdentity(auth);
  await db.runTransaction(async tx => {
    const current = await readSource(auth, eventId, tx);
    const parsed = parseQuizAsset(selectedAsset?.reference);
    const currentAsset = parsed && pinnedAsset(parsed.quizId, parsed.assetId,
      (await tx.get(db.doc('quizzes/' + parsed.quizId + '/mediaAssets/' + parsed.assetId))).data());
    if (current.snapshotId !== source.snapshotId || current.quizId !== source.quizId || current.quizRevision !== source.quizRevision
      || current.validUntilMs !== source.validUntilMs || current.scopeKey !== source.scopeKey
      || currentAsset?.generation !== selectedAsset?.generation) {
      throw new HttpsError('aborted', 'Připravený kvíz nebo oprávnění se změnily. Obnovte detail akce.');
    }
  });
  if (!selectedAsset) return missing;
  return {
    ...manifest, missing: 0, excluded: total - 1,
    media: {
      ...selectedAsset, role: 'question-image', contentType: 'image/png', size: syntheticSize,
      etag: '"' + sha256(JSON.stringify([selectedAsset.reference, selectedAsset.generation, 'image/png', syntheticSize])) + '"',
    },
  };
});
