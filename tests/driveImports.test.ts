import { createHash } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { rolePresets, type Membership } from '../packages/quiz-domain/src/access';
import { DriveImportService, type DriveImportFiles, type DriveImportProcessor, type PreparedDriveMedia } from '../functions/src/drive/imports';
import { firestoreDriveImportStore, importAttachmentPatch, importQuestionPatch } from '../functions/src/drive/import-store';
import { driveImportFields, type DriveImportAsset, type DriveImportAttachment, type DriveImportConnection,
  type DriveImportJob, type DriveImportLocator, type DriveImportSource, type DriveImportStore, type SourceAsset } from '../functions/src/drive/import-model';

const target = { quizId: 'quiz', slideId: 'slide', field: 'mediaSource' as const };
const originalSlide = () => ({ kind: 'video', position: 1, isQuestion: true, mediaSource: 'https://www.youtube.com/watch?v=abcdefghijk',
  clipStartSeconds: 10, clipEndSeconds: 23, correctAnswer: 'PRIVATE_ANSWER', moderatorNote: 'PRIVATE_NOTE',
  legacy: { raw: { preserved: 'PRIVATE_RAW' } } });
const digest = (algorithm: string, bytes: Uint8Array) => createHash(algorithm).update(bytes).digest('hex');
function fixture() {
  let time = 1000;
  const state: { freshIdentity: boolean; member: Membership; connection?: DriveImportConnection;
    quiz: { id: string; revision: number; createdBy: string; active: boolean }; slide: Record<string, unknown> } = {
    freshIdentity: true,
    member: { uid: 'owner', role: 'owner', status: 'active', version: 1, sessionValidAfter: 0, displayName: 'Synthetic', email: 'owner@example.invalid',
      permissions: [...rolePresets.owner], quizzes: { mode: 'all', ids: [] }, events: { mode: 'none', ids: [] } },
    connection: { ownerUid: 'owner', connected: true, revision: 3, generation: 2, folderId: 'private_folder', accountPermissionId: 'account_permission' },
    quiz: { id: 'quiz', revision: 7, createdBy: 'owner', active: true }, slide: originalSlide(),
  };
  const jobs = new Map<string, DriveImportJob>(), assets = new Map<string, SourceAsset | DriveImportAsset>();
  const attachments: DriveImportAttachment[] = [], providerFiles = new Map<string, string>();
  const immutableSnapshot = structuredClone(originalSlide());
  let serialized: Promise<unknown> = Promise.resolve();
  const store: DriveImportStore = { run: (ownerUid, requestedTarget, handler) => {
    const operation = serialized.then(async () => {
      expect(ownerUid).toBe('owner'); expect(requestedTarget.quizId).toBe('quiz');
      const changes: DriveImportJob[] = [], created: DriveImportAsset[] = [], attached: DriveImportAttachment[] = [];
      const result = await handler({ ...structuredClone(state),
        readJob: id => Promise.resolve(structuredClone(jobs.get(id))), readAsset: id => Promise.resolve(structuredClone(assets.get(id))),
        writeJob: job => { changes.push(structuredClone(job)); },
        createAsset: asset => { expect(assets.has(asset.assetId)).toBe(false); created.push(structuredClone(asset)); },
        attachMedia: attachment => { expect(attachment.expectedQuizRevision).toBe(state.quiz.revision); attached.push(structuredClone(attachment)); },
      });
      for (const job of changes) jobs.set(job.jobId, job);
      for (const asset of created) assets.set(asset.assetId, asset);
      for (const attachment of attached) {
        state.slide[attachment.field] = attachment.reference;
        if (attachment.clipStartSeconds !== undefined) state.slide.clipStartSeconds = attachment.clipStartSeconds;
        if (attachment.clipEndSeconds !== undefined) state.slide.clipEndSeconds = attachment.clipEndSeconds;
        state.quiz.revision++; attachments.push(attachment);
      }
      return result;
    });
    serialized = operation.then(() => undefined, () => undefined);
    return operation;
  } };
  const prepare = vi.fn<DriveImportProcessor['prepare']>((source: DriveImportSource): Promise<PreparedDriveMedia> => Promise.resolve(source.type === 'youtube'
    ? { bytes: Buffer.from('synthetic-' + source.kind), contentType: source.kind === 'video' ? 'video/mp4' : 'audio/mpeg', durationSeconds: source.endSeconds - source.startSeconds }
    : { bytes: Buffer.alloc(source.type === 'owned-image' ? source.size : 8), contentType: source.type === 'owned-image' ? source.contentType : 'image/png' }));
  const generateId = vi.fn(() => Promise.resolve('generated_file'));
  const upload = vi.fn((_connection: DriveImportConnection, input: Parameters<DriveImportFiles['upload']>[1]) => {
    const sha256 = digest('sha256', input.bytes), md5Checksum = digest('md5', input.bytes);
    const existing = providerFiles.get(input.id);
    if (existing && existing !== sha256) return Promise.reject(new Error('existing-file-content-mismatch'));
    providerFiles.set(input.id, sha256);
    return Promise.resolve({ id: input.id, folderId: input.folderId, mimeType: input.mimeType, size: input.bytes.length, sha256, md5Checksum });
  });
  const processor: DriveImportProcessor = { prepare }, files: DriveImportFiles = { generateId, upload };
  const service = new DriveImportService('owner', store, processor, files, () => time, 10_000);
  const enqueue = async (requestedTarget = target) => ({ ...requestedTarget, jobId: (await service.request(requestedTarget)).jobId });
  return { state, jobs, assets, attachments, immutableSnapshot, providerFiles, service, prepare, generateId, upload, enqueue,
    advance: (ms: number) => { time += ms; } };
}

