import { createHash } from 'node:crypto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { rolePresets, type Membership } from '../packages/quiz-domain/src/access';
import { DriveImportService } from '../functions/src/drive/imports';
import { firestoreDriveImportStore } from '../functions/src/drive/import-store';
import { companionHandler, configureLocalCompanion, localCompanionRuntimePorts, type CompanionPorts } from '../functions/src/drive/local-companion';
import { localHash, parseLocalToken, type LocalDevice } from '../functions/src/drive/local-device';
import { localProbeDuration, maximumLocalOutput, validateLocalOutput } from '../functions/src/drive/local-output';
import { withDriveAccess } from '../functions/src/drive/runtime';

type StoreDependencies = NonNullable<Parameters<typeof firestoreDriveImportStore>[0]>;
type Firestore = NonNullable<StoreDependencies['db']>;
type Auth = NonNullable<StoreDependencies['auth']>;
const runtime = vi.hoisted(() => ({ db: {} as Firestore, auth: {} as Auth }));
vi.mock('../functions/node_modules/firebase-admin/lib/esm/firestore/index.js', async () => ({ getFirestore: () => runtime.db, Timestamp: (await import('firebase/firestore')).Timestamp }));
vi.mock('../functions/node_modules/firebase-admin/lib/esm/auth/index.js', () => ({ getAuth: () => runtime.auth }));
vi.mock('../functions/src/drive/runtime', async original => ({ ...await original<typeof import('../functions/src/drive/runtime')>(), withDriveAccess: vi.fn() }));
vi.mock('../functions/src/drive/local-output', async original => ({ ...await original<typeof import('../functions/src/drive/local-output')>(), validateLocalOutput: vi.fn() }));

const now = 2_000_000, quizTarget = { quizId: 'quiz', slideId: 'slide', field: 'mediaSource' as const };
const authIdentity = { uid: 'owner', token: { email_verified: true, auth_time: 1000 } } as Parameters<typeof configureLocalCompanion>[0];
const sha = (algorithm: string, bytes: Uint8Array) => createHash(algorithm).update(bytes).digest('hex');
const source = { type: 'youtube' as const, kind: 'video' as const, videoId: 'abcdefghijk', startSeconds: 10, endSeconds: 23 };

