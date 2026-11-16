import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { accessActor, freshIdentity, securedOnCall, runAccessTransaction, currentMembership } from '../access/authorization.js';
import { getFirestore, Timestamp, type DocumentData, type DocumentReference } from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { quizAssetReference, validOwnedMedia } from '@filmovy-kviz/quiz-domain';
import { assetPath, mediaId, mediaInput, mediaSignature } from './model.js';
import { mediaBucket } from './storage.js';

const options = { region: 'europe-west1', cors: true, maxInstances: 5 };
const videoContentType = 'video/mp4';
const sha256Pattern = /^[a-f0-9]{64}$/u;

function admin(request: CallableRequest) {
  return Promise.resolve(accessActor(request.auth).uid);
}

function videoUploadPath(quizId: string, assetId: string) {
  return 'quiz-assets/' + quizId + '/' + assetId + '/upload';
}

export const beginQuizMediaUpload = securedOnCall('beginQuizMediaUpload', options, async request => {
  request.rawRequest.res?.setHeader('Cache-Control', 'no-store');
  const uid = await admin(request), data = mediaInput(request.data, ['quizId','requestId','kind','contentType','size']);
  const quizId = mediaId(data.quizId), requestId = mediaId(data.requestId);
  if (!validOwnedMedia(data.kind, data.contentType, data.size)) throw new HttpsError('invalid-argument', 'Podporujeme PNG/JPEG/WebP do 10 MiB a MP3, WAV či MP4 do 25 MiB.');
  const assetId = createHash('sha256').update(JSON.stringify([quizId, uid, requestId])).digest('hex');
  const ref = getFirestore().doc('quizzes/' + quizId + '/mediaAssets/' + assetId);
  const fingerprint = createHash('sha256').update(JSON.stringify([data.kind,data.contentType,data.size])).digest('hex');
  return runAccessTransaction(getFirestore(), async transaction => {
    const quiz = await transaction.get(ref.parent.parent!), existing = (await transaction.get(ref)).data();
    if (!quiz.exists) throw new HttpsError('not-found', 'Kvíz neexistuje.');
    if (existing && existing.fingerprint !== fingerprint) throw new HttpsError('already-exists', 'Požadavek již patří jinému souboru.');
    if (!existing) transaction.create(ref, { quizId, assetId, kind: data.kind, contentType: data.contentType, size: data.size,
      status: 'uploading', membershipVersion: currentMembership().version, createdBy: uid, createdAt: Timestamp.now(), uploadExpiresAt: Timestamp.fromMillis(Date.now() + 30 * 60_000), fingerprint });
    const path = data.kind === 'video' ? videoUploadPath(quizId, assetId) : assetPath(quizId, assetId);
    return { assetId, path, reference: quizAssetReference(quizId, assetId) };
  });
});

type MediaFile = ReturnType<ReturnType<typeof mediaBucket>['file']>;
type FileMetadata = NonNullable<Awaited<ReturnType<typeof readFileMetadata>>>;

interface VideoReservation {
  stagingGeneration: string;
  sha256: string;
  contentType: typeof videoContentType;
  size: number;
}

function videoConflict() {
  return new HttpsError('failed-precondition', 'Uložené video neodpovídá ověřenému nahrávání. Nahrajte soubor znovu.');
}

function videoGeneration(value: unknown): value is string {
  // The Storage SDK converts the File generation selector to a number.
  return typeof value === 'string' && /^[1-9]\d*$/u.test(value) && Number.isSafeInteger(Number(value));
}

async function readFileMetadata(file: MediaFile) {
  try {
    return (await file.getMetadata())[0];
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && Number(error.code) === 404) return undefined;
    throw error;
  }
}

function checkVideoMetadata(metadata: FileMetadata | undefined, size: number, generation?: string): string {
  if (!metadata || !videoGeneration(metadata.generation) || (generation !== undefined && metadata.generation !== generation)
    || metadata.contentType !== videoContentType || Number(metadata.size) !== size) throw videoConflict();
  if (metadata.contentEncoding !== undefined && metadata.contentEncoding !== '') {
    throw new HttpsError('failed-precondition', 'Soubor MP4 musí být uložený bez dodatečného kódování přenosu.');
  }
  return metadata.generation;
}

async function readVideoDigest(file: MediaFile, size: number, buffer?: Buffer): Promise<string> {
  const stream = file.createReadStream({ start: 0, end: size, decompress: false });
  const hash = createHash('sha256');
  let offset = 0;
  let chunks = 0;
  try {
    for await (const chunk of stream) {
      chunks++;
      if (!Buffer.isBuffer(chunk) || chunk.length < 1 || chunks > 65_536 || offset + chunk.length > size) throw videoConflict();
      hash.update(chunk);
      if (buffer) chunk.copy(buffer, offset);
      offset += chunk.length;
    }
  } finally {
    stream.destroy();
  }
  if (offset !== size) throw videoConflict();
  return hash.digest('hex');
}