test('only fresh current owner with every concrete permission and current quiz scope may request/status/run', async () => {
  const required = ['users.manage', 'quiz.media.upload', 'quiz.media.attach', 'quiz.edit', 'quiz.read', 'quiz.answers.read'] as const;
  for (const mode of [...required, 'fresh', 'role', 'suspended', 'uid', 'scope', 'own-scope'] as const) {
    const f = fixture();
    if (required.some(permission => permission === mode)) f.state.member.permissions = f.state.member.permissions.filter(permission => permission !== mode);
    else if (mode === 'fresh') f.state.freshIdentity = false;
    else if (mode === 'role') f.state.member.role = 'manager';
    else if (mode === 'suspended') f.state.member.status = 'suspended';
    else if (mode === 'uid') f.state.member.uid = 'other';
    else if (mode === 'scope') f.state.member.quizzes = { mode: 'selected', ids: ['other'] };
    else { f.state.member.quizzes = { mode: 'own', ids: [] }; f.state.quiz.createdBy = 'other'; }
    await expect(f.service.request(target)).rejects.toMatchObject({ code: 'permission-denied' });
    expect(f.jobs.size).toBe(0); expect(f.prepare).not.toHaveBeenCalled();
  }
  const f = fixture(), job = await f.enqueue();
  f.state.member.quizzes = { mode: 'none', ids: [] };
  await expect(f.service.status(job)).rejects.toMatchObject({ code: 'permission-denied' });
  await expect(f.service.run(job)).rejects.toMatchObject({ code: 'permission-denied' });
});

test('request accepts resource IDs and role allowlist only; trusted source/range comes from saved mapped slide', async () => {
  const f = fixture();
  for (const input of [null, [], { ...target, field: 'correctAnswer' }, { ...target, source: 'http://localhost/' },
    { ...target, startSeconds: 0 }, { ...target, quizId: '../other' }, { ...target, fileId: 'injected' }]) {
    await expect(f.service.request(input)).rejects.toMatchObject({ code: 'invalid-argument' });
  }
  const location = await f.enqueue(), job = f.jobs.get(location.jobId)!;
  expect(job.source).toEqual({ type: 'youtube', kind: 'video', videoId: 'abcdefghijk', startSeconds: 10, endSeconds: 23 });
  expect(job).toMatchObject({ membershipVersion: 1, connectionRevision: 3, connectionGeneration: 2, folderId: 'private_folder', status: 'queued' });
  expect(JSON.stringify(job)).not.toContain('PRIVATE_ANSWER');
});