function fixture() {
  const member: Membership = { uid: 'owner', role: 'owner', status: 'active', version: 1, sessionValidAfter: 0,
    displayName: 'Synthetic', email: 'owner@example.invalid', permissions: [...rolePresets.owner], quizzes: { mode: 'all', ids: [] }, events: { mode: 'none', ids: [] } };
  const user = { uid: 'owner', emailVerified: true, disabled: false, tokensValidAfterTime: new Date(0).toUTCString() };
  const records = new Map<string, Record<string, unknown>>([
    ['memberships/owner', member as unknown as Record<string, unknown>],
    ['driveConnections/owner', { revision: 3, generation: 2, account: { permissionId: 'private_account', email: 'owner@example.invalid' },
      folder: { id: 'private_folder' }, refreshToken: { ciphertext: 'synthetic-envelope' } }],
    ['quizzes/quiz', { revision: 1, createdBy: 'owner', slideCount: 1, roundCount: 0, questionCount: 1 }],
    ['quizzes/quiz/slides/slide', { kind: 'video', position: 1, isQuestion: true, mediaSource: 'https://youtu.be/abcdefghijk', clipStartSeconds: 10, clipEndSeconds: 23,
      correctAnswer: 'PRIVATE_ANSWER', moderatorNote: 'PRIVATE_NOTE' }],
  ]);
  let generated = 0, serial: Promise<unknown> = Promise.resolve();
  interface Ref { path: string; collection(name: string): { doc(id?: string): Ref } }
  const doc = (path: string): Ref => ({ path, collection: name => ({ doc: (id = 'generated' + (++generated)) => doc(path + '/' + name + '/' + id) }) });
  const collection = (path: string, conditions: [string, unknown][] = [], maximum = Infinity) => ({
    doc: (id = 'generated' + (++generated)) => doc(path + '/' + id),
    where: (key: string, _operator: string, value: unknown) => collection(path, [...conditions, [key, value]], maximum),
    limit: (limit: number) => collection(path, conditions, limit),
    get: () => Promise.resolve({ docs: [...records.entries()].filter(([key, value]) => key.startsWith(path + '/')
      && key.split('/').length === path.split('/').length + 1 && conditions.every(([field, expected]) => value[field] === expected))
      .slice(0, maximum).map(([, value]) => ({ data: () => structuredClone(value) })) }),
  });
  const db = { doc, collection, runTransaction: <T>(handler: (tx: unknown) => Promise<T>): Promise<T> => {
    const operation = serial.then(async () => {
      const changes: { ref: Ref; value: Record<string, unknown>; merge: boolean }[] = [];
      const read = (ref: Ref) => { expect(changes).toHaveLength(0); return { data: () => structuredClone(records.get(ref.path)) }; };
      const result = await handler({ get: (ref: Ref) => Promise.resolve(read(ref)), getAll: (...refs: Ref[]) => Promise.resolve(refs.map(read)),
        set: (ref: Ref, value: Record<string, unknown>) => { changes.push({ ref, value, merge: false }); },
        create: (ref: Ref, value: Record<string, unknown>) => { expect(records.has(ref.path)).toBe(false); changes.push({ ref, value, merge: false }); },
        update: (ref: Ref, value: Record<string, unknown>) => { expect(records.has(ref.path)).toBe(true); changes.push({ ref, value, merge: true }); },
      });
      for (const change of changes) records.set(change.ref.path, structuredClone(change.merge ? { ...records.get(change.ref.path), ...change.value } : change.value));
      return result;
    });
    serial = operation.catch(() => undefined); return operation;
  } };
  runtime.db = db as unknown as Firestore;
  runtime.auth = { getUser: vi.fn(() => Promise.resolve(user)) } as unknown as Auth;
  const upload = vi.fn((_token: string, input: { id: string; folderId: string; mimeType: string; bytes: Uint8Array }) => Promise.resolve({ id: input.id, folderId: input.folderId,
    mimeType: input.mimeType, size: input.bytes.length, sha256: sha('sha256', input.bytes), md5Checksum: sha('md5', input.bytes) }));
  vi.mocked(withDriveAccess).mockImplementation(async (_binding, action) => action({ accessToken: 'synthetic-access', account: { permissionId: 'private_account', email: 'owner@example.invalid' },
    folder: { id: 'private_folder', name: 'Synthetic', url: 'https://drive.google.com/drive/folders/private_folder' },
    files: { generateId: () => Promise.resolve('private_file'), upload } as unknown as Parameters<Parameters<typeof withDriveAccess>[1]>[0]['files'], assertCurrent: () => Promise.resolve() }));
  vi.mocked(validateLocalOutput).mockImplementation((_source, bytes) => Promise.resolve({ bytes, contentType: 'video/mp4', durationSeconds: 13 }));
  const service = new DriveImportService('owner', firestoreDriveImportStore(), { prepare: () => { throw new Error('cloud processor forbidden'); } },
    { generateId: () => Promise.reject(new Error('unused')), upload: () => Promise.reject(new Error('unused')) });
  const pair = async () => {
    const prepared = await configureLocalCompanion(authIdentity, 'pair');
    expect(prepared.pairingCode).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    return localCompanionRuntimePorts.pair(prepared.pairingCode!);
  };
  const queue = async () => service.request(quizTarget, 'local');
  const device = (id: string) => records.get('driveMediaCompanions/' + id) as unknown as LocalDevice;
  return { records, user, member, service, pair, queue, device, upload };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); vi.stubEnv('GCLOUD_PROJECT', 'demo-companion'); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

