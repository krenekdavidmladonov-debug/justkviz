import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { HttpsError } from 'firebase-functions/v2/https';
import { parseQuizAsset, quizAssetReference, validOwnedMedia, type OwnedMediaKind } from '@filmovy-kviz/quiz-domain';
import { readDriveAsset, verifyDriveAsset } from '../drive/media-read.js';
import { assetPath, mediaSignature } from './model.js';
import { mediaBucket } from './storage.js';

export interface QuizCopyStorageSource {
  readonly quizId: string;
  readonly assetId: string;
  readonly kind: OwnedMediaKind;
  readonly contentType: string;
  readonly size: number;
  readonly generation: string;
  readonly sha256?: string;
  readonly raw?: Record<string, unknown>;
}

export interface QuizCopyStorageDestination {
  readonly quizId: string;
  readonly assetId: string;
  readonly binding: string;
}

type StorageFile = ReturnType<ReturnType<typeof mediaBucket>['file']>;
type CopyFile = Pick<StorageFile, 'getMetadata' | 'createReadStream' | 'createWriteStream'>;
interface CopyBucket {
  file(path: string, options?: { generation: string }): CopyFile;
}

export interface QuizCopyStorageDependencies {
  readonly bucket?: CopyBucket;
  readonly readDrive?: typeof readDriveAsset;
  readonly verifyDrive?: typeof verifyDriveAsset;
}

type StoredMetadata = NonNullable<Awaited<ReturnType<typeof readMetadata>>>;
export interface QuizCopyStoragePin { readonly generation: string; readonly sha256: string }
const digestPattern = /^[0-9a-f]{64}$/u;

function sourceUnavailable() {
  return new HttpsError('failed-precondition', 'Zdrojové médium kvízu neodpovídá ověřené verzi.', 'quiz-copy-source-media-unavailable');
}
function copyConflict() {
  return new HttpsError('failed-precondition', 'Uložená kopie média neodpovídá požadavku.', 'quiz-copy-destination-media-conflict');
}
function copyPending() {
  return new HttpsError('unavailable', 'Uložení kopie média se nepodařilo ověřit. Zkuste duplikaci znovu.', 'quiz-copy-media-retry');
}

function storageGeneration(value: unknown): value is string {
  // The SDK's File generation selector is converted to a number.
  return typeof value === 'string' && /^[1-9]\d*$/u.test(value) && Number.isSafeInteger(Number(value));
}

function checkStoragePin(metadata: StoredMetadata | undefined, source: QuizCopyStorageSource,
  failure: () => HttpsError, generation?: string): string {
  if (!metadata || !storageGeneration(metadata.generation) || (generation !== undefined && metadata.generation !== generation)
    || metadata.contentType !== source.contentType || Number(metadata.size) !== source.size
    || (metadata.contentEncoding !== undefined && metadata.contentEncoding !== '')) throw failure();
  return metadata.generation;
}

async function readMetadata(file: CopyFile) {
  try {
    return (await file.getMetadata())[0];
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && Number(error.code) === 404) return undefined;
    throw error;
  }
}

async function readPinnedDigest(file: CopyFile, source: QuizCopyStorageSource, failure: () => HttpsError, bytes?: Buffer): Promise<string> {
  // Request at most declared size + 1 to detect a mismatched object without a larger download.
  const stream = file.createReadStream({ start: 0, end: source.size, decompress: false, validation: false });
  const preview = Buffer.alloc(Math.min(4096, source.size));
  const hash = createHash('sha256');
  let offset = 0;
  let chunks = 0;
  try {
    for await (const chunk of stream) {
      chunks++;
      if (!Buffer.isBuffer(chunk) || !chunk.length || chunks > 65_536 || offset + chunk.length > source.size) throw failure();
      if (offset < preview.length) chunk.copy(preview, offset, 0, Math.min(chunk.length, preview.length - offset));
      if (bytes) chunk.copy(bytes, offset);
      hash.update(chunk);
      offset += chunk.length;
    }
  } finally {
    stream.destroy();
  }
  if (offset !== source.size || !mediaSignature(preview, source.contentType)) throw failure();
  return hash.digest('hex');
}

async function useDrive<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof HttpsError && ['failed-precondition', 'permission-denied', 'not-found'].includes(error.code)) {
      throw sourceUnavailable();
    }
    throw copyPending();
  }
}

function* uploadChunks(bytes: Buffer) {
  for (let start = 0; start < bytes.length; start += 64 * 1024) yield bytes.subarray(start, start + 64 * 1024);
}

function storageBinding(source: QuizCopyStorageSource, destination: QuizCopyStorageDestination): string {
  if (!parseQuizAsset(quizAssetReference(source.quizId, source.assetId))
    || !parseQuizAsset(quizAssetReference(destination.quizId, destination.assetId))
    || source.quizId === destination.quizId
    || typeof destination.binding !== 'string' || !destination.binding.trim() || destination.binding.length > 256
    || typeof source.generation !== 'string' || !validOwnedMedia(source.kind, source.contentType, source.size)
    || (source.sha256 !== undefined && !digestPattern.test(source.sha256))) throw sourceUnavailable();

  return createHash('sha256').update(JSON.stringify([
    'quiz-copy-v1', source.quizId, source.assetId, source.generation, source.kind, source.contentType, source.size,
    destination.quizId, destination.assetId, destination.binding,
  ])).digest('hex');
}