test('duplicate requests and ready replays create one job, file and immutable asset; clip attaches at zero', async () => {
  const f = fixture(), location = await f.enqueue();
  expect(await f.service.request(target)).toEqual({ jobId: location.jobId, status: 'queued' });
  expect(f.jobs.size).toBe(1);
  const result = await f.service.run(location);
  expect(result.status).toBe('ready'); expect(result.reference).toMatch(/^quiz-asset:quiz\/[a-f0-9]{64}$/u);
  expect(f.state.slide).toMatchObject({ mediaSource: result.reference, clipStartSeconds: 0, clipEndSeconds: 13,
    correctAnswer: 'PRIVATE_ANSWER', moderatorNote: 'PRIVATE_NOTE', legacy: { raw: { preserved: 'PRIVATE_RAW' } } });
  const asset = [...f.assets.values()][0] as DriveImportAsset;
  expect(asset).toMatchObject({ status: 'ready', storageBackend: 'drive', importJobId: location.jobId,
    generation: 'drive:' + asset.drive.file.sha256, drive: { ownerUid: 'owner', connectionGeneration: 2 },
    privateProvenance: { source: { type: 'youtube', startSeconds: 10, endSeconds: 23 } } });
  expect(await f.service.request(target)).toEqual(result);
  expect(await f.service.status(location)).toEqual(result);
  expect(await f.service.run(location)).toEqual(result);
  expect(f.prepare).toHaveBeenCalledTimes(1); expect(f.upload).toHaveBeenCalledTimes(1); expect(f.assets.size).toBe(1);
  expect(f.state.quiz.revision).toBe(8);
  expect(f.immutableSnapshot).toEqual(originalSlide());
  const publicView = JSON.stringify(result);
  for (const secret of ['PRIVATE_', 'private_folder', 'generated_file', 'abcdefghijk', 'sourceFingerprint', 'lease', 'connectionGeneration']) expect(publicView).not.toContain(secret);
});

test('audio uses saved normalized source/timing and preserves original private provenance', async () => {
  const f = fixture();
  f.state.slide = { kind: 'audio', position: 1, media: [{ role: 'prompt', kind: 'audio', source: 'abcdefghijk' }], presentation: { videoStart: 10, videoEnd: 23 } };
  const job = await f.enqueue(); expect((await f.service.run(job)).status).toBe('ready');
  expect(f.prepare).toHaveBeenCalledWith({ type: 'youtube', kind: 'audio', videoId: 'abcdefghijk', startSeconds: 10, endSeconds: 23 }, job);
  expect(f.state.slide.clipStartSeconds).toBe(0); expect(f.state.slide.clipEndSeconds).toBe(13);
});

test('pending source or timing edits become stale before any file creation, without overwriting user changes', async () => {
  for (const change of [(f: ReturnType<typeof fixture>) => { f.state.slide.mediaSource = 'lmnopqrstuv'; },
    (f: ReturnType<typeof fixture>) => { f.state.slide.clipEndSeconds = 24; }]) {
    const f = fixture(), job = await f.enqueue(), original = f.prepare.getMockImplementation()!;
    f.prepare.mockImplementationOnce((source, context) => { change(f); return original(source, context); });
    expect(await f.service.run(job)).toEqual({ jobId: job.jobId, status: 'stale', errorCode: 'source-changed' });
    expect(f.generateId).not.toHaveBeenCalled(); expect(f.assets.size).toBe(0); expect(f.attachments).toHaveLength(0);
  }
});

test('unrelated question edits may complete against current revision while preserving answers and snapshots', async () => {
  const f = fixture(), job = await f.enqueue(), original = f.prepare.getMockImplementation()!;
  f.prepare.mockImplementationOnce((source, context) => { f.state.slide.title = 'Changed title'; f.state.quiz.revision++; return original(source, context); });
  expect((await f.service.run(job)).status).toBe('ready');
  expect(f.state.slide.title).toBe('Changed title'); expect(f.attachments[0]!.expectedQuizRevision).toBe(8);
  expect(f.state.slide.correctAnswer).toBe('PRIVATE_ANSWER'); expect(f.immutableSnapshot).toEqual(originalSlide());
});

test('active membership version change stales a job and revoked membership blocks completion entirely', async () => {
  const f = fixture(), job = await f.enqueue(), original = f.prepare.getMockImplementation()!;
  f.prepare.mockImplementationOnce((source, context) => { f.state.member.version++; return original(source, context); });
  expect(await f.service.run(job)).toEqual({ jobId: job.jobId, status: 'stale', errorCode: 'membership-changed' });
  expect(f.upload).not.toHaveBeenCalled(); expect(f.state.slide).toEqual(originalSlide());
  const g = fixture(), next = await g.enqueue(), prepare = g.prepare.getMockImplementation()!;
  g.prepare.mockImplementationOnce((source, context) => { g.state.member.status = 'suspended'; return prepare(source, context); });
  await expect(g.service.run(next)).rejects.toMatchObject({ code: 'permission-denied' });
  expect(g.generateId).not.toHaveBeenCalled(); expect(g.assets.size).toBe(0); expect(g.state.slide).toEqual(originalSlide());
});