test('pairing exchange is single-use, stores verifiers only, and re-pair/revoke invalidates old device tokens', async () => {
  const f = fixture(), pending = await configureLocalCompanion(authIdentity, 'pair'), code = pending.pairingCode!;
  const paired = await localCompanionRuntimePorts.pair(code);
  expect(parseLocalToken(paired.token).deviceId).toBe(paired.deviceId);
  expect(JSON.stringify([...f.records.values()])).not.toContain(paired.token);
  expect(f.device(paired.deviceId).tokenHash).toBe(localHash(paired.token));
  await expect(localCompanionRuntimePorts.pair(code)).rejects.toMatchObject({ code: 'permission-denied' });
  await configureLocalCompanion(authIdentity, 'revoke');
  const audit = [...f.records.entries()].filter(([key]) => key.startsWith('accessAudit/')).map(([, value]) => value);
  expect(audit.map(value => value.kind)).toEqual(['drive-companion-pair-begin', 'drive-companion-pair-complete', 'drive-companion-revoked']);
  expect(audit.every(value => Object.keys(value).sort().join(',') === 'actorUid,at,kind' && value.actorUid === 'owner')).toBe(true);
  expect(JSON.stringify(audit)).not.toContain(code); expect(JSON.stringify(audit)).not.toContain(paired.token);
  await expect(localCompanionRuntimePorts.claim(paired.token)).rejects.toMatchObject({ code: 'permission-denied' });
  const next = await f.pair(); expect(next.deviceId).toBe(paired.deviceId); expect(next.token).not.toBe(paired.token);
  await expect(localCompanionRuntimePorts.claim(paired.token)).rejects.toMatchObject({ code: 'permission-denied' });
});

test('pairing fails after expiry, membership/Auth revocation, permission removal or Drive connection change', async () => {
  for (const change of ['expiry', 'membership', 'session', 'auth', 'connection', 'permission', 'unverified'] as const) {
    vi.setSystemTime(now); const f = fixture(), pending = await configureLocalCompanion(authIdentity, 'pair');
    if (change === 'expiry') vi.setSystemTime(now + 300_001);
    if (change === 'membership') f.records.get('memberships/owner')!.version = 2;
    if (change === 'session') f.records.get('memberships/owner')!.sessionValidAfter = 1;
    if (change === 'auth') f.user.tokensValidAfterTime = new Date(1000).toUTCString();
    if (change === 'connection') f.records.get('driveConnections/owner')!.revision = 4;
    if (change === 'permission') f.records.get('memberships/owner')!.permissions = ['users.manage'];
    if (change === 'unverified') f.user.emailVerified = false;
    await expect(localCompanionRuntimePorts.pair(pending.pairingCode!)).rejects.toMatchObject({ code: 'permission-denied' });
  }
});

test('concurrent claims have one winner and completion attaches only bounded validated bytes through existing private Drive transport', async () => {
  const f = fixture(), paired = await f.pair(), queued = await f.queue();
  const claims = await Promise.allSettled([localCompanionRuntimePorts.claim(paired.token), localCompanionRuntimePorts.claim(paired.token)]);
  const jobs = claims.flatMap(result => result.status === 'fulfilled' && result.value.job ? [result.value.job] : []);
  expect(jobs).toHaveLength(1); const job = jobs[0]!;
  expect(job).toMatchObject({ ...quizTarget, jobId: queued.jobId, source });
  expect(JSON.stringify(job)).not.toMatch(/PRIVATE_|private_folder|private_account|token/iu);
  await expect(f.service.run({ ...quizTarget, jobId: queued.jobId })).rejects.toMatchObject({ code: 'failed-precondition' });
  const bytes = Buffer.from('synthetic validated clip');
  const ready = await localCompanionRuntimePorts.complete(paired.token, job.jobId, job.leaseId, bytes);
  expect(ready).toMatchObject({ status: 'ready', execution: 'local' }); expect(f.upload).toHaveBeenCalledOnce();
  expect(f.records.get('quizzes/quiz/slides/slide')).toMatchObject({ mediaSource: ready.reference, clipStartSeconds: 0, clipEndSeconds: 13, correctAnswer: 'PRIVATE_ANSWER', moderatorNote: 'PRIVATE_NOTE' });
  expect(f.records.get('quizzes/quiz')!.revision).toBe(2);
  expect(f.device(paired.deviceId).activeJob).toBeNull();
  vi.mocked(validateLocalOutput).mockClear();
  expect((await localCompanionRuntimePorts.complete(paired.token, job.jobId, job.leaseId, bytes)).status).toBe('ready');
  expect(validateLocalOutput).not.toHaveBeenCalled(); expect(f.upload).toHaveBeenCalledOnce();
  await expect(localCompanionRuntimePorts.complete(paired.token, job.jobId, job.leaseId, Buffer.from('changed artifact'))).rejects.toMatchObject({ code: 'aborted' });
  expect([...f.records.keys()].some(key => /^(?:public|quizSnapshots)/u.test(key))).toBe(false);
});

