import { createHash } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { createRequire } from 'node:module';
import { describe, expect, test, vi } from 'vitest';
import { assetPath } from '../functions/src/media/model';
import {
  materializeQuizCopyAsset,
  verifyQuizCopyAssetPin,
  type QuizCopyStorageDependencies,
  type QuizCopyStorageDestination,
  type QuizCopyStorageSource,
} from '../functions/src/media/quiz-copy-storage';

const { HttpsError } = createRequire(new URL('../functions/package.json', import.meta.url))('firebase-functions/v2/https') as { HttpsError: new(code: string, message: string) => Error };

const image = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+hF9kAAAAASUVORK5CYII=',
  'base64',
);
const sha256 = createHash('sha256').update(image).digest('hex');
const from: QuizCopyStorageSource = {
  quizId: 'source-quiz', assetId: 'a'.repeat(64), kind: 'image', contentType: 'image/png', size: image.length, generation: '41',
};
const to: QuizCopyStorageDestination = { quizId: 'target-quiz', assetId: 'b'.repeat(64), binding: 'actor-operation-9' };
const fromPath = assetPath(from.quizId, from.assetId);
const toPath = assetPath(to.quizId, to.assetId);

type TestBucket = NonNullable<QuizCopyStorageDependencies['bucket']>;
type TestFile = ReturnType<TestBucket['file']>;
interface WriteOptions {
  readonly preconditionOpts?: unknown;
  readonly metadata?: { readonly contentType?: string; readonly cacheControl?: string; readonly metadata?: Record<string, string> };
}
interface FakeObject {
  readonly bytes: Buffer;
  readonly generation: string;
  readonly contentType: string;
  readonly cacheControl?: string;
  readonly contentEncoding?: string;
  readonly acl?: readonly { entity: string }[];
  readonly metadata?: Record<string, string>;
}

function fakeBucket() {
  const objects = new Map<string, FakeObject>();
  const reads: { path: string; generation: string | undefined; kind: 'metadata' | 'bytes' }[] = [];
  const writes: { path: string; options: WriteOptions }[] = [];
  const failures = { ackLost: false, noObject: false };
  let generation = 100;
  const missing = () => Object.assign(new Error('Sensitive source or destination object path'), { code: 404 });
  const bucket: TestBucket = {
    file(path, options) {
      function get() {
        const value = objects.get(path);
        if (!value || (options?.generation && value.generation !== options.generation)) throw missing();
        return value;
      }
      return {
        async getMetadata() {
          reads.push({ path, generation: options?.generation, kind: 'metadata' });
          const { bytes, ...metadata } = get();
          await Promise.resolve();
          return [{ ...metadata, size: String(bytes.length) }];
        },
        createReadStream(readOptions: { start?: number; end?: number }) {
          reads.push({ path, generation: options?.generation, kind: 'bytes' });
          const { bytes } = get();
          return Readable.from([
            bytes.subarray(readOptions.start ?? 0, (readOptions.end ?? bytes.length - 1) + 1),
          ], { objectMode: false });
        },
        createWriteStream(writeOptions: WriteOptions) {
          writes.push({ path, options: writeOptions });
          const chunks: Buffer[] = [];
          return new Writable({
            write(chunk: Buffer, _encoding, callback) {
              chunks.push(chunk);
              callback();
            },
            final(callback) {
              if (failures.noObject) { callback(new Error('Upload aborted before creation')); return; }
              if (objects.has(path)) { callback(Object.assign(new Error('Precondition failed'), { code: 412 })); return; }
              const metadata = writeOptions.metadata;
              objects.set(path, {
                bytes: Buffer.concat(chunks),
                generation: String(generation++),
                contentType: String(metadata?.contentType),
                cacheControl: metadata?.cacheControl,
                metadata: Object.fromEntries(Object.entries(metadata?.metadata ?? {}).map(([key, value]) => [key, String(value)])),
              });
              if (failures.ackLost) { callback(new Error('Network acknowledgement lost')); return; }
              callback();
            },
          });
        },
      } as unknown as TestFile;
    },
  };
  objects.set(fromPath, {
    bytes: image,
    contentType: from.contentType,
    generation: from.generation,
    metadata: { firebaseStorageDownloadTokens: 'private-source-token', arbitrarySourceField: 'private' },
  });

  return { bucket, objects, reads, writes, failures };
}