test('disconnect and connection revision/generation/folder changes stop late completion', async () => {
  for (const change of [(f: ReturnType<typeof fixture>) => { f.state.connection = undefined; },
    (f: ReturnType<typeof fixture>) => { f.state.connection!.revision++; },
    (f: ReturnType<typeof fixture>) => { f.state.connection!.generation++; },
    (f: ReturnType<typeof fixture>) => { f.state.connection!.folderId = 'other_folder'; }]) {
    const f = fixture(), job = await f.enqueue(), upload = f.upload.getMockImplementation()!;
    f.upload.mockImplementationOnce((connection, input) => { change(f); return upload(connection, input); });
    expect(await f.service.run(job)).toEqual({ jobId: job.jobId, status: 'stale', errorCode: 'connection-changed' });
    expect(f.assets.size).toBe(0); expect(f.attachments).toHaveLength(0); expect(f.state.slide).toEqual(originalSlide());
    expect(f.jobs.get(job.jobId)!.fileId).toBe('generated_file');
  }
});

test('generated file ID and immutable output digest are committed before upload and reused after uncertain result', async () => {
  const f = fixture(), job = await f.enqueue(), upload = f.upload.getMockImplementation()!;
  f.upload.mockImplementationOnce(async (connection, input) => {
    expect(f.jobs.get(job.jobId)).toMatchObject({ fileId: input.id, output: { sha256: digest('sha256', input.bytes) } });
    await upload(connection, input);
    throw new Error('uncertain provider https://private.invalid/?access_token=PRIVATE_TOKEN');
  });
  expect(await f.service.run(job)).toEqual({ jobId: job.jobId, status: 'failed', errorCode: 'processing-failed' });
  expect(f.providerFiles.size).toBe(1); expect(f.assets.size).toBe(0); expect(f.state.slide).toEqual(originalSlide());
  expect((await f.service.run(job)).status).toBe('ready');
  expect(f.generateId).toHaveBeenCalledTimes(1); expect(f.upload).toHaveBeenCalledTimes(2); expect(f.providerFiles.size).toBe(1);
});

test('artifact drift on retry cannot replace bytes at an already reserved Drive ID', async () => {
  const f = fixture(), job = await f.enqueue();
  f.upload.mockRejectedValueOnce(new Error('transient upload failure'));
  expect((await f.service.run(job)).status).toBe('failed');
  f.prepare.mockResolvedValueOnce({ bytes: Buffer.from('different-encoding'), contentType: 'video/mp4', durationSeconds: 13 });
  expect(await f.service.run(job)).toEqual({ jobId: job.jobId, status: 'failed', errorCode: 'artifact-changed' });
  expect(f.upload).toHaveBeenCalledTimes(1); expect(f.generateId).toHaveBeenCalledTimes(1); expect(f.state.slide).toEqual(originalSlide());
});

test('active processing lease excludes concurrent workers and expired lease cannot finalize after takeover', async () => {
  const f = fixture(), job = await f.enqueue();
  let release!: (value: PreparedDriveMedia) => void, entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  f.prepare.mockImplementationOnce(() => { entered(); return new Promise(resolve => { release = resolve; }); });
  const first = f.service.run(job); await started;
  expect((await f.service.run(job)).status).toBe('processing'); expect(f.prepare).toHaveBeenCalledTimes(1);
  f.advance(10_001);
  const second = await f.service.run(job); expect(second.status).toBe('ready');
  release({ bytes: Buffer.from('synthetic-video'), contentType: 'video/mp4', durationSeconds: 13 });
  expect(await first).toEqual(second);
  expect(f.upload).toHaveBeenCalledTimes(1); expect(f.assets.size).toBe(1); expect(f.jobs.get(job.jobId)!.attempt).toBe(2);
});

