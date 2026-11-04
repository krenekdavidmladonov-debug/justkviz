import { createHash } from 'node:crypto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createTokenVault } from '../functions/src/email/token-vault';
import { withDriveAccess, driveRuntimeSecrets, type DriveRuntimeDependencies } from '../functions/src/drive/runtime';
import { DriveProviderError } from '../functions/src/drive/provider';
import * as mediaRead from '../functions/src/drive/media-read';
import { readQuizMedia } from '../functions/src/media/endpoint';
import { driveImageBytes } from '../functions/src/drive/image-byte-cache';

interface State {
  records: Record<string, Record<string, unknown>>;
  writes: string[];
  user: { uid: string; disabled: boolean; emailVerified: boolean; tokensValidAfterTime: string } | undefined;
  privateAllowed: boolean;
  privateChecks: number;
  storageReads: number;
  batches: string[][];
  authWait?: Promise<void>;
  latencyMillis: number;
}
const state = vi.hoisted((): State => ({ records: {}, writes: [],
  user: { uid: 'owner', disabled: false, emailVerified: true, tokensValidAfterTime: '' },
  privateAllowed: true, privateChecks: 0, storageReads: 0, batches: [], latencyMillis: 0 }));
type Ref = { path: string; get: () => Promise<{ data: () => Record<string, unknown> | undefined }> };
function document(path: string): Ref { return { path, get: async () => {
  if (state.latencyMillis) await new Promise(resolve => setTimeout(resolve, state.latencyMillis));
  return { data: () => state.records[path] };
} }; }
vi.mock('../functions/node_modules/firebase-admin/lib/esm/firestore/index.js', () => ({ getFirestore: () => ({
  doc: document,
  runTransaction: async <T>(run: (tx: unknown) => Promise<T>) => {
    const pending: [string, Record<string, unknown>][] = [];
    const result = await run({ get: (ref: Ref) => ref.get(), getAll: (...refs: Ref[]) => {
      state.batches.push(refs.map(ref => ref.path)); return Promise.all(refs.map(ref => ref.get()));
    },
      set: (ref: Ref, value: Record<string, unknown>) => { pending.push([ref.path, value]); } });
    for (const [path, value] of pending) { state.records[path] = value; state.writes.push(path); }
    return result;
  },
}) }));
vi.mock('../functions/node_modules/firebase-admin/lib/esm/auth/index.js', () => ({ getAuth: () => ({
  getUser: () => (state.authWait ?? (state.latencyMillis
    ? new Promise(resolve => setTimeout(resolve, state.latencyMillis)) : Promise.resolve())).then(() => {
    if (!state.user) throw new Error('missing user'); return state.user;
  }),
  verifyIdToken: () => Promise.resolve({ uid: 'owner', email_verified: true, auth_time: 100 }),
}) }));
vi.mock('../functions/src/access/media', () => ({
  authorizePrivateMedia: () => { state.privateChecks++; return state.privateAllowed ? Promise.resolve(1) : Promise.reject(new Error('denied')); },
  authorizeEventShowMedia: () => Promise.reject(new Error('unused')),
}));
vi.mock('../functions/src/media/storage', () => ({ mediaBucket: () => ({ file: () => ({ getMetadata: () => Promise.resolve([{}]), download: () => {
  state.storageReads++; return Promise.resolve([Buffer.from('old storage bytes')]);
} }) }) }));
const account = { email: 'owner@gmail.com', permissionId: 'owner_permission' };
const folder = { id: 'private_folder', name: 'Media', url: 'https://drive.google.com/drive/folders/private_folder' };
const bytes = Buffer.alloc(24); Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes); bytes.write('IHDR', 12);
const sha256 = createHash('sha256').update(bytes).digest('hex'), md5Checksum = createHash('md5').update(bytes).digest('hex');
const file = { id: 'private_file', folderId: folder.id, mimeType: 'image/png', size: bytes.length, sha256, md5Checksum };
const asset = { quizId: 'quiz-1', status: 'ready', kind: 'image', contentType: 'image/png', size: bytes.length, sha256,
  generation: 'drive:' + sha256, drive: { ownerUid: 'owner', connectionGeneration: 2, accountPermissionId: account.permissionId, file } };