test('stale source, wrong/expired lease and revoked device reject before ffprobe and never attach', async () => {
  for (const change of ['source', 'wrong-lease', 'expired', 'revoked'] as const) {
    vi.setSystemTime(now); const f = fixture(), paired = await f.pair(); await f.queue();
    const { job } = await localCompanionRuntimePorts.claim(paired.token); expect(job).not.toBeNull();
    if (change === 'source') f.records.get('quizzes/quiz/slides/slide')!.clipEndSeconds = 24;
    if (change === 'expired') vi.setSystemTime(job!.expiresAt + 1);
    if (change === 'revoked') await configureLocalCompanion(authIdentity, 'revoke');
    vi.mocked(validateLocalOutput).mockClear();
    await expect(localCompanionRuntimePorts.complete(paired.token, job!.jobId, change === 'wrong-lease' ? '00000000-0000-0000-0000-000000000000' : job!.leaseId, Buffer.from('clip'))).rejects.toHaveProperty('code');
    expect(validateLocalOutput).not.toHaveBeenCalled(); expect(f.upload).not.toHaveBeenCalled();
    expect(f.records.get('quizzes/quiz')!.revision).toBe(1);
  }
});

test('revocation during provider upload conflicts with final attachment and leaves source/private answers intact', async () => {
  const f = fixture(), paired = await f.pair(); await f.queue(); const { job } = await localCompanionRuntimePorts.claim(paired.token);
  const upload = f.upload.getMockImplementation()!;
  f.upload.mockImplementationOnce(async (token, input) => { const file = await upload(token, input); await configureLocalCompanion(authIdentity, 'revoke'); return file; });
  await expect(localCompanionRuntimePorts.complete(paired.token, job!.jobId, job!.leaseId, Buffer.from('synthetic clip'))).rejects.toMatchObject({ code: 'permission-denied' });
  expect(f.records.get('quizzes/quiz')!.revision).toBe(1);
  expect([...f.records.keys()].some(key => key.includes('/mediaAssets/'))).toBe(false);
  expect(f.records.get('quizzes/quiz/slides/slide')!.mediaSource).toBe('https://youtu.be/abcdefghijk');
});

test('reclaimed lease survives a late old worker and source mutation during validation prevents any Drive upload', async () => {
  const f = fixture(), paired = await f.pair(); await f.queue();
  const first = (await localCompanionRuntimePorts.claim(paired.token)).job!;
  vi.setSystemTime(first.expiresAt + 1);
  const second = (await localCompanionRuntimePorts.claim(paired.token)).job!;
  expect(second.leaseId).not.toBe(first.leaseId);
  await expect(localCompanionRuntimePorts.fail(paired.token, first.jobId, first.leaseId, 'processing-failed')).rejects.toMatchObject({ code: 'aborted' });
  expect(f.device(paired.deviceId).activeJob?.leaseId).toBe(second.leaseId);
  vi.mocked(validateLocalOutput).mockImplementationOnce((_source, bytes) => {
    f.records.get('quizzes/quiz/slides/slide')!.clipEndSeconds = 24;
    return Promise.resolve({ bytes, contentType: 'video/mp4', durationSeconds: 13 });
  });
  await expect(localCompanionRuntimePorts.complete(paired.token, second.jobId, second.leaseId, Buffer.from('clip'))).rejects.toMatchObject({ code: 'aborted' });
  expect(f.upload).not.toHaveBeenCalled(); expect(f.records.get('quizzes/quiz')!.revision).toBe(1);
});