test('new Drive requests reject each image role without creating jobs or uploading backups', async () => {
  for (const field of driveImportFields.filter(field => field !== 'mediaSource')) {
    for (const reference of ['https://images.example.invalid/photo.png', `quiz-asset:quiz/${'a'.repeat(64)}`]) {
      const f = fixture(); f.state.slide[field] = reference;
      await expect(f.service.request({ ...target, field })).rejects.toMatchObject({ code: 'failed-precondition' });
      expect(f.jobs.size).toBe(0); expect(f.prepare).not.toHaveBeenCalled(); expect(f.upload).not.toHaveBeenCalled();
      expect(f.state.slide[field]).toBe(reference);
    }
  }
});

test('historical image jobs and ready receipts remain readable and do not delete retained backups', async () => {
  const f = fixture(), queued = await f.enqueue(), prior = f.jobs.get(queued.jobId)!;
  const source = { type: 'https-image', kind: 'image', url: 'https://images.example.invalid/photo.png' } as const;
  f.state.slide.questionImage = source.url;
  f.jobs.set(queued.jobId, { ...prior, field: 'questionImage', source, sourceFingerprint: digest('sha256', Buffer.from(JSON.stringify(source))) });
  const location = { ...queued, field: 'questionImage' as const };
  const ready = await f.service.run(location);
  expect(ready.status).toBe('ready');
  expect(await f.service.status(location)).toEqual(ready);
  expect(await f.service.run(location)).toEqual(ready);
  expect(f.assets.size).toBe(1); expect(f.upload).toHaveBeenCalledTimes(1);
  await expect(f.service.request({ ...target, field: 'questionImage' })).rejects.toMatchObject({ code: 'failed-precondition' });
  expect(f.assets.size).toBe(1);
});

test('same-quiz ready Drive clip reused on another slide returns ready without another upload', async () => {
  const f = fixture(), queued = await f.enqueue(), ready = await f.service.run(queued);
  expect(await f.service.request({ ...target, slideId: 'copied-slide' })).toEqual(ready);
  expect(f.upload).toHaveBeenCalledTimes(1);
  await expect(f.service.status({ ...target, slideId: 'copied-slide', jobId: queued.jobId })).rejects.toMatchObject({ code: 'not-found' });
  f.state.slide.kind = 'audio';
  await expect(f.service.request(target)).rejects.toMatchObject({ code: 'failed-precondition' });
});
test('unsupported, missing, unsafe or unready source fails closed before creating a job', async () => {
  const cases: [string, unknown][] = [['clipEndSeconds', 10], ['clipEndSeconds', 191], ['clipStartSeconds', -1], ['mediaSource', 'https://other.invalid/media.mp4']];
  for (const [field, value] of cases) {
    const f = fixture(); f.state.slide[field] = value;
    await expect(f.service.request(target)).rejects.toMatchObject({ code: 'failed-precondition' }); expect(f.jobs.size).toBe(0);
  }
  const f = fixture(); f.state.quiz.active = false;
  await expect(f.service.request(target)).rejects.toMatchObject({ code: 'failed-precondition' });
});

test('invalid processor output/provider binding fails safely, preserves source and never creates an asset', async () => {
  for (const media of [{ bytes: Buffer.from('x'), contentType: 'video/mp4', durationSeconds: 1 },
    { bytes: Buffer.from('x'), contentType: 'text/html', durationSeconds: 13 },
    { bytes: Buffer.alloc(0), contentType: 'video/mp4', durationSeconds: 13 }]) {
    const f = fixture(), job = await f.enqueue(); f.prepare.mockResolvedValueOnce(media);
    expect(await f.service.run(job)).toEqual({ jobId: job.jobId, status: 'failed', errorCode: 'invalid-output' });
    expect(f.assets.size).toBe(0); expect(f.upload).not.toHaveBeenCalled(); expect(f.state.slide).toEqual(originalSlide());
  }
  const f = fixture(), job = await f.enqueue(), upload = f.upload.getMockImplementation()!;
  f.upload.mockImplementationOnce(async (connection, input) => ({ ...await upload(connection, input), folderId: 'foreign_folder' }));
  expect(await f.service.run(job)).toEqual({ jobId: job.jobId, status: 'failed', errorCode: 'invalid-output' });
  expect(f.assets.size).toBe(0); expect(f.state.slide).toEqual(originalSlide());
});