function expectedDigest(source: QuizCopyStorageSource): string | undefined {
  if (source.generation.startsWith('drive:')) {
    const digest = source.generation.slice('drive:'.length);
    if (!digestPattern.test(digest) || (source.sha256 !== undefined && source.sha256 !== digest)) throw sourceUnavailable();
    return digest;
  }
  if (!storageGeneration(source.generation)) throw sourceUnavailable();
  return source.sha256;
}

function verifyDestinationMetadata(value: StoredMetadata | undefined, source: QuizCopyStorageSource, binding: string,
  sha256: string, generation?: string): string {
  const pin = checkStoragePin(value, source, copyConflict, generation);
  const custom = value?.metadata ?? {};
  if (value?.cacheControl !== 'private, no-store' || value.acl?.some(entry => entry.entity === 'allUsers' || entry.entity === 'allAuthenticatedUsers')
    || Object.keys(custom).length !== 2 || custom.quizCopyBinding !== binding || custom.sha256 !== sha256) throw copyConflict();
  return pin;
}

/** Check the current object against a server-owned pin recorded after byte verification. */
export async function verifyQuizCopyAssetPin(
  source: QuizCopyStorageSource,
  destination: QuizCopyStorageDestination,
  pin: QuizCopyStoragePin,
  dependencies: QuizCopyStorageDependencies = {},
): Promise<boolean> {
  const binding = storageBinding(source, destination);
  const expectedSha256 = expectedDigest(source);
  if (!storageGeneration(pin.generation) || !digestPattern.test(pin.sha256)
    || (expectedSha256 !== undefined && expectedSha256 !== pin.sha256)) throw copyConflict();
  try {
    const bucket = dependencies.bucket ?? mediaBucket();
    const value = await readMetadata(bucket.file(assetPath(destination.quizId, destination.assetId)));
    if (!value) return false;
    verifyDestinationMetadata(value, source, binding, pin.sha256, pin.generation);
    return true;
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw copyPending();
  }
}

/** Create an independent canonical object, or recover the exact same create after an uncertain acknowledgement. */
export async function materializeQuizCopyAsset(
  source: QuizCopyStorageSource,
  destination: QuizCopyStorageDestination,
  dependencies: QuizCopyStorageDependencies = {},
): Promise<QuizCopyStoragePin> {
  const binding = storageBinding(source, destination);
  const expectedSha256 = expectedDigest(source);
  const drive = source.generation.startsWith('drive:');
  const raw = source.raw;
  if (drive) {
    if (!raw || raw.quizId !== source.quizId || raw.assetId !== source.assetId || raw.generation !== source.generation
      || raw.sha256 !== expectedSha256 || raw.kind !== source.kind || raw.contentType !== source.contentType || raw.size !== source.size) {
      throw sourceUnavailable();
    }
  } else if (raw !== undefined) throw sourceUnavailable();

  try {
    const bucket = dependencies.bucket ?? mediaBucket();
    const sourceFile = drive ? undefined : bucket.file(assetPath(source.quizId, source.assetId), { generation: source.generation });
    if (sourceFile) checkStoragePin(await readMetadata(sourceFile), source, sourceUnavailable, source.generation);
    const destinationPath = assetPath(destination.quizId, destination.assetId);
    const canonical = bucket.file(destinationPath);

    async function verifyCopy(value: StoredMetadata, sha256: string): Promise<QuizCopyStoragePin> {
      const generation = verifyDestinationMetadata(value, source, binding, sha256);
      if (await readPinnedDigest(bucket.file(destinationPath, { generation }), source, copyConflict) !== sha256) throw copyConflict();
      verifyDestinationMetadata(await readMetadata(canonical), source, binding, sha256, generation);
      return { generation, sha256 };
    }

    let metadata = await readMetadata(canonical);
    if (metadata && expectedSha256 !== undefined) {
      if (raw) await useDrive(() => (dependencies.verifyDrive ?? verifyDriveAsset)(raw, source.quizId));
      return await verifyCopy(metadata, expectedSha256);
    }

    let bytes: Buffer, sha256: string;
    if (raw) {
      bytes = await useDrive(() => (dependencies.readDrive ?? readDriveAsset)(raw, source.quizId));
      if (!Buffer.isBuffer(bytes) || bytes.length !== source.size || !mediaSignature(bytes, source.contentType)) throw sourceUnavailable();
      sha256 = createHash('sha256').update(bytes).digest('hex');
    } else {
      if (!sourceFile) throw sourceUnavailable();
      bytes = Buffer.alloc(source.size);
      sha256 = await readPinnedDigest(sourceFile, source, sourceUnavailable, bytes);
    }
    if (expectedSha256 !== undefined && sha256 !== expectedSha256) throw sourceUnavailable();
    if (!metadata) {
      try {
        await pipeline(Readable.from(uploadChunks(bytes), { objectMode: false }), canonical.createWriteStream({
          resumable: false,
          timeout: 30_000,
          // SDK checksum failure can delete the object. Verify the pinned bytes below.
          validation: false,
          preconditionOpts: { ifGenerationMatch: 0 },
          metadata: { contentType: source.contentType, cacheControl: 'private, no-store', metadata: { quizCopyBinding: binding, sha256 } },
        }));
      } catch {
        // Another invocation or a lost acknowledgement can leave precisely this object.
      }
      metadata = await readMetadata(canonical);
      if (!metadata) throw copyPending();
    }
    return await verifyCopy(metadata, sha256);
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw copyPending();
  }
}
