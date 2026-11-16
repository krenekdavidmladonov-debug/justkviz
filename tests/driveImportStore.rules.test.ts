import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { assertFails, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { rolePresets } from '../packages/quiz-domain/src/access';
import { firestoreDriveImportStore } from '../functions/src/drive/import-store';
import { DriveImportService, type DriveImportFiles, type DriveImportProcessor } from '../functions/src/drive/imports';
import type { DriveImportAsset, DriveImportJob, DriveImportLocator } from '../functions/src/drive/import-model';

const projectId = 'demo-filmovy-kviz-v2', ownerUid = 'drive-import-owner';
const target = { quizId: 'drive-import-quiz', slideId: 'source-slide', field: 'mediaSource' as const };
const slidePath = 'quizzes/' + target.quizId + '/slides/' + target.slideId;
const questionPath = 'quizzes/' + target.quizId + '/rounds/source-round/questions/' + target.slideId;
const sourceSlide = () => ({ kind: 'video', position: 1, isQuestion: true, roundId: 'source-round',
  mediaSource: 'https://www.youtube.com/watch?v=abcdefghijk', clipStartSeconds: 10, clipEndSeconds: 23,
  correctAnswer: 'PRIVATE_ANSWER', moderatorNote: 'PRIVATE_NOTE', legacy: { raw: { retained: true } } });
type Dependencies = NonNullable<Parameters<typeof firestoreDriveImportStore>[0]>;
type Db = NonNullable<Dependencies['db']>;
let environment: RulesTestEnvironment, db: Db, app: object;
let deleteAdminApp: (app: object) => Promise<void>;
const user = { disabled: false, emailVerified: true, tokensValidAfterTime: new Date(0).toUTCString() };

beforeAll(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST, endpoint = /^(localhost|127\.0\.0\.1|\[::1\]):([1-9]\d{0,4})$/u.exec(host ?? '');
  if (!endpoint || Number(endpoint[2]) > 65535 || (process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== projectId)) {
    throw new Error('Drive import integration requires an explicit loopback demo Firestore emulator.');
  }
  environment = await initializeTestEnvironment({ projectId, firestore: { host: endpoint[1]!, port: Number(endpoint[2]),
    rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8') } });
  const require = createRequire(new URL('../functions/package.json', import.meta.url));
  const sdk = require('firebase-admin/app') as { initializeApp(options: { projectId: string }, name: string): object; deleteApp(app: object): Promise<void> };
  app = sdk.initializeApp({ projectId }, 'drive-import-integration-' + randomUUID()); deleteAdminApp = app => sdk.deleteApp(app);
  db = (require('firebase-admin/firestore') as { getFirestore(app: object): Db }).getFirestore(app);
});
beforeEach(async () => {
  await environment.clearFirestore(); user.disabled = false; user.emailVerified = true; user.tokensValidAfterTime = new Date(0).toUTCString();
  const batch = db.batch();
  batch.set(db.doc('memberships/' + ownerUid), { uid: ownerUid, role: 'owner', status: 'active', version: 1, sessionValidAfter: 0,
    permissions: [...rolePresets.owner], quizzes: { mode: 'all', ids: [] }, events: { mode: 'none', ids: [] } });
  batch.set(db.doc('driveConnections/' + ownerUid), { revision: 1, generation: 1, account: { permissionId: 'synthetic_account' },
    folder: { id: 'synthetic_folder' }, refreshToken: { ciphertext: 'PRIVATE_ENCRYPTED_TOKEN' } });
  batch.set(db.doc('quizzes/' + target.quizId), { revision: 7, createdBy: ownerUid, slideCount: 1, roundCount: 1, questionCount: 1 });
  batch.set(db.doc(slidePath), sourceSlide());
  batch.set(db.doc(questionPath), { position: 1, sourceSlideId: target.slideId, prompt: 'Retained prompt', correctAnswer: 'PRIVATE_ANSWER', unknownExtension: { retained: true } });
  batch.set(db.doc('quizSnapshots/retained-snapshot/slides/source-slide'), sourceSlide());
  batch.set(db.doc('publicSessions/retained-session'), { status: 'waiting', sentinel: 'unchanged' });
  await batch.commit();
});
afterAll(async () => { await db?.terminate(); if (app) await deleteAdminApp(app); await environment?.cleanup(); });

function fixture() {
  const auth = { getUser: vi.fn(() => Promise.resolve(user)) } as unknown as NonNullable<Dependencies['auth']>;
  const prepare = vi.fn<DriveImportProcessor['prepare']>(() => Promise.resolve({ bytes: Buffer.from('synthetic-video'), contentType: 'video/mp4', durationSeconds: 13 }));
  const processor: DriveImportProcessor = { prepare };
  const upload = vi.fn((_connection: Parameters<DriveImportFiles['upload']>[0], input: Parameters<DriveImportFiles['upload']>[1]) => Promise.resolve({
    id: input.id, folderId: input.folderId, mimeType: input.mimeType, size: input.bytes.length,
    sha256: createHash('sha256').update(input.bytes).digest('hex'), md5Checksum: createHash('md5').update(input.bytes).digest('hex') }));
  const files: DriveImportFiles = { generateId: () => Promise.resolve('synthetic_file_id'), upload };
  const store = firestoreDriveImportStore({ db, auth });
  const service = new DriveImportService(ownerUid, store, processor, files);
  const enqueue = async (): Promise<DriveImportLocator> => ({ ...target, jobId: (await service.request(target)).jobId });
  return { auth, processor, prepare, upload, store, service, enqueue };
}

test('real transaction atomically attaches immutable asset, updates existing question/revision and preserves private/public snapshots', async () => {
  const f = fixture(), location = await f.enqueue();
  expect((await db.doc('driveMediaJobs/' + location.jobId).get()).data()?.status).toBe('queued');
  const result = await f.service.run(location); expect(result.status).toBe('ready');
  const job = (await db.doc('driveMediaJobs/' + location.jobId).get()).data() as DriveImportJob;
  const asset = (await db.doc(`quizzes/${target.quizId}/mediaAssets/${job.assetId}`).get()).data() as DriveImportAsset;
  expect(asset).toMatchObject({ storageBackend: 'drive', sha256: asset.drive.file.sha256,
    generation: 'drive:' + asset.sha256, importJobId: location.jobId,
    drive: { ownerUid, accountPermissionId: 'synthetic_account' } });
  expect((await db.doc(slidePath).get()).data()).toMatchObject({ mediaSource: result.reference, clipStartSeconds: 0, clipEndSeconds: 13,
    correctAnswer: 'PRIVATE_ANSWER', moderatorNote: 'PRIVATE_NOTE', legacy: { raw: { retained: true } } });
  expect((await db.doc(questionPath).get()).data()).toMatchObject({ mediaSource: result.reference, clipStartSeconds: 0, clipEndSeconds: 13,
    prompt: 'Retained prompt', correctAnswer: 'PRIVATE_ANSWER', unknownExtension: { retained: true } });
  expect((await db.doc('quizzes/' + target.quizId).get()).data()).toMatchObject({ revision: 8, slideCount: 1, roundCount: 1, questionCount: 1 });
  expect((await db.doc('quizSnapshots/retained-snapshot/slides/source-slide').get()).data()).toEqual(sourceSlide());
  expect((await db.doc('publicSessions/retained-session').get()).data()).toEqual({ status: 'waiting', sentinel: 'unchanged' });
  expect(await f.service.request(target)).toEqual(result);
  expect((await db.collection(`quizzes/${target.quizId}/mediaAssets`).get()).size).toBe(1);
});

test('legacy absent derived question remains absent; missing isQuestion flag updates an existing question without structural/count changes', async () => {
  await db.doc(questionPath).delete();
  const f = fixture(), location = await f.enqueue(); expect((await f.service.run(location)).status).toBe('ready');
  expect((await db.doc(questionPath).get()).exists).toBe(false);
  // Re-seed only this test target to exercise the older slide shape without an explicit question flag.
  const raw: Record<string, unknown> = sourceSlide(); delete raw.isQuestion;
  await db.doc(slidePath).set(raw);
  await db.doc(questionPath).set({ sourceSlideId: target.slideId, unknownExtension: 'keep' });
  await db.doc('driveConnections/' + ownerUid).update({ revision: 2 });
  const next = await f.enqueue(); expect((await f.service.run(next)).status).toBe('ready');
  expect((await db.doc(questionPath).get()).data()).toMatchObject({ clipStartSeconds: 0, clipEndSeconds: 13, unknownExtension: 'keep' });
});

test('a failed atomic write rolls back ready asset, slide and quiz revision together', async () => {
  const f = fixture(), location = await f.enqueue();
  const job = (await db.doc('driveMediaJobs/' + location.jobId).get()).data() as DriveImportJob;
  const assetId = createHash('sha256').update(JSON.stringify(['drive-asset-v1', job.jobId])).digest('hex');
  // An existing immutable ID makes tx.create fail; all other writes in that commit must roll back.
  await db.doc(`quizzes/${target.quizId}/mediaAssets/${assetId}`).set({ sentinel: 'retained-existing-immutable-asset' });
  expect(await f.service.run(location)).toEqual({ jobId: location.jobId, status: 'failed', errorCode: 'processing-failed' });
  expect((await db.doc(slidePath).get()).data()).toEqual(sourceSlide());
  expect((await db.doc('quizzes/' + target.quizId).get()).data()?.revision).toBe(7);
  expect((await db.doc(`quizzes/${target.quizId}/mediaAssets/${assetId}`).get()).data()).toEqual({ sentinel: 'retained-existing-immutable-asset' });
  expect((await db.collection('accessAudit').get()).empty).toBe(true);
});

test('real source edit and membership revocation during processing cannot attach late output', async () => {
  const f = fixture(), location = await f.enqueue();
  f.prepare.mockImplementationOnce(async () => {
    await db.doc(slidePath).update({ clipEndSeconds: 24 });
    return { bytes: Buffer.from('synthetic-video'), contentType: 'video/mp4', durationSeconds: 13 };
  });
  expect(await f.service.run(location)).toEqual({ jobId: location.jobId, status: 'stale', errorCode: 'source-changed' });
  expect(f.upload).not.toHaveBeenCalled(); expect((await db.doc(slidePath).get()).data()?.clipEndSeconds).toBe(24);
  const second = await f.enqueue();
  f.prepare.mockImplementationOnce(async () => {
    await db.doc('memberships/' + ownerUid).update({ status: 'suspended', version: 2 });
    return { bytes: Buffer.from('synthetic-video'), contentType: 'video/mp4', durationSeconds: 14 };
  });
  await expect(f.service.run(second)).rejects.toMatchObject({ code: 'permission-denied' });
  expect((await db.collection(`quizzes/${target.quizId}/mediaAssets`).get()).empty).toBe(true);
  expect((await db.doc('quizzes/' + target.quizId).get()).data()?.revision).toBe(7);
});

test('real source authorization uses current permission/scope and ignores owner role label without grants', async () => {
  const f = fixture();
  await db.doc('memberships/' + ownerUid).update({ permissions: ['users.manage'] });
  await expect(f.service.request(target)).rejects.toMatchObject({ code: 'permission-denied' });
  await db.doc('memberships/' + ownerUid).update({ permissions: [...rolePresets.owner], quizzes: { mode: 'selected', ids: ['other'] } });
  await expect(f.service.request(target)).rejects.toMatchObject({ code: 'permission-denied' });
  expect((await db.collection('driveMediaJobs').get()).empty).toBe(true);
});

test('job/source provenance remains denied to every browser role including active owner', async () => {
  const f = fixture(), location = await f.enqueue(); await f.service.run(location);
  const jobPath = 'driveMediaJobs/' + location.jobId;
  for (const identity of ['anonymous', ownerUid, 'legacy-admin']) {
    const client = identity === 'anonymous' ? environment.unauthenticatedContext().firestore()
      : environment.authenticatedContext(identity, { role: 'owner', email_verified: true, auth_time: 2_000_000_000 }).firestore();
    await assertFails(getDoc(doc(client, jobPath)));
    await assertFails(getDocs(collection(client, 'driveMediaJobs')));
    await assertFails(updateDoc(doc(client, jobPath), { status: 'ready' }));
    await assertFails(deleteDoc(doc(client, jobPath)));
    await assertFails(setDoc(doc(client, 'driveMediaJobs/forged'), { ownerUid: identity }));
  }
});