test('job identity includes current source, role, owning connection generation and folder', async () => {
  const f = fixture(), first = await f.enqueue();
  f.state.slide.clipEndSeconds = 24; const second = await f.enqueue();
  f.state.connection!.generation++; const third = await f.enqueue();
  f.state.connection!.folderId = 'other_folder'; const fourth = await f.enqueue();
  expect(new Set([first.jobId, second.jobId, third.jobId, fourth.jobId]).size).toBe(4);
  f.state.connection!.revision++; const fifth = await f.enqueue();
  f.state.member.version++; const sixth = await f.enqueue();
  expect(new Set([fourth.jobId, fifth.jobId, sixth.jobId]).size).toBe(3);
  await expect(f.service.status({ ...fourth, slideId: 'other' } satisfies DriveImportLocator)).rejects.toMatchObject({ code: 'not-found' });
});

test('reconnected media is never reported ready under a different owning Google account', async () => {
  const f = fixture(), job = await f.enqueue(); await f.service.run(job);
  f.state.connection!.generation++; f.state.connection!.revision++; f.state.connection!.folderId = 'new_folder';
  expect((await f.service.request(target)).status).toBe('ready');
  expect((await f.service.status(job)).status).toBe('ready');
  f.state.connection!.accountPermissionId = 'other_account';
  expect((await f.service.status(job)).status).toBe('stale');
  await expect(f.service.request(target)).rejects.toMatchObject({ code: 'failed-precondition' });
  f.state.connection!.connected = false;
  expect((await f.service.status(job)).status).toBe('stale');
  await expect(f.service.request(target)).rejects.toMatchObject({ code: 'failed-precondition' });
});

test('attachment merges only exact field/timing/provenance and retains every unrelated source value', () => {
  const slide = { ...originalSlide(), driveImportProvenance: { answerImage: { retained: true } } };
  const attachment: DriveImportAttachment = { field: 'mediaSource', reference: 'quiz-asset:quiz/' + 'a'.repeat(64), expectedQuizRevision: 7,
    clipStartSeconds: 0, clipEndSeconds: 13,
    privateProvenance: { importJobId: 'b'.repeat(64), field: 'mediaSource', sourceFingerprint: 'c'.repeat(64), sourceQuizRevision: 7,
      source: { type: 'youtube', kind: 'video', videoId: 'abcdefghijk', startSeconds: 10, endSeconds: 23 } } };
  const merged = { ...slide, ...importAttachmentPatch(slide, attachment) };
  expect(merged).toMatchObject({ correctAnswer: 'PRIVATE_ANSWER', moderatorNote: 'PRIVATE_NOTE', legacy: slide.legacy,
    clipStartSeconds: 0, clipEndSeconds: 13, driveImportProvenance: { answerImage: { retained: true }, mediaSource: attachment.privateProvenance } });
  expect(importQuestionPatch(attachment)).toEqual({ mediaSource: attachment.reference, clipStartSeconds: 0, clipEndSeconds: 13, videoStart: 0, videoEnd: 13 });
  expect(originalSlide().clipStartSeconds).toBe(10);
});