const reference = 'quiz-asset:quiz-1/' + 'a'.repeat(64), assetPath = 'quizzes/quiz-1/mediaAssets/' + 'a'.repeat(64);
const binding = { ownerUid: 'owner', quizId: 'quiz-1', connectionGeneration: 2, folderId: folder.id };
const vault = createTokenVault('synthetic-key', Buffer.alloc(32, 29));
function fixture(): DriveRuntimeDependencies {
  return { config: { clientId: 'synthetic', clientSecret: 'synthetic', redirectUri: 'synthetic', developerKey: 'synthetic', appId: 'synthetic', vault },
    provider: { exchange: vi.fn(() => Promise.reject(new Error('unused'))), refresh: vi.fn(() => Promise.resolve({ accessToken: 'private-access', expiresIn: 3600 })),
      account: vi.fn(() => Promise.resolve(account)), folder: vi.fn(() => Promise.resolve(folder)),
      generateFolderId: vi.fn(() => Promise.reject(new Error('unused'))), createMediaFolder: vi.fn(() => Promise.reject(new Error('unused'))), revoke: vi.fn(() => Promise.resolve()) },
    files: { generateId: vi.fn(() => Promise.reject(new Error('unused'))), upload: vi.fn(() => Promise.reject(new Error('unused'))),
      verify: vi.fn(() => Promise.resolve(file)), download: vi.fn(() => Promise.resolve(bytes)) } };
}
beforeEach(() => {
  driveImageBytes.clear();
  state.user = { uid: 'owner', disabled: false, emailVerified: true, tokensValidAfterTime: '' };
  state.writes = []; state.privateAllowed = true; state.privateChecks = 0; state.storageReads = 0;
  state.batches = []; state.authWait = undefined; state.latencyMillis = 0;
  state.records = { 'memberships/owner': { uid: 'owner', status: 'active', role: 'owner', version: 4, sessionValidAfter: 0,
    permissions: ['users.manage', 'quiz.read', 'quiz.media.upload'], quizzes: { mode: 'selected', ids: ['quiz-1'] } },
    'quizzes/quiz-1': { createdBy: 'owner', disposition: 'trash' },
    'driveConnections/owner': { revision: 5, generation: 2, account, folder,
      refreshToken: vault.seal('private-refresh', 'justkviz-drive:v1:owner:refresh:2') },
    [assetPath]: structuredClone(asset), 'publicSessions/session1': { status: 'active', slideKind: 'image', questionImage: reference } };
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

test('synthetic 100ms services reduce Drive runtime dependency depth from 1500ms to 500ms', async () => {
  vi.useFakeTimers(); state.latencyMillis = 100;
  const dependencies = fixture();
  const delayed = <T>(value: T) => new Promise<T>(resolve => setTimeout(() => resolve(value), 100));
  vi.mocked(dependencies.provider.refresh).mockImplementation(() => delayed({ accessToken: 'private-access', expiresIn: 3600 }));
  vi.mocked(dependencies.provider.account).mockImplementation(() => delayed(account));
  vi.mocked(dependencies.provider.folder).mockImplementation(() => delayed(folder));
  const started = Date.now();
  const pending = withDriveAccess(binding, () => Promise.resolve('safe'), dependencies);
  await vi.runAllTimersAsync(); await expect(pending).resolves.toBe('safe');
  expect(Date.now() - started).toBe(500);
  // Original: 3 checkpoints * (Auth + 3 records) + refresh + account + folder = 15 waits.
  // Current: 3 concurrent checkpoints + refresh + concurrent account/folder = 5 waits.
  expect(state.batches).toHaveLength(3);
});

test('fresh Drive checkpoints batch their records without waiting for the independent Auth read', async () => {
  let releaseAuth!: () => void;
  state.authWait = new Promise(resolve => { releaseAuth = resolve; });
  const dependencies = fixture(), callback = vi.fn(() => Promise.resolve('safe result'));
  const pending = withDriveAccess(binding, callback, dependencies);
  // The Firestore batch has already started while Auth is deliberately unresolved.
  expect(state.batches).toEqual([['memberships/owner', 'quizzes/quiz-1', 'driveConnections/owner']]);
  expect(dependencies.provider.refresh).not.toHaveBeenCalled(); expect(callback).not.toHaveBeenCalled();
  releaseAuth();
  await expect(pending).resolves.toBe('safe result');
  expect(state.batches).toHaveLength(3);
  for (const batch of state.batches) expect(batch).toEqual(['memberships/owner', 'quizzes/quiz-1', 'driveConnections/owner']);
});

test('internal runtime preserves historical source reads, holds credentials in memory and returns only callback output', async () => {
  const dependencies = fixture();
  await expect(mediaRead.readDriveAsset(asset, 'quiz-1', dependencies)).resolves.toEqual(bytes);
  expect(dependencies.files.download).toHaveBeenCalledWith('private-access', account, file);
  expect(dependencies.provider.refresh).toHaveBeenCalledWith('private-refresh');
  expect(state.writes).toEqual([]);
  expect(JSON.stringify(state.records)).not.toMatch(/private-access|private-refresh/u);
  expect(driveRuntimeSecrets).toEqual([]);
  expect(readQuizMedia.__endpoint.secretEnvironmentVariables ?? []).toEqual([]);
});

test('Drive revalidation checks live ownership and file verification without byte transfer', async () => {
  const dependencies = fixture();
  await mediaRead.verifyDriveAsset(asset, 'quiz-1', dependencies);
  expect(dependencies.files.verify).toHaveBeenCalledWith('private-access', account, file);
  expect(dependencies.files.download).not.toHaveBeenCalled();
  vi.mocked(dependencies.files.verify).mockRejectedValueOnce(new Error('file became public'));
  await expect(mediaRead.verifyDriveAsset(asset, 'quiz-1', dependencies)).rejects.toThrow();
  vi.mocked(dependencies.files.verify).mockImplementationOnce(() => {
    state.records['memberships/owner']!.status = 'suspended'; return Promise.resolve(file);
  });
  await expect(mediaRead.verifyDriveAsset(asset, 'quiz-1', dependencies)).rejects.toThrow();
  expect(dependencies.files.download).not.toHaveBeenCalled();
});

test('image-byte reuse still checks current owner, connection and file ACLs on every read', async () => {
  const dependencies = fixture();
  vi.mocked(dependencies.files.download).mockResolvedValue(Buffer.from(bytes));
  const initial = await mediaRead.readDriveAsset(asset, 'quiz-1', dependencies);
  initial.fill(0);
  await expect(mediaRead.readDriveAsset(asset, 'quiz-1', dependencies)).resolves.toEqual(bytes);
  expect(dependencies.files.download).toHaveBeenCalledTimes(1);
  expect(dependencies.files.verify).toHaveBeenCalledTimes(1);
  expect(dependencies.provider.refresh).toHaveBeenCalledTimes(2);
  expect(dependencies.provider.account).toHaveBeenCalledTimes(2);
  expect(dependencies.provider.folder).toHaveBeenCalledTimes(2);
  expect(state.batches).toHaveLength(6);
  vi.mocked(dependencies.files.verify).mockRejectedValueOnce(new Error('file became public'));
  await expect(mediaRead.readDriveAsset(asset, 'quiz-1', dependencies)).rejects.toThrow();
  vi.mocked(dependencies.files.verify).mockImplementationOnce(() => {
    state.records['memberships/owner']!.version = 5; return Promise.resolve(file);
  });
  await expect(mediaRead.readDriveAsset(asset, 'quiz-1', dependencies)).rejects.toThrow();
  state.user!.disabled = true;
  await expect(mediaRead.readDriveAsset(asset, 'quiz-1', dependencies)).rejects.toThrow();
  expect(dependencies.files.download).toHaveBeenCalledTimes(1);
});

test('image-byte reuse pins the private file binding and never retains failed final authority checks', async () => {
  const dependencies = fixture();
  vi.mocked(dependencies.files.download).mockImplementationOnce(() => {
    state.records['memberships/owner']!.version = 5; return Promise.resolve(bytes);
  });
  await expect(mediaRead.readDriveAsset(asset, 'quiz-1', dependencies)).rejects.toThrow();
  state.records['memberships/owner']!.version = 4;
  await expect(mediaRead.readDriveAsset(asset, 'quiz-1', dependencies)).resolves.toEqual(bytes);
  expect(dependencies.files.download).toHaveBeenCalledTimes(2);
  const otherFile = { ...file, id: 'different_private_file' };
  await expect(mediaRead.readDriveAsset({ ...asset, drive: { ...asset.drive, file: otherFile } }, 'quiz-1', dependencies)).resolves.toEqual(bytes);
  expect(dependencies.files.download).toHaveBeenCalledTimes(3);
  expect(dependencies.files.download).toHaveBeenLastCalledWith('private-access', account, otherFile);
});

test('audio reads retain their verified byte path without image retention', async () => {
  const dependencies = fixture(), audio = Buffer.from('ID3synthetic-mp3-content');
  const audioHash = createHash('sha256').update(audio).digest('hex');
  const audioFile = { ...file, mimeType: 'audio/mpeg', size: audio.length, sha256: audioHash,
    md5Checksum: createHash('md5').update(audio).digest('hex') };
  const audioAsset = { ...asset, kind: 'audio', contentType: 'audio/mpeg', size: audio.length, sha256: audioHash,
    generation: 'drive:' + audioHash, drive: { ...asset.drive, file: audioFile } };
  vi.mocked(dependencies.files.download).mockResolvedValue(audio);
  await expect(mediaRead.readDriveAsset(audioAsset, 'quiz-1', dependencies)).resolves.toEqual(audio);
  await expect(mediaRead.readDriveAsset(audioAsset, 'quiz-1', dependencies)).resolves.toEqual(audio);
  expect(dependencies.files.download).toHaveBeenCalledTimes(2); expect(dependencies.files.verify).not.toHaveBeenCalled();
});

test('account and folder provider reads overlap and account substitution keeps reauthorization precedence', async () => {
  const dependencies = fixture(); let releaseAccount!: (value: typeof account) => void;
  vi.mocked(dependencies.provider.account).mockImplementationOnce(() => new Promise(resolve => { releaseAccount = resolve; }));
  vi.mocked(dependencies.provider.folder).mockImplementationOnce(() => {
    releaseAccount({ ...account, permissionId: 'foreign_owner' }); return Promise.reject(new Error('folder denied'));
  });
  const callback = vi.fn(() => Promise.resolve('never'));
  await expect(withDriveAccess(binding, callback, dependencies)).rejects.toThrow();
  expect(callback).not.toHaveBeenCalled(); expect(state.records['driveConnections/owner']!.reauthorizationRequired).toBe(true);
});

test('runtime rejects absent, disabled or unverified live owner and every missing concrete permission/scope before credentials IO', async () => {
  const cases = [() => { state.user = undefined; }, () => { state.user!.disabled = true; }, () => { state.user!.emailVerified = false; },
    () => { delete state.records['memberships/owner']; }, () => { state.records['memberships/owner']!.status = 'suspended'; },
    () => { state.records['memberships/owner']!.role = 'manager'; }, () => { state.records['memberships/owner']!.uid = 'other'; },
    ...['users.manage', 'quiz.read', 'quiz.media.upload'].map(permission => () => {
      state.records['memberships/owner']!.permissions = (state.records['memberships/owner']!.permissions as string[]).filter(value => value !== permission);
    }), () => { state.records['memberships/owner']!.quizzes = { mode: 'selected', ids: ['foreign'] }; },
    () => { state.records['memberships/owner']!.quizzes = { mode: 'own', ids: [] }; state.records['quizzes/quiz-1']!.createdBy = 'other'; }];
  for (const change of cases) {
    const member = structuredClone(state.records['memberships/owner']), quiz = structuredClone(state.records['quizzes/quiz-1']);
    change(); const dependencies = fixture();
    await expect(mediaRead.readDriveAsset(asset, 'quiz-1', dependencies)).rejects.toThrow();
    expect(dependencies.provider.refresh).not.toHaveBeenCalled(); expect(dependencies.files.download).not.toHaveBeenCalled();
    state.user = { uid: 'owner', disabled: false, emailVerified: true, tokensValidAfterTime: '' };
    state.records['memberships/owner'] = member!; state.records['quizzes/quiz-1'] = quiz!;
  }
});

test('Drive asset metadata cannot select arbitrary files, generations, MIME, hashes or another folder', async () => {
  const dependencies = fixture();
  for (const patch of [{ quizId: 'foreign' }, { status: 'uploading' }, { contentType: 'image/svg+xml' }, { size: bytes.length + 1 },
    { sha256: '0'.repeat(64) }, { generation: 'storage-generation' }, { drive: { ...asset.drive, connectionGeneration: -1 } },
    { drive: { ...asset.drive, file: { ...file, id: '../bad' } } }, { drive: { ...asset.drive, file: { ...file, md5Checksum: '' } } },
    { drive: { ...asset.drive, accountPermissionId: '' } }]) {
    await expect(mediaRead.readDriveAsset({ ...asset, ...patch }, 'quiz-1', dependencies)).rejects.toThrow();
  }
  expect(dependencies.provider.refresh).not.toHaveBeenCalled();
});

test('disconnected, different-account and reauthorization bindings reject reads before provider IO', async () => {
  for (const patch of [{ account: { ...account, permissionId: 'foreign_account' } }, { reauthorizationRequired: true }, { refreshToken: undefined }, { folder: undefined }]) {
    const saved = state.records['driveConnections/owner']; state.records['driveConnections/owner'] = { ...saved, ...patch };
    const dependencies = fixture();
    await expect(mediaRead.readDriveAsset(asset, 'quiz-1', dependencies)).rejects.toThrow();
    expect(dependencies.provider.refresh).not.toHaveBeenCalled(); state.records['driveConnections/owner'] = saved!;
  }
});

test('same-account reconnect and changed destination retain immutable historical media while current generation remains pinned during IO', async () => {
  const dependencies = fixture();
  state.records['driveConnections/owner'] = { ...state.records['driveConnections/owner'], generation: 4, revision: 10,
    folder: { ...folder, id: 'new_destination' }, refreshToken: vault.seal('reconnected-refresh', 'justkviz-drive:v1:owner:refresh:4') };
  vi.mocked(dependencies.provider.folder).mockResolvedValue({ ...folder, id: 'new_destination' });
  await expect(mediaRead.readDriveAsset(asset, 'quiz-1', dependencies)).resolves.toEqual(bytes);
  expect(dependencies.files.download).toHaveBeenCalledWith('private-access', account, file);
  expect(dependencies.provider.refresh).toHaveBeenCalledWith('reconnected-refresh');
  await expect(withDriveAccess(binding, () => Promise.resolve(undefined), dependencies)).rejects.toThrow();
});

test('refresh rotation is encrypted and revision-pinned before the callback; account substitution requires reauthorization', async () => {
  const dependencies = fixture();
  vi.mocked(dependencies.provider.refresh).mockResolvedValue({ accessToken: 'rotated-access', refreshToken: 'rotated-refresh', expiresIn: 3600 });
  await withDriveAccess(binding, async access => {
    expect(state.records['driveConnections/owner']!.revision).toBe(6);
    expect(access.accessToken).toBe('rotated-access');
    await access.assertCurrent();
  }, dependencies);
  const encrypted = state.records['driveConnections/owner']!.refreshToken as Parameters<typeof vault.open>[0];
  expect(vault.open(encrypted, 'justkviz-drive:v1:owner:refresh:2')).toBe('rotated-refresh');
  expect(JSON.stringify(state.records)).not.toMatch(/rotated-access|rotated-refresh/u);
  vi.mocked(dependencies.provider.account).mockResolvedValue({ email: 'other@gmail.com', permissionId: 'other_owner' });
  await expect(withDriveAccess(binding, () => Promise.resolve('should not run'), dependencies)).rejects.toThrow();
  expect(state.records['driveConnections/owner']!.reauthorizationRequired).toBe(true);
});

test('provider IO cannot release credentials to the callback after membership change or private-folder verification failure', async () => {
  const dependencies = fixture(), callback = vi.fn(() => Promise.resolve('safe result'));
  vi.mocked(dependencies.provider.refresh).mockImplementationOnce(() => {
    state.records['memberships/owner']!.version = 5;
    return Promise.resolve({ accessToken: 'private-access', expiresIn: 3600 });
  });
  await expect(withDriveAccess(binding, callback, dependencies)).rejects.toThrow();
  expect(callback).not.toHaveBeenCalled();
  vi.mocked(dependencies.provider.folder).mockRejectedValueOnce(new Error('private provider response'));
  await expect(withDriveAccess(binding, callback, dependencies)).rejects.toThrow('Soukromé médium na Disku není dostupné.');
  expect(callback).not.toHaveBeenCalled();
});

test('revocation, membership changes, owner disable, OAuth disconnect and folder replacement during IO discard downloaded bytes', async () => {
  for (const change of [() => { state.records['memberships/owner']!.status = 'suspended'; },
    () => { state.records['memberships/owner']!.version = 5; }, () => { state.user!.disabled = true; },
    () => { state.user!.tokensValidAfterTime = new Date(1000).toISOString(); },
    () => { state.records['driveConnections/owner']!.revision = 6; },
    () => { state.records['driveConnections/owner']!.generation = 3; },
    () => { state.records['driveConnections/owner']!.folder = { ...folder, id: 'other_folder' }; }]) {
    const records = structuredClone(state.records), user = structuredClone(state.user), dependencies = fixture();
    vi.mocked(dependencies.files.download).mockImplementationOnce(() => { change(); return Promise.resolve(bytes); });
    await expect(mediaRead.readDriveAsset(asset, 'quiz-1', dependencies)).rejects.toThrow();
    state.records = records; state.user = user;
  }
});

test('media read verifies size, both hashes and media signature after transport; provider responses never enter errors', async () => {
  const dependencies = fixture();
  vi.mocked(dependencies.files.download).mockResolvedValue(Buffer.alloc(bytes.length));
  await expect(mediaRead.readDriveAsset(asset, 'quiz-1', dependencies)).rejects.toThrow('Soukromé médium na Disku není dostupné.');
  vi.mocked(dependencies.provider.refresh).mockRejectedValue(new Error('private-refresh raw-provider-body'));
  await expect(mediaRead.readDriveAsset(asset, 'quiz-1', dependencies)).rejects.toThrow('Soukromé médium na Disku není dostupné.');
  vi.mocked(dependencies.provider.refresh).mockRejectedValue(new DriveProviderError(true));
  await expect(mediaRead.readDriveAsset(asset, 'quiz-1', dependencies)).rejects.toThrow();
  expect(state.records['driveConnections/owner']!.reauthorizationRequired).toBe(true);
});

async function gateway(query: Record<string, unknown>, headers: Record<string, string> = {}) {
  let code = 200, body: Buffer | undefined;
  const sent: Record<string, string> = {};
  const response = { on: () => response, setHeader: (key: string, value: string) => { sent[key] = value; }, getHeader: (key: string) => sent[key],
    set: (key: string, value: string) => { sent[key] = value; return response; }, status: (status: number) => { code = status; return response; },
    send: (value: Buffer) => { body = value; return response; }, end: () => response };
  const request = { method: 'GET', headers, query, get: (key: string) => headers[key] };
  await readQuizMedia(request as unknown as Parameters<typeof readQuizMedia>[0], response as unknown as Parameters<typeof readQuizMedia>[1]);
  return { code, body, headers: sent };
}

test('conditional reuse verifies Drive and current publication without downloading bytes again', async () => {
  const read = vi.spyOn(mediaRead, 'readDriveAsset').mockResolvedValue(bytes);
  const verify = vi.spyOn(mediaRead, 'verifyDriveAsset').mockResolvedValue();
  const initial = await gateway({ reference, sessionId: 'session1' });
  const headers = { 'if-none-match': initial.headers.ETag! };
  expect(initial.headers['Access-Control-Expose-Headers']).toBe('ETag, Server-Timing');
  expect(initial.headers['Server-Timing']).toMatch(/^authorization;dur=\d+\.\d, media;dur=\d+\.\d, reauthorization;dur=\d+\.\d, total;dur=\d+\.\d$/u);
  const reused = await gateway({ reference, sessionId: 'session1' }, headers);
  expect(reused.code).toBe(304); expect(reused.body).toBeUndefined();
  expect(verify).toHaveBeenCalledWith(asset, 'quiz-1'); expect(read).toHaveBeenCalledTimes(1);
  verify.mockImplementationOnce(() => { state.records['publicSessions/session1']!.status = 'ended'; return Promise.resolve(); });
  expect((await gateway({ reference, sessionId: 'session1' }, headers)).code).toBe(404);
});

test('conditional reuse fails closed on Drive ACL or private permission changes and never replaces ranges', async () => {
  const read = vi.spyOn(mediaRead, 'readDriveAsset').mockResolvedValue(bytes);
  const verify = vi.spyOn(mediaRead, 'verifyDriveAsset').mockResolvedValue();
  const initial = await gateway({ reference }, { authorization: 'Bearer synthetic-id-token' });
  const headers = { authorization: 'Bearer synthetic-id-token', 'if-none-match': initial.headers.ETag! };
  verify.mockRejectedValueOnce(new Error('ACL revoked'));
  expect((await gateway({ reference }, headers)).code).toBe(404);
  verify.mockImplementationOnce(() => { state.privateAllowed = false; return Promise.resolve(); });
  expect((await gateway({ reference }, headers)).code).toBe(404);
  state.privateAllowed = true;
  expect((await gateway({ reference }, { ...headers, range: 'bytes=4-11' })).code).toBe(206);
  expect((await gateway({ reference }, { ...headers, 'if-none-match': '"other"' })).code).toBe(200);
  expect(read).toHaveBeenCalledTimes(3);
});

test('existing gateway checks current publication before and after Drive IO and ranges only verified complete bytes', async () => {
  const read = vi.spyOn(mediaRead, 'readDriveAsset').mockResolvedValue(bytes);
  const output = await gateway({ reference, sessionId: 'session1' }, { range: 'bytes=4-11' });
  expect(output.code).toBe(206); expect(output.body).toEqual(bytes.subarray(4, 12));
  expect(output.headers).toMatchObject({ 'Content-Range': 'bytes 4-11/24', 'Content-Length': '8', 'Cache-Control': 'no-store' });
  expect(read).toHaveBeenCalledWith(asset, 'quiz-1'); expect(state.storageReads).toBe(0);
  state.records['publicSessions/session1']!.questionImage = undefined;
  expect((await gateway({ reference, sessionId: 'session1' })).code).toBe(404); expect(read).toHaveBeenCalledTimes(1);
  state.records['publicSessions/session1']!.questionImage = reference;
  read.mockImplementationOnce(() => { state.records['publicSessions/session1']!.status = 'ended'; return Promise.resolve(bytes); });
  const stale = await gateway({ reference, sessionId: 'session1' }); expect(stale.code).toBe(404); expect(stale.body).toBeUndefined();
});

test('private gateway repeats existing authorization after Drive IO and ordinary Storage remains independent of Drive configuration', async () => {
  const read = vi.spyOn(mediaRead, 'readDriveAsset').mockImplementationOnce(() => { state.privateAllowed = false; return Promise.resolve(bytes); });
  const denied = await gateway({ reference }, { authorization: 'Bearer synthetic-id-token' });
  expect(denied.code).toBe(404); expect(denied.body).toBeUndefined(); expect(state.privateChecks).toBe(2); expect(read).toHaveBeenCalledTimes(1);
  state.records[assetPath] = { ...asset, drive: undefined, generation: '123' };
  const old = await gateway({ reference, sessionId: 'session1' }); expect(old.code).toBe(200);
  expect(old.body).toEqual(Buffer.from('old storage bytes')); expect(state.storageReads).toBe(1); expect(read).toHaveBeenCalledTimes(1);
});