function* videoChunks(bytes: Buffer) {
  for (let start = 0; start < bytes.length; start += 64 * 1024) {
    yield bytes.subarray(start, start + 64 * 1024);
  }
}

function readVideoReservation(value: unknown, size: number): VideoReservation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw videoConflict();
  const pin = value as Partial<VideoReservation>;
  if (!videoGeneration(pin.stagingGeneration) || typeof pin.sha256 !== 'string' || !sha256Pattern.test(pin.sha256)
    || pin.contentType !== videoContentType || pin.size !== size) throw videoConflict();
  return { stagingGeneration: pin.stagingGeneration, sha256: pin.sha256, contentType: videoContentType, size };
}

async function finalizeVideoUpload(request: CallableRequest, ref: DocumentReference, grant: DocumentData, quizId: string, assetId: string, uid: string) {
  if (grant.assetId !== assetId || !sha256Pattern.test(assetId) || typeof grant.fingerprint !== 'string'
    || !sha256Pattern.test(grant.fingerprint) || !validOwnedMedia('video', grant.contentType, grant.size)) throw videoConflict();
  const size = grant.size as number;
  const bucket = mediaBucket();
  const staging = bucket.file(videoUploadPath(quizId, assetId));
  const canonical = bucket.file(assetPath(quizId, assetId));
  let stagedBytes: Buffer | undefined;
  let candidate: VideoReservation | undefined;

  if (grant.status === 'uploading') {
    if (!(grant.uploadExpiresAt instanceof Timestamp) || grant.uploadExpiresAt.toMillis() <= Date.now()) throw videoConflict();
    const metadata = await readFileMetadata(staging);
    if (metadata) {
      const stagingGeneration = checkVideoMetadata(metadata, size);
      stagedBytes = Buffer.alloc(size);
      const pinned = bucket.file(staging.name, { generation: stagingGeneration });
      const sha256 = await readVideoDigest(pinned, size, stagedBytes);
      checkVideoMetadata(await readFileMetadata(staging), size, stagingGeneration);
      if (!mediaSignature(stagedBytes.subarray(0, 4096), videoContentType)) {
        throw new HttpsError('failed-precondition', 'Obsah souboru neodpovídá formátu MP4.');
      }
      candidate = { stagingGeneration, sha256, contentType: videoContentType, size };
    }
  }

  function checkGrant(current: DocumentData | undefined): DocumentData {
    if (!current || current.createdBy !== uid || current.quizId !== quizId || current.assetId !== assetId
      || current.kind !== 'video' || current.contentType !== videoContentType || current.size !== size
      || current.fingerprint !== grant.fingerprint) throw videoConflict();
    if (current.membershipVersion !== currentMembership().version) {
      throw new HttpsError('permission-denied', 'Oprávnění k nahrávání se změnilo. Vytvořte nový požadavek.');
    }
    return current;
  }

  await freshIdentity(request.auth);
  const reserved = await runAccessTransaction(getFirestore(), async transaction => {
    const current = checkGrant((await transaction.get(ref)).data());
    if (current.status === 'ready') return undefined;
    if (current.status === 'finalizing') return { pin: readVideoReservation(current.videoFinalizing, size), mayWrite: false };
    if (current.status !== 'uploading' || !(current.uploadExpiresAt instanceof Timestamp)
      || current.uploadExpiresAt.toMillis() <= Date.now()) throw videoConflict();
    if (!candidate) throw new HttpsError('failed-precondition', 'Soubor ještě není nahraný.');
    // Only the transaction that creates this reservation may create the source object.
    transaction.update(ref, { status: 'finalizing', videoFinalizing: candidate });
    return { pin: candidate, mayWrite: true };
  });
  if (!reserved) return;

  const { pin, mayWrite } = reserved;
  const marker = createHash('sha256').update(JSON.stringify([
    quizId, assetId, uid, grant.fingerprint, pin.stagingGeneration, pin.sha256, pin.contentType, pin.size,
  ])).digest('hex');
  let metadata = await readFileMetadata(canonical);
  if (!metadata && mayWrite && stagedBytes) {
    checkVideoMetadata(await readFileMetadata(staging), size, pin.stagingGeneration);
    try {
      await pipeline(Readable.from(videoChunks(stagedBytes), { objectMode: false }), canonical.createWriteStream({
        resumable: false,
        timeout: 30_000,
        // The SDK deletes on a checksum mismatch. Verify the pinned SHA below instead.
        validation: false,
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: { contentType: videoContentType, cacheControl: 'private, no-store', metadata: { videoUploadBinding: marker } },
      }));
    } catch {
      // The write may have succeeded before its response was lost. Verify it below.
    }
    metadata = await readFileMetadata(canonical);
  }
  if (!metadata) {
    throw new HttpsError('aborted', 'Dokončení nahrávání zatím nemá uložený výsledek. Zkuste dokončení zopakovat nebo soubor nahrajte znovu.');
  }

  function verifyCanonical(value: FileMetadata | undefined, generation?: string): string {
    const storedGeneration = checkVideoMetadata(value, size, generation);
    if (Object.keys(value?.metadata ?? {}).length !== 1 || value?.metadata?.videoUploadBinding !== marker) throw videoConflict();
    return storedGeneration;
  }

  const generation = verifyCanonical(metadata);
  const pinnedCanonical = bucket.file(canonical.name, { generation });
  if (await readVideoDigest(pinnedCanonical, size) !== pin.sha256) throw videoConflict();
  verifyCanonical(await readFileMetadata(canonical), generation);

  const pending = await readFileMetadata(staging);
  if (pending) {
    checkVideoMetadata(pending, size, pin.stagingGeneration);
    const pinnedStaging = bucket.file(staging.name, {
      generation: pin.stagingGeneration, preconditionOpts: { ifGenerationMatch: pin.stagingGeneration },
    });
    await pinnedStaging.delete({ ignoreNotFound: true });
  }
  if (await readFileMetadata(staging)) throw videoConflict();

  await freshIdentity(request.auth);
  await runAccessTransaction(getFirestore(), async transaction => {
    const current = checkGrant((await transaction.get(ref)).data());
    if (current.status === 'ready' && current.generation === generation) return;
    if (current.status !== 'finalizing') throw videoConflict();
    const active = readVideoReservation(current.videoFinalizing, size);
    if (active.stagingGeneration !== pin.stagingGeneration || active.sha256 !== pin.sha256) throw videoConflict();
    transaction.update(ref, { status: 'ready', generation, readyAt: Timestamp.now() });
  });
}