function firestoreFixture() {
  type Dependencies = NonNullable<Parameters<typeof firestoreDriveImportStore>[0]>;
  const membership = fixture().state.member;
  const records = new Map<string, Record<string, unknown>>([
    ['memberships/owner', membership as unknown as Record<string, unknown>],
    ['driveConnections/owner', { revision: 3, generation: 2, account: { permissionId: 'account_permission' },
      folder: { id: 'private_folder' }, refreshToken: { ciphertext: 'PRIVATE_TOKEN_ENVELOPE' } }],
    ['quizzes/quiz', { revision: 7, createdBy: 'owner', slideCount: 9, roundCount: 2, questionCount: 7 }],
    ['quizzes/quiz/slides/slide', { ...originalSlide(), roundId: 'round' }],
    ['quizzes/quiz/rounds/round/questions/slide', { sourceSlideId: 'slide', prompt: 'Retained prompt', correctAnswer: 'PRIVATE_ANSWER', untouched: 42 }],
  ]);
  const user = { disabled: false, emailVerified: true, tokensValidAfterTime: new Date(0).toUTCString() };
  const getUser = vi.fn(() => Promise.resolve(user));
  const writes: { operation: string; path: string; value: Record<string, unknown> }[] = [];
  interface FakeDocument { path: string; collection: (name: string) => { doc: (id?: string) => FakeDocument } }
  const document: (documentPath: string) => FakeDocument = documentPath => ({
    path: documentPath, collection: name => ({ doc: (id = 'generated') => document(documentPath + '/' + name + '/' + id) }),
  });
  const db = { doc: document, collection: (name: string) => ({ doc: (id = 'generated') => document(name + '/' + id) }),
    runTransaction: async <T>(handler: (tx: unknown) => Promise<T>) => {
      const changes: typeof writes = [];
      const read = (ref: { path: string }) => {
        expect(changes).toHaveLength(0); return { data: () => records.get(ref.path) };
      };
      const result = await handler({ getAll: (...refs: { path: string }[]) => Promise.resolve(refs.map(read)),
        get: (ref: { path: string }) => Promise.resolve(read(ref)),
        set: (ref: { path: string }, value: Record<string, unknown>) => { changes.push({ operation: 'set', path: ref.path, value }); },
        create: (ref: { path: string }, value: Record<string, unknown>) => {
          expect(records.has(ref.path)).toBe(false); changes.push({ operation: 'create', path: ref.path, value });
        },
        update: (ref: { path: string }, value: Record<string, unknown>) => {
          expect(records.has(ref.path)).toBe(true); changes.push({ operation: 'update', path: ref.path, value });
        },
      });
      for (const change of changes) records.set(change.path, change.operation === 'update' ? { ...records.get(change.path), ...change.value } : change.value);
      writes.push(...changes); return result;
    } };
  const store = firestoreDriveImportStore({ db: db as unknown as NonNullable<Dependencies['db']>,
    auth: { getUser } as unknown as NonNullable<Dependencies['auth']>, now: () => 50_000 });
  return { store, records, user, getUser, writes };
}

test('Firestore adapter buffers all reads before writes and atomically patches slide/question/revision without counts/public/snapshot changes', async () => {
  const f = firestoreFixture();
  const service = new DriveImportService('owner', f.store, { prepare: () => Promise.resolve({ bytes: Buffer.from('synthetic-video'), contentType: 'video/mp4', durationSeconds: 13 }) },
    { generateId: () => Promise.resolve('generated_file'), upload: (_connection, input) => Promise.resolve({ id: input.id,
      folderId: input.folderId, mimeType: input.mimeType, size: input.bytes.length, sha256: digest('sha256', input.bytes), md5Checksum: digest('md5', input.bytes) }) }, () => 50_000);
  const queued = await service.request(target), result = await service.run({ ...target, jobId: queued.jobId });
  expect(result.status).toBe('ready'); expect(f.getUser.mock.calls.length).toBeGreaterThan(5);
  expect(f.records.get('quizzes/quiz')).toMatchObject({ revision: 8, slideCount: 9, roundCount: 2, questionCount: 7 });
  expect(f.records.get('quizzes/quiz/slides/slide')).toMatchObject({ mediaSource: result.reference, correctAnswer: 'PRIVATE_ANSWER', clipStartSeconds: 0, clipEndSeconds: 13 });
  expect(f.records.get('quizzes/quiz/rounds/round/questions/slide')).toMatchObject({ mediaSource: result.reference, prompt: 'Retained prompt',
    correctAnswer: 'PRIVATE_ANSWER', untouched: 42, videoStart: 0, videoEnd: 13 });
  expect(f.writes.some(write => /^(?:public|quizSnapshots)/u.test(write.path))).toBe(false);
  expect(JSON.stringify(f.writes.filter(write => write.path.startsWith('accessAudit/')))).not.toContain('PRIVATE_');
});

test('Firestore adapter rechecks enabled verified Auth and rejects unfinished jobs predating token/session revocation', async () => {
  for (const mode of ['disabled', 'unverified', 'auth-cutoff', 'session-cutoff'] as const) {
    const f = firestoreFixture();
    if (mode === 'disabled') f.user.disabled = true;
    if (mode === 'unverified') f.user.emailVerified = false;
    if (mode === 'auth-cutoff') f.user.tokensValidAfterTime = new Date(60_000).toUTCString();
    if (mode === 'session-cutoff') f.records.get('memberships/owner')!.sessionValidAfter = 60;
    const jobId = 'a'.repeat(64);
    f.records.set('driveMediaJobs/' + jobId, { createdAt: 50_000, status: 'processing' });
    await expect(f.store.run('owner', target, view => view.readJob(jobId))).rejects.toMatchObject({ code: 'permission-denied' });
    expect(f.writes).toHaveLength(0);
  }
});