test('three expired attempts terminate; explicit owner retry resets the existing job; old cloud queued job reroutes only on request', async () => {
  const f = fixture(), paired = await f.pair(), cloud = await f.service.request(quizTarget);
  expect(cloud.execution).toBeUndefined(); const local = await f.queue(); expect(local.jobId).toBe(cloud.jobId); expect(local.execution).toBe('local');
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { job } = await localCompanionRuntimePorts.claim(paired.token); expect(job).not.toBeNull();
    vi.setSystemTime(job!.expiresAt + 1);
  }
  expect(await localCompanionRuntimePorts.claim(paired.token)).toEqual({ job: null });
  expect(f.records.get('driveMediaJobs/' + local.jobId)).toMatchObject({ status: 'failed', attempt: 3 });
  await f.queue(); expect(f.records.get('driveMediaJobs/' + local.jobId)).toMatchObject({ status: 'queued', attempt: 0 });
  expect((await localCompanionRuntimePorts.claim(paired.token)).job).not.toBeNull();
});

test('trashed queued source is marked stale without blocking a permitted next job', async () => {
  const f = fixture(), paired = await f.pair(), queued = await f.queue();
  f.records.get('quizzes/quiz')!.disposition = 'trash';
  expect(await localCompanionRuntimePorts.claim(paired.token)).toEqual({ job: null });
  expect(f.records.get('driveMediaJobs/' + queued.jobId)).toMatchObject({ status: 'stale', errorCode: 'source-changed' });
});

test('a new valid device skips old out-of-scope jobs and terminal failures cannot fill the bounded retry query', async () => {
  const f = fixture(), old = await f.queue();
  f.records.get('memberships/owner')!.version = 2;
  f.records.get('memberships/owner')!.quizzes = { mode: 'selected', ids: ['newquiz'] };
  f.records.set('quizzes/newquiz', { revision: 1, createdBy: 'owner' });
  f.records.set('quizzes/newquiz/slides/slide', structuredClone(f.records.get('quizzes/quiz/slides/slide')!));
  const next = await f.service.request({ ...quizTarget, quizId: 'newquiz' }, 'local');
  const paired = await f.pair();
  expect((await localCompanionRuntimePorts.claim(paired.token)).job?.jobId).toBe(next.jobId);
  expect(f.records.get('driveMediaJobs/' + old.jobId)).toMatchObject({ status: 'stale', errorCode: 'membership-changed' });
  const claimed = (await configureLocalCompanion(authIdentity, 'status'));
  expect(claimed).toMatchObject({ paired: true, processing: true });
  const active = f.device(paired.deviceId).activeJob!;
  await localCompanionRuntimePorts.fail(paired.token, active.jobId, active.leaseId, 'processing-failed');
  for (let index = 0; index < 25; index++) f.records.set('driveMediaJobs/' + index.toString(16).padStart(64, '0'), {
    ownerUid: 'owner', execution: 'local', status: 'failed', attempt: 3, localRetry: false,
  });
  expect((await localCompanionRuntimePorts.claim(paired.token)).job?.jobId).toBe(next.jobId);
});

test('invalid artifact marks a terminal failure immediately, releases device and awaits explicit owner retry', async () => {
  const f = fixture(), paired = await f.pair(); await f.queue(); const { job } = await localCompanionRuntimePorts.claim(paired.token);
  vi.mocked(validateLocalOutput).mockRejectedValueOnce(new Error('INVALID_LOCAL_OUTPUT'));
  expect(await localCompanionRuntimePorts.complete(paired.token, job!.jobId, job!.leaseId, Buffer.from('bad clip'))).toMatchObject({ status: 'failed', errorCode: 'invalid-output' });
  expect(f.device(paired.deviceId).activeJob).toBeNull(); expect(f.upload).not.toHaveBeenCalled();
  expect(await localCompanionRuntimePorts.claim(paired.token)).toEqual({ job: null });
  await f.queue(); expect((await localCompanionRuntimePorts.claim(paired.token)).job).not.toBeNull();
});