export const finalizeQuizMediaUpload = securedOnCall('finalizeQuizMediaUpload', { ...options, concurrency: 2 }, async request => {
  request.rawRequest.res?.setHeader('Cache-Control', 'no-store');
  const uid = await admin(request), input = mediaInput(request.data, ['quizId','assetId']);
  const quizId = mediaId(input.quizId), assetId = mediaId(input.assetId), ref = getFirestore().doc('quizzes/' + quizId + '/mediaAssets/' + assetId);
  const data = (await ref.get()).data();
  if (!data || data.createdBy !== uid || data.quizId !== quizId) throw new HttpsError('not-found', 'Médium neexistuje.');
  if (data.status === 'ready') return { reference: quizAssetReference(quizId, assetId) };
  if (data.membershipVersion !== currentMembership().version) throw new HttpsError('permission-denied', 'Oprávnění k nahrávání se změnilo. Vytvořte nový požadavek.');
  if (data.kind === 'video') {
    await finalizeVideoUpload(request, ref, data, quizId, assetId, uid);
    return { reference: quizAssetReference(quizId, assetId) };
  }
  if (data.status !== 'uploading') throw new HttpsError('failed-precondition', 'Upload není dostupný.');
  const file = mediaBucket().file(assetPath(quizId, assetId));
  const [metadata] = await file.getMetadata().catch(() => { throw new HttpsError('failed-precondition', 'Soubor ještě není nahraný.'); });
  if (metadata.contentType !== data.contentType || Number(metadata.size) !== data.size || !validOwnedMedia(data.kind, metadata.contentType, Number(metadata.size))) throw new HttpsError('failed-precondition', 'Typ nebo velikost souboru nesouhlasí.');
  const [bytes] = await file.download({ start: 0, end: 4095 });
  if (!mediaSignature(bytes, metadata.contentType!)) throw new HttpsError('failed-precondition', 'Obsah souboru neodpovídá deklarovanému typu.');
  // Never publish Firebase download tokens. Reads go through current publication authorization.
  await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: null } });
  await runAccessTransaction(getFirestore(), async transaction => {
    await admin(request);
    const current = (await transaction.get(ref)).data();
    if (current?.membershipVersion !== currentMembership().version) throw new HttpsError('permission-denied', 'Oprávnění k nahrávání se změnilo. Vytvořte nový požadavek.');
    if (!current || current.fingerprint !== data.fingerprint || !['uploading','ready'].includes(current.status as string)) throw new HttpsError('aborted', 'Stav média se změnil.');
    transaction.update(ref, { status: 'ready', generation: metadata.generation, readyAt: Timestamp.now() });
  });
  return { reference: quizAssetReference(quizId, assetId) };
});
