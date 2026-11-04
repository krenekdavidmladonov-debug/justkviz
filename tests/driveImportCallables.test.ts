import { createHash } from 'node:crypto';
import { mkdtemp, open, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Membership } from '../packages/quiz-domain/src/access';
import type { DriveImportSource } from '../functions/src/drive/import-model';
import type { DriveFileUpload } from '../functions/src/drive/files';
import type { DriveAccess, DriveAccessBinding } from '../functions/src/drive/runtime';
import type { PreparedDriveMedia } from '../functions/src/drive/imports';
import * as imageTransport from '../functions/src/drive/images';

interface State {
  records: Record<string, Record<string, unknown>>;
  writes: string[];
  auth: { uid: string; token: { email_verified: boolean; auth_time: number; role: string } } | undefined;
  user: { uid: string; emailVerified: boolean; disabled: boolean; tokensValidAfterTime?: string } | undefined;
  beforeTransaction?: () => void;
  now: number;
  prepare: ReturnType<typeof vi.fn<(source: DriveImportSource) => Promise<PreparedDriveMedia>>>;
  enqueue: ReturnType<typeof vi.fn<(data: unknown, options: unknown) => Promise<void>>>;
  queue: ReturnType<typeof vi.fn<(name: string) => { enqueue: State['enqueue'] }>>;
  bindings: DriveAccessBinding[];
  uploads: DriveFileUpload[];
  files: Map<string, string>;
}
const state = vi.hoisted((): State => ({ records: {}, writes: [], auth: undefined, user: undefined, now: 1_800_000_000_000,
  prepare: vi.fn(), enqueue: vi.fn(), queue: vi.fn(), bindings: [], uploads: [], files: new Map() }));
interface Ref {
  path: string;
  id: string;
  get(): Promise<{ data(): Record<string, unknown> | undefined; exists: boolean }>;
  collection(name: string): { doc(id?: string): Ref };
}
function document(path: string): Ref {
  return { path, id: path.split('/').at(-1)!, get: () => Promise.resolve({ exists: state.records[path] !== undefined,
    data: () => structuredClone(state.records[path]) }), collection: name => ({ doc: id => document(path + '/' + name + '/' + (id ?? 'synthetic-audit')) }) };
}
let serialized: Promise<unknown> = Promise.resolve();
const database = { doc: document, collection: (name: string) => ({ doc: (id = 'synthetic-audit') => document(name + '/' + id) }),
  runTransaction: <T>(handler: (tx: unknown) => Promise<T>) => {
    const operation = serialized.then(async () => {
      state.beforeTransaction?.();
      const pending: { ref: Ref; value: Record<string, unknown>; kind: 'set' | 'create' | 'update' }[] = [];
      const result = await handler({ get: (ref: Ref) => ref.get(), getAll: (...refs: Ref[]) => Promise.all(refs.map(ref => ref.get())),
        set: (ref: Ref, value: Record<string, unknown>) => { pending.push({ ref, value, kind: 'set' }); },
        create: (ref: Ref, value: Record<string, unknown>) => { if (state.records[ref.path]) throw new Error('Immutable create conflict'); pending.push({ ref, value, kind: 'create' }); },
        update: (ref: Ref, value: Record<string, unknown>) => { if (!state.records[ref.path]) throw new Error('Missing update target'); pending.push({ ref, value, kind: 'update' }); },
      });
      for (const { ref, value, kind } of pending) {
        state.records[ref.path] = structuredClone(kind === 'update' ? { ...state.records[ref.path], ...value } : value);
        state.writes.push(ref.path);
      }
      return result;
    });
    serialized = operation.then(() => undefined, () => undefined);
    return operation;
  },
};
vi.mock('../functions/node_modules/firebase-admin/lib/esm/firestore/index.js', async () => ({
  getFirestore: () => database, Timestamp: (await import('firebase/firestore')).Timestamp,
}));
vi.mock('../functions/node_modules/firebase-admin/lib/esm/auth/index.js', () => ({ getAuth: () => ({ getUser: () =>
  state.user ? Promise.resolve(state.user) : Promise.reject(new Error('No synthetic account')) }) }));