describe('independent quiz copy Storage bytes', () => {
  test('pins both generations and writes create-only bytes with fresh private metadata', async () => {
    const fake = fakeBucket();
    const pin = await materializeQuizCopyAsset(from, to, { bucket: fake.bucket });
    expect(pin).toEqual({ generation: '100', sha256 });
    expect(fake.reads).toContainEqual({ path: fromPath, generation: '41', kind: 'metadata' });
    expect(fake.reads).toContainEqual({ path: fromPath, generation: '41', kind: 'bytes' });
    expect(fake.reads).toContainEqual({ path: toPath, generation: '100', kind: 'bytes' });
    expect(fake.writes).toHaveLength(1);
    expect(fake.writes[0]?.options.preconditionOpts).toEqual({ ifGenerationMatch: 0 });
    expect(fake.objects.get(toPath)).toMatchObject({
      bytes: image, generation: '100', contentType: 'image/png', cacheControl: 'private, no-store',
      metadata: { sha256 },
    });
    expect(fake.objects.get(toPath)?.metadata?.quizCopyBinding).toMatch(/^[a-f0-9]{64}$/u);
    expect(Object.keys(fake.objects.get(toPath)?.metadata ?? {}).sort()).toEqual(['quizCopyBinding', 'sha256']);
    expect(fake.objects.get(fromPath)?.metadata?.firebaseStorageDownloadTokens).toBe('private-source-token');
  });

  test('rechecks the current checkpoint generation by one destination metadata read without source IO', async () => {
    const fake = fakeBucket();
    const generation = `drive:${sha256}`;
    const raw = { ...from, generation, sha256, storageBackend: 'drive', status: 'ready' };
    const readDrive = vi.fn<NonNullable<QuizCopyStorageDependencies['readDrive']>>().mockResolvedValue(image);
    const verifyDrive = vi.fn<NonNullable<QuizCopyStorageDependencies['verifyDrive']>>();
    const deps = { bucket: fake.bucket, readDrive, verifyDrive };
    const pin = await materializeQuizCopyAsset({ ...from, generation, raw }, to, deps);
    const before = fake.reads.length;
    await expect(verifyQuizCopyAssetPin({ ...from, generation }, to, pin, deps)).resolves.toBe(true);
    expect(fake.reads.slice(before)).toEqual([{ path: toPath, generation: undefined, kind: 'metadata' }]);
    expect(readDrive).toHaveBeenCalledTimes(1);
    expect(verifyDrive).not.toHaveBeenCalled();

    fake.objects.delete(toPath);
    await expect(verifyQuizCopyAssetPin({ ...from, generation }, to, pin, deps)).resolves.toBe(false);
    expect(fake.writes).toHaveLength(1);
  });

  test('does not reuse mismatched metadata or a public ACL at an already-verified checkpoint', async () => {
    const fake = fakeBucket();
    const pin = await materializeQuizCopyAsset(from, to, { bucket: fake.bucket });
    const saved = fake.objects.get(toPath)!;
    const before = fake.reads.length;
    const failure = { code: 'failed-precondition', details: 'quiz-copy-destination-media-conflict' };
    const variants: Partial<FakeObject>[] = [
      { generation: '101' }, { contentType: 'image/jpeg' }, { bytes: image.subarray(1) },
      { cacheControl: 'public' }, { metadata: { ...saved.metadata, sha256: '0'.repeat(64) } },
      { metadata: { ...saved.metadata, quizCopyBinding: '0'.repeat(64) } },
      { metadata: { ...saved.metadata, firebaseStorageDownloadTokens: 'unsafe' } },
      { acl: [{ entity: 'allUsers' }] }, { acl: [{ entity: 'allAuthenticatedUsers' }] },
    ];
    for (const variant of variants) {
      fake.objects.set(toPath, { ...saved, ...variant });
      await expect(verifyQuizCopyAssetPin(from, to, pin, { bucket: fake.bucket })).rejects.toMatchObject(failure);
    }
    expect(fake.reads.slice(before)).toEqual(variants.map(() => ({ path: toPath, generation: undefined, kind: 'metadata' })));
    expect(fake.writes).toHaveLength(1);
  });

  test('recovers concurrent create-only calls and a lost acknowledgement to the same pin', async () => {
    const fake = fakeBucket();
    fake.failures.ackLost = true;
    const [first, second] = await Promise.all([
      materializeQuizCopyAsset({ ...from, sha256 }, to, { bucket: fake.bucket }),
      materializeQuizCopyAsset({ ...from, sha256 }, to, { bucket: fake.bucket }),
    ]);
    expect(first).toEqual({ generation: '100', sha256 });
    expect(second).toEqual(first);
    expect(fake.writes).toHaveLength(2);

    const readsBeforeRetry = fake.reads.length;
    expect(await materializeQuizCopyAsset({ ...from, sha256 }, to, { bucket: fake.bucket })).toEqual(first);
    expect(fake.writes).toHaveLength(2);
    expect(fake.reads.slice(readsBeforeRetry)).toContainEqual({ path: fromPath, generation: '41', kind: 'metadata' });
    expect(fake.reads.slice(readsBeforeRetry)).not.toContainEqual({ path: fromPath, generation: '41', kind: 'bytes' });
  });

  test('rejects wrong-operation bytes, tokens and a digest-mismatched object at the destination', async () => {
    const fake = fakeBucket();
    await materializeQuizCopyAsset(from, to, { bucket: fake.bucket });
    const stored = fake.objects.get(toPath)!;
    const failure = { code: 'failed-precondition', details: 'quiz-copy-destination-media-conflict' };
    await expect(materializeQuizCopyAsset(from, { ...to, binding: 'another-operation' }, { bucket: fake.bucket })).rejects.toMatchObject(failure);

    fake.objects.set(toPath, { ...stored, metadata: { ...stored.metadata, firebaseStorageDownloadTokens: 'illegal-destination-token' } });
    await expect(materializeQuizCopyAsset({ ...from, sha256 }, to, { bucket: fake.bucket })).rejects.toMatchObject(failure);

    const corrupted = Buffer.from(image);
    const lastByte = corrupted.length - 1;
    corrupted[lastByte] = (corrupted[lastByte] ?? 0) ^ 0x01;
    fake.objects.set(toPath, { ...stored, bytes: corrupted });
    await expect(materializeQuizCopyAsset({ ...from, sha256 }, to, { bucket: fake.bucket })).rejects.toMatchObject(failure);
    expect(fake.writes).toHaveLength(1);
  });

  test('a stale or invalid source is rejected before writing to the destination', async () => {
    const fake = fakeBucket();
    const failure = { code: 'failed-precondition', details: 'quiz-copy-source-media-unavailable' };
    await expect(materializeQuizCopyAsset({ ...from, generation: '40' }, to, { bucket: fake.bucket })).rejects.toMatchObject(failure);
    await expect(materializeQuizCopyAsset({ ...from, sha256: '0'.repeat(64) }, to, { bucket: fake.bucket })).rejects.toMatchObject(failure);
    const original = fake.objects.get(fromPath)!;
    fake.objects.set(fromPath, { ...original, contentEncoding: 'gzip' });
    await expect(materializeQuizCopyAsset(from, to, { bucket: fake.bucket })).rejects.toMatchObject(failure);
    expect(fake.objects.has(toPath)).toBe(false);
    expect(fake.writes).toHaveLength(0);
  });

  test('an upload failure without an object has no ready pin and permits the same request to recover', async () => {
    const fake = fakeBucket();
    fake.failures.noObject = true;
    await expect(materializeQuizCopyAsset(from, to, { bucket: fake.bucket })).rejects.toMatchObject({
      code: 'unavailable', details: 'quiz-copy-media-retry',
    });
    expect(fake.objects.has(toPath)).toBe(false);
    fake.failures.noObject = false;
    await expect(materializeQuizCopyAsset(from, to, { bucket: fake.bucket })).resolves.toEqual({ generation: '100', sha256 });
  });

  test('verifies private Drive access again on replay without redownloading an already copied source', async () => {
    const fake = fakeBucket();
    const generation = `drive:${sha256}`;
    const raw = { ...from, generation, sha256, storageBackend: 'drive', status: 'ready' };
    const drive = { ...from, generation, raw };
    const readDrive = vi.fn<NonNullable<QuizCopyStorageDependencies['readDrive']>>().mockResolvedValue(image);
    const verifyDrive = vi.fn<NonNullable<QuizCopyStorageDependencies['verifyDrive']>>().mockResolvedValue(undefined);
    const deps = { bucket: fake.bucket, readDrive, verifyDrive };

    fake.objects.delete(fromPath);
    await expect(materializeQuizCopyAsset(drive, to, deps)).resolves.toEqual({ generation: '100', sha256 });
    await expect(materializeQuizCopyAsset(drive, to, deps)).resolves.toEqual({ generation: '100', sha256 });
    expect(readDrive).toHaveBeenCalledExactlyOnceWith(raw, from.quizId);
    expect(verifyDrive).toHaveBeenCalledExactlyOnceWith(raw, from.quizId);
    expect(fake.reads.some(read => read.path === fromPath)).toBe(false);
    expect(fake.writes).toHaveLength(1);

    verifyDrive.mockRejectedValue(new HttpsError('permission-denied', 'Sensitive Drive error'));
    await expect(materializeQuizCopyAsset(drive, to, deps)).rejects.toMatchObject({
      code: 'failed-precondition', details: 'quiz-copy-source-media-unavailable',
      message: 'Zdrojové médium kvízu neodpovídá ověřené verzi.',
    });
    expect(readDrive).toHaveBeenCalledTimes(1);
    expect(fake.writes).toHaveLength(1);
  });
});