test('explicit owner retry recovers the same source after it changed away and back without replacing its job identity', async () => {
  const f = fixture(), paired = await f.pair(), queued = await f.queue();
  f.records.get('quizzes/quiz/slides/slide')!.clipEndSeconds = 24;
  expect(await localCompanionRuntimePorts.claim(paired.token)).toEqual({ job: null });
  expect(f.records.get('driveMediaJobs/' + queued.jobId)).toMatchObject({ status: 'stale', errorCode: 'source-changed' });
  f.records.get('quizzes/quiz/slides/slide')!.clipEndSeconds = 23;
  const retry = await f.queue();
  expect(retry).toMatchObject({ jobId: queued.jobId, status: 'queued', execution: 'local' });
  expect((await localCompanionRuntimePorts.claim(paired.token)).job?.jobId).toBe(queued.jobId);
});

test('HTTP transport rejects browser/cookie callers, arbitrary fields, malformed capabilities and oversized binary before ports', async () => {
  const claim = vi.fn(() => Promise.resolve({ job: null })), complete = vi.fn();
  const ports: CompanionPorts = { enabled: vi.fn(), pair: vi.fn(), claim, complete, fail: vi.fn() };
  const handler = companionHandler(ports), token = 'a'.repeat(64) + '.' + 'b'.repeat(43);
  const invoke = async (headers: Record<string, string>, body: unknown, query: Record<string, unknown> = {}, rawBody?: Buffer) => {
    let status = 200; const response = { set: () => response, status: (value: number) => { status = value; return response; }, json: vi.fn(), end: vi.fn() };
    await handler({ method: 'POST', get: name => headers[name], body, query, rawBody }, response); return status;
  };
  expect(await invoke({ origin: 'https://evil.invalid' }, {})).toBe(403);
  expect(await invoke({ cookie: 'session=synthetic' }, {})).toBe(403);
  expect(await invoke({ authorization: 'Bearer invalid', 'content-type': 'application/json' }, { action: 'claim' })).toBe(403);
  expect(await invoke({ authorization: 'Bearer ' + token, 'content-type': 'application/json' }, { action: 'claim', url: 'https://evil.invalid' })).toBe(400);
  expect(await invoke({ authorization: 'Bearer ' + token, 'content-type': 'application/octet-stream' }, null,
    { action: 'complete', jobId: 'a'.repeat(64), leaseId: '00000000-0000-0000-0000-000000000000' }, Buffer.alloc(maximumLocalOutput + 1))).toBe(413);
  expect(complete).not.toHaveBeenCalled(); expect(claim).not.toHaveBeenCalled();
});

test('probe validation rejects signature-only substitutes, wrong codecs, extra streams, dimensions and durations', () => {
  const probe = { format: { duration: 13, format_name: 'mov,mp4,m4a,3gp,3g2,mj2' }, streams: [
    { codec_type: 'video', codec_name: 'h264', width: 1280, height: 720 }, { codec_type: 'audio', codec_name: 'aac', channels: 2 },
  ] };
  expect(localProbeDuration(source, probe)).toBe(13);
  for (const input of [{}, { ...probe, streams: [] }, { ...probe, format: { ...probe.format, duration: 100 } },
    { ...probe, streams: [...probe.streams, { codec_type: 'subtitle' }] }, { ...probe, streams: [{ ...probe.streams[0], width: 1920 }, probe.streams[1]] },
    { ...probe, streams: [{ ...probe.streams[0], codec_name: 'vp9' }, probe.streams[1]] }]) expect(() => localProbeDuration(source, input)).toThrow();
});