vi.mock('../functions/node_modules/firebase-admin/lib/esm/functions/index.js', () => ({ getFunctions: () => ({ taskQueue: state.queue }) }));
vi.mock('../functions/src/drive/processor', () => ({ driveImportProcessor: { prepare: state.prepare } }));
vi.mock('../functions/src/drive/runtime', () => ({ driveRuntimeSecrets: [],
  withDriveAccess: <T>(binding: DriveAccessBinding, handler: (access: DriveAccess) => Promise<T>) => {
    state.bindings.push(binding);
    return handler({ accessToken: 'private-access', account: { email: 'owner@gmail.com', permissionId: 'account_permission' },
      folder: { id: 'private_folder', name: 'Private', url: 'https://drive.google.com/drive/folders/private_folder' }, assertCurrent: () => Promise.resolve(),
      files: { generateId: () => Promise.resolve('generated_file'), verify: () => Promise.reject(new Error('unused')),
        download: () => Promise.reject(new Error('unused')), upload: (_token, input) => {
          state.uploads.push(input);
          const sha256 = createHash('sha256').update(input.bytes).digest('hex');
          if (state.files.has(input.id) && state.files.get(input.id) !== sha256) return Promise.reject(new Error('Immutable bytes mismatch'));
          state.files.set(input.id, sha256);
          return Promise.resolve({ id: input.id, folderId: input.folderId, mimeType: input.mimeType, size: input.bytes.length,
            sha256, md5Checksum: createHash('md5').update(input.bytes).digest('hex') });
        } },
    });
  },
}));
const { requestDriveMediaImport, readDriveMediaImport, processDriveMediaImport } = await import('../functions/src/drive/import-callables');
const { beginQuizMediaUpload } = await import('../functions/src/media/callables');
const target = { quizId: 'quiz', slideId: 'slide', field: 'mediaSource' as const };
const permissions = ['users.manage', 'quiz.media.upload', 'quiz.media.attach', 'quiz.edit', 'quiz.read', 'quiz.answers.read'] as const;
function owner(patch: Partial<Membership> = {}): void {
  const member: Membership = { uid: 'owner', status: 'active', role: 'owner', version: 1, sessionValidAfter: 0,
    permissions: [...permissions], quizzes: { mode: 'selected', ids: ['quiz'] }, events: { mode: 'none', ids: [] },
    displayName: 'Synthetic owner', email: 'owner@gmail.com', ...patch };
  state.records['memberships/owner'] = member as unknown as Record<string, unknown>;
}
function reset(): void {
  state.now = 1_800_000_000_000; state.writes = []; state.bindings = []; state.uploads = []; state.files = new Map(); state.beforeTransaction = undefined;
  state.auth = { uid: 'owner', token: { email_verified: true, auth_time: state.now / 1000, role: 'admin' } };
  state.user = { uid: 'owner', emailVerified: true, disabled: false };
  state.records = { 'quizzes/quiz': { revision: 7, disposition: 'active', createdBy: 'owner' },
    'quizzes/quiz/slides/slide': { kind: 'video', position: 1, isQuestion: true, roundId: 'round',
      mediaSource: 'https://www.youtube.com/watch?v=abcdefghijk', clipStartSeconds: 10, clipEndSeconds: 23,
      correctAnswer: 'PRIVATE_ANSWER', moderatorNote: 'PRIVATE_NOTE', legacy: { raw: 'PRIVATE_RAW' } },
    'quizzes/quiz/rounds/round/questions/slide': { correctAnswer: 'PRIVATE_ANSWER', kind: 'video', privateExtension: 'RETAINED' },
    'driveConnections/owner': { revision: 3, generation: 2, account: { email: 'owner@gmail.com', permissionId: 'account_permission' },
      folder: { id: 'private_folder', name: 'Private', url: 'https://drive.google.com/drive/folders/private_folder' }, refreshToken: { synthetic: 'encrypted' } } };
  owner(); serialized = Promise.resolve();
  state.enqueue.mockReset().mockResolvedValue(); state.queue.mockReset().mockReturnValue({ enqueue: state.enqueue });
  state.prepare.mockReset().mockImplementation(source => Promise.resolve({ bytes: Buffer.from('synthetic media'),
    contentType: source.kind === 'video' ? 'video/mp4' : source.kind === 'audio' ? 'audio/mpeg' : 'image/png',
    ...(source.type === 'youtube' ? { durationSeconds: source.endSeconds - source.startSeconds } : {}) }));
}
beforeEach(() => {
  reset();
  vi.stubEnv('GCLOUD_PROJECT', 'filmovy-kviz-v2-staging'); vi.stubEnv('GOOGLE_CLOUD_PROJECT', undefined);
  for (const key of ['FUNCTIONS_EMULATOR', 'FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST']) vi.stubEnv(key, undefined);
  vi.stubEnv('DRIVE_CONNECTION_ENABLED', 'true'); vi.stubEnv('DRIVE_MEDIA_ENABLED', 'true');
  vi.spyOn(Date, 'now').mockImplementation(() => state.now);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
const request = (data: unknown = target) => requestDriveMediaImport.run({ data, auth: state.auth } as Parameters<typeof requestDriveMediaImport.run>[0]);
const read = (jobId: string, data: unknown = { ...target, jobId }) => readDriveMediaImport.run({ data, auth: state.auth } as Parameters<typeof readDriveMediaImport.run>[0]);
const worker = (data: unknown) => processDriveMediaImport.run({ data } as Parameters<typeof processDriveMediaImport.run>[0]);
const jobs = () => Object.entries(state.records).filter(([path]) => path.startsWith('driveMediaJobs/'));

test('all import entrypoints fail closed for disabled flags, foreign/demo projects and every emulator signal without IO', async () => {
  for (const [key, value] of [['DRIVE_CONNECTION_ENABLED', 'false'], ['DRIVE_MEDIA_ENABLED', 'false'], ['GCLOUD_PROJECT', 'demo-filmovy-kviz-v2'],
    ['GCLOUD_PROJECT', 'foreign-project'], ['FUNCTIONS_EMULATOR', 'true'], ['FIRESTORE_EMULATOR_HOST', '127.0.0.1:8080'],
    ['FIREBASE_AUTH_EMULATOR_HOST', '127.0.0.1:9099'], ['FIREBASE_STORAGE_EMULATOR_HOST', '127.0.0.1:9199']]) {
    const original = process.env[key!]; vi.stubEnv(key!, value);
    for (const operation of [() => request(), () => read('a'.repeat(64)), () => worker({ ownerUid: 'owner', ...target, jobId: 'a'.repeat(64) })]) {
      await expect(operation()).rejects.toThrow();
    }
    expect(state.writes).toEqual([]); expect(state.queue).not.toHaveBeenCalled(); expect(state.prepare).not.toHaveBeenCalled(); expect(state.bindings).toEqual([]);
    vi.stubEnv(key!, original);
  }
});

test('request/read require current verified owner, every concrete permission and quiz scope before queue or provider IO', async () => {
  const cases = [() => { state.auth = undefined; }, () => { state.user = undefined; }, () => { state.user!.disabled = true; },
    () => { state.user!.emailVerified = false; }, () => { state.auth!.token.email_verified = false; },
    () => { state.user!.tokensValidAfterTime = new Date(state.now + 1000).toISOString(); }, () => { delete state.records['memberships/owner']; },
    () => owner({ status: 'suspended' }), () => owner({ role: 'manager' }), () => owner({ uid: 'other' }),
    () => owner({ sessionValidAfter: state.now / 1000 }), () => owner({ permissions: [] }),
    ...permissions.map(permission => () => owner({ permissions: permissions.filter(value => value !== permission) })),
    () => owner({ quizzes: { mode: 'none', ids: [] } }), () => owner({ quizzes: { mode: 'selected', ids: ['other'] } }),
    () => { owner({ quizzes: { mode: 'own', ids: [] } }); state.records['quizzes/quiz']!.createdBy = 'other'; }];
  for (const change of cases) for (const operation of [() => request(), () => read('a'.repeat(64))]) {
    reset(); change(); await expect(operation()).rejects.toThrow();
    expect(state.writes).toEqual([]); expect(state.queue).not.toHaveBeenCalled(); expect(state.prepare).not.toHaveBeenCalled(); expect(state.bindings).toEqual([]);
  }
});

test('browser input cannot select source, credentials, owner, output file, callback URL or execution payload', async () => {
  for (const patch of [{ ownerUid: 'other' }, { source: 'https://evil.invalid/' }, { accessToken: 'private' }, { folderId: 'other_folder' },
    { fileId: 'other_file' }, { startSeconds: 0 }, { callbackUrl: 'https://evil.invalid/' }, { field: 'correctAnswer' }]) {
    await expect(request({ ...target, ...patch })).rejects.toMatchObject({ code: 'invalid-argument' });
  }
  await expect(worker({ ownerUid: 'owner', ...target, jobId: 'a'.repeat(64), source: 'https://evil.invalid/' })).rejects.toThrow();
  expect(state.writes).toEqual([]); expect(state.queue).not.toHaveBeenCalled(); expect(state.prepare).not.toHaveBeenCalled();
});

test('an enqueue failure leaves one deterministic retryable job and the same exact locator is enqueued on retry', async () => {
  state.enqueue.mockRejectedValueOnce(new Error('PRIVATE QUEUE RESPONSE'));
  await expect(request()).rejects.toThrow('Přípravu média se nepodařilo spustit. Zkuste ji znovu.');
  expect(jobs()).toHaveLength(1);
  const jobId = jobs()[0]![1].jobId as string;
  await expect(request()).resolves.toEqual({ jobId, status: 'queued' }); expect(jobs()).toHaveLength(1);
  expect(state.queue).toHaveBeenCalledWith('locations/europe-west1/functions/processDriveMediaImport');
  expect(state.enqueue.mock.calls.map(call => call[0])).toEqual([{ ownerUid: 'owner', ...target, jobId }, { ownerUid: 'owner', ...target, jobId }]);
  expect(state.enqueue.mock.calls[1]?.[1]).toEqual({ dispatchDeadlineSeconds: 540 });
  expect(state.prepare).not.toHaveBeenCalled(); expect(state.bindings).toEqual([]);
  expect(await read(jobId)).toEqual({ jobId, status: 'queued' });
});

test('local YouTube requests avoid Cloud Tasks and an old cloud task cannot download the source after activation', async () => {
  vi.stubEnv('DRIVE_MEDIA_LOCAL_ENABLED', 'true');
  const status = await request();
  expect(status).toMatchObject({ status: 'queued', execution: 'local' });
  expect(state.queue).not.toHaveBeenCalled();
  await worker({ ownerUid: 'owner', ...target, jobId: status.jobId });
  expect(state.prepare).not.toHaveBeenCalled();
  expect(state.uploads).toHaveLength(0);
  expect(state.records['driveMediaJobs/' + status.jobId]?.status).toBe('queued');
  expect(state.records['quizzes/quiz/slides/slide']?.mediaSource).toContain('youtube.com');
});

test('new photo imports are rejected before queue/provider work while retaining their original URL', async () => {
  vi.stubEnv('DRIVE_MEDIA_LOCAL_ENABLED', 'true');
  state.records['quizzes/quiz/slides/slide']!.questionImage = 'https://example.test/photo.png';
  const photo = { ...target, field: 'questionImage' };
  await expect(request(photo)).rejects.toMatchObject({ code: 'failed-precondition' });
  expect(state.queue).not.toHaveBeenCalled();
  expect(state.uploads).toHaveLength(0);
  expect(state.records['quizzes/quiz/slides/slide']!.questionImage).toBe('https://example.test/photo.png');
});

test('private worker persists one asset/attachment, requests exact runtime binding and ready retries perform no provider work', async () => {
  const status = await request(), task = { ownerUid: 'owner', ...target, jobId: status.jobId };
  await worker(task);
  expect(state.prepare).toHaveBeenCalledExactlyOnceWith({ type: 'youtube', kind: 'video', videoId: 'abcdefghijk', startSeconds: 10, endSeconds: 23 }, { ...target, jobId: status.jobId });
  expect(state.uploads).toHaveLength(1); expect(state.uploads[0]?.id).toBe('generated_file');
  expect(state.bindings).toEqual(Array.from({ length: 2 }, () => ({ ownerUid: 'owner', quizId: 'quiz', connectionGeneration: 2,
    accountPermissionId: 'account_permission', folderId: 'private_folder' })));
  const assets = Object.keys(state.records).filter(path => path.startsWith('quizzes/quiz/mediaAssets/')); expect(assets).toHaveLength(1);
  expect(state.records[assets[0]!]!.drive).toMatchObject({ ownerUid: 'owner', accountPermissionId: 'account_permission', connectionGeneration: 2 });
  const slide = state.records['quizzes/quiz/slides/slide']!;
  expect(slide).toMatchObject({ clipStartSeconds: 0, clipEndSeconds: 13, correctAnswer: 'PRIVATE_ANSWER', moderatorNote: 'PRIVATE_NOTE', legacy: { raw: 'PRIVATE_RAW' } });
  expect(state.records['quizzes/quiz/rounds/round/questions/slide']).toMatchObject({ correctAnswer: 'PRIVATE_ANSWER', privateExtension: 'RETAINED' });
  const output = await read(status.jobId); expect(output.status).toBe('ready');
  expect(JSON.stringify(output)).not.toMatch(/PRIVATE_|private-access|folder|videoId|sourceFingerprint|permission/u);
  await worker(task); await expect(request()).resolves.toEqual(output);
  expect(state.prepare).toHaveBeenCalledTimes(1); expect(state.uploads).toHaveLength(1); expect(state.enqueue).toHaveBeenCalledTimes(1);
  expect(state.records['quizzes/quiz']!.revision).toBe(8);
});

test('active worker lease returns retry instead of acknowledging unfinished work; an expired lease is recoverable', async () => {
  const status = await request(), path = 'driveMediaJobs/' + status.jobId;
  state.records[path] = { ...state.records[path], status: 'processing', lease: { id: 'active_lease', expiresAt: state.now + 10_000 }, attempt: 1 };
  const task = { ownerUid: 'owner', ...target, jobId: status.jobId };
  await expect(worker(task)).rejects.toThrow('Media processing needs a retry.');
  expect(state.prepare).not.toHaveBeenCalled(); expect(state.uploads).toHaveLength(0);
  state.now += 10_001; await worker(task);
  expect(state.records[path].status).toBe('ready'); expect(state.records[path].attempt).toBe(2); expect(state.uploads).toHaveLength(1);
});

test('transient worker failure is safely recorded and retried; stale source is terminal and never queues file upload', async () => {
  const status = await request(), task = { ownerUid: 'owner', ...target, jobId: status.jobId };
  state.prepare.mockRejectedValueOnce(new Error('PRIVATE PROCESSOR RESPONSE'));
  await expect(worker(task)).rejects.toThrow('Media processing needs a retry.');
  expect(await read(status.jobId)).toEqual({ jobId: status.jobId, status: 'failed', errorCode: 'processing-failed' });
  expect(JSON.stringify(state.records['driveMediaJobs/' + status.jobId])).not.toContain('PRIVATE PROCESSOR RESPONSE');
  await worker(task); expect((await read(status.jobId)).status).toBe('ready');
  reset(); const next = await request(); state.records['quizzes/quiz/slides/slide']!.clipEndSeconds = 24;
  await worker({ ownerUid: 'owner', ...target, jobId: next.jobId });
  expect(await read(next.jobId)).toEqual({ jobId: next.jobId, status: 'stale', errorCode: 'source-changed' });
  expect(state.prepare).not.toHaveBeenCalled(); expect(state.uploads).toHaveLength(0);
});

test('transaction and worker recheck fresh current identity and permissions even after callable invocation/queueing', async () => {
  state.beforeTransaction = () => { owner({ status: 'suspended' }); };
  await expect(request()).rejects.toMatchObject({ code: 'permission-denied' }); expect(jobs()).toHaveLength(0);
  reset(); const status = await request(); owner({ permissions: ['quiz.read'] });
  await expect(worker({ ownerUid: 'owner', ...target, jobId: status.jobId })).rejects.toMatchObject({ code: 'permission-denied' });
  expect(state.prepare).not.toHaveBeenCalled(); expect(state.bindings).toEqual([]);
  reset(); const fresh = await request(); state.user!.disabled = true;
  await expect(worker({ ownerUid: 'owner', ...target, jobId: fresh.jobId })).rejects.toMatchObject({ code: 'permission-denied' });
  expect(state.prepare).not.toHaveBeenCalled();
});

test('worker trigger stays private with bounded retry and dispatch limits; callables bind no credentials', () => {
  expect(processDriveMediaImport.__endpoint.taskQueueTrigger).toMatchObject({ invoker: ['private'],
    retryConfig: { maxAttempts: 3, minBackoffSeconds: 60, maxBackoffSeconds: 120 }, rateLimits: { maxConcurrentDispatches: 2, maxDispatchesPerSecond: 1 } });
  expect(requestDriveMediaImport.__endpoint.secretEnvironmentVariables ?? []).toEqual([]);
  expect(readDriveMediaImport.__endpoint.secretEnvironmentVariables ?? []).toEqual([]);
});

test('direct browser Storage upload still rejects video even though ready Drive video is supported by the shared model', async () => {
  const upload = { auth: state.auth, data: { quizId: 'quiz', requestId: 'browser-video', kind: 'video', contentType: 'video/mp4', size: 1024 } };
  await expect(beginQuizMediaUpload.run(upload as Parameters<typeof beginQuizMediaUpload.run>[0])).rejects.toMatchObject({ code: 'invalid-argument' });
  expect(state.writes).toEqual([]); expect(state.uploads).toHaveLength(0);
});

async function cleanupSyntheticDirectory(directory: string): Promise<void> {
  const resolved = await realpath(directory), parent = await realpath(tmpdir());
  if (dirname(resolved) !== parent || !basename(resolved).startsWith('drive-clip-unit-')) throw new Error('Unsafe synthetic cleanup target');
  await rm(resolved, { recursive: true, force: true });
}
test('processor rejects every mixed emulator signal before source IO and bounded clip reads reject oversized metadata', async () => {
  const actual = await vi.importActual<typeof import('../functions/src/drive/processor')>('../functions/src/drive/processor');
  const fetchImage = vi.spyOn(imageTransport, 'fetchPrivateImage').mockRejectedValue(new Error('Unexpected source IO'));
  for (const key of ['FUNCTIONS_EMULATOR', 'FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST']) {
    vi.stubEnv(key, '127.0.0.1:9999');
    await expect(actual.driveImportProcessor.prepare({ type: 'https-image', kind: 'image', url: 'https://images.example.com/a.png' }, target)).rejects.toThrow();
    vi.stubEnv(key, undefined);
  }
  expect(fetchImage).not.toHaveBeenCalled();
  const directory = await mkdtemp(join(tmpdir(), 'drive-clip-unit-'));
  try {
    const clip = join(directory, 'synthetic.bin'); await writeFile(clip, Buffer.from('synthetic bytes'));
    await expect(actual.readBoundedClip(clip)).resolves.toEqual(Buffer.from('synthetic bytes'));
    const handle = await open(clip, 'r+'); await handle.truncate(25 * 1024 * 1024 + 1); await handle.close();
    await expect(actual.readBoundedClip(clip)).rejects.toThrow('OUTPUT_INVALID');
    await writeFile(clip, Buffer.alloc(0)); await expect(actual.readBoundedClip(clip)).rejects.toThrow('OUTPUT_INVALID');
  } finally { await cleanupSyntheticDirectory(directory); }
});

test('processor diagnostics expose only fixed stage and worker labels, never thrown messages or extension fields', async () => {
  const actual = await vi.importActual<typeof import('../functions/src/drive/processor')>('../functions/src/drive/processor');
  expect(actual.safeClipFailure(Object.assign(new Error('https://secret.invalid/?token=secret /private/path'), {
    name: 'ClipError', code: 'process-failed', phase: 'download-video', tool: 'ytDlp',
    diagnosticCode: 'provider-sign-in-required', stderr: 'secret', videoId: 'private-id', cause: new Error('secret'),
  }), 'clip')).toEqual({ stage: 'clip', code: 'process-failed', phase: 'download-video', tool: 'ytDlp', diagnosticCode: 'provider-sign-in-required' });
  expect(actual.safeClipFailure({ name: 'ClipError', code: 'https://secret.invalid', phase: '/private/path',
    tool: 'secret', diagnosticCode: 'secret' }, 'clip')).toEqual({ stage: 'clip' });
  expect(actual.safeClipFailure(new Error('secret'), 'worker-load')).toEqual({ stage: 'worker-load' });
  expect(actual.safeClipFailure(null, 'output-read')).toEqual({ stage: 'output-read' });
});
