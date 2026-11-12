import { createHash } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
import { GoogleDriveFiles, MAX_DRIVE_FILE_BYTES, type DriveFileReference } from '../functions/src/drive/files';
import { DriveProviderError } from '../functions/src/drive/provider';

const environment = { GCLOUD_PROJECT: 'filmovy-kviz-v2-staging' };
const account = { email: 'owner@gmail.com', permissionId: 'owner_permission' };
const bytes = Buffer.from('synthetic binary media');
const file: DriveFileReference = { id: 'generated_file', folderId: 'private_folder', mimeType: 'video/mp4', size: bytes.length,
  md5Checksum: createHash('md5').update(bytes).digest('hex'), sha256: createHash('sha256').update(bytes).digest('hex') };
const folder = { id: file.folderId, name: 'Private folder', mimeType: 'application/vnd.google-apps.folder', trashed: false,
  ownedByMe: true, shared: false, capabilities: { canAddChildren: true }, owners: [{ permissionId: account.permissionId }],
  permissions: [{ id: account.permissionId, type: 'user', role: 'owner' }] };
const metadata = { ...folder, id: file.id, mimeType: file.mimeType, size: String(file.size), md5Checksum: file.md5Checksum,
  sha256Checksum: file.sha256, parents: [file.folderId], appProperties: { justkvizMedia: 'v1', justkvizSha256: file.sha256 } };
const session = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=synthetic';
const input = { id: file.id, folderId: file.folderId, account, name: 'video.mp4', mimeType: file.mimeType, bytes };
const json = (data: unknown) => new Response(JSON.stringify(data));
const requestUrl = (url: Parameters<typeof fetch>[0]) => url instanceof Request ? url.url : url.toString();
function fixture(options: { filePatch?: Record<string, unknown>; folderPatch?: Record<string, unknown>;
  location?: string; conflict?: boolean; body?: Uint8Array; mediaResponse?: () => Response; putStatus?: number } = {}) {
  const http = vi.fn<typeof fetch>((url, init) => {
    const target = new URL(requestUrl(url));
    if (target.pathname.endsWith('/generateIds')) return Promise.resolve(json({ ids: [file.id] }));
    if (target.pathname.endsWith('/' + file.folderId)) return Promise.resolve(json({ ...folder, ...options.folderPatch }));
    if (target.searchParams.get('alt') === 'media') return Promise.resolve(options.mediaResponse?.() ?? new Response(Buffer.from(options.body ?? bytes)));
    if (init?.method === 'POST') return Promise.resolve(new Response('', { status: options.conflict ? 409 : 200, headers: { Location: options.location ?? session } }));
    if (init?.method === 'PUT') return Promise.resolve(new Response('', { status: options.putStatus ?? 200 }));
    return Promise.resolve(json({ ...metadata, ...options.filePatch }));
  });
  return { http, files: new GoogleDriveFiles(http, environment) };
}
afterEach(() => { vi.useRealTimers(); });

test('synthetic 100ms transport reduces verified download dependency depth from 500ms to 300ms', async () => {
  vi.useFakeTimers();
  const { http, files } = fixture();
  const immediate = http.getMockImplementation()!;
  http.mockImplementation((...args) => new Promise<Response>((resolve, reject) => {
    setTimeout(() => { Promise.resolve(immediate(...args)).then(resolve, reject); }, 100);
  }));
  const started = Date.now(), pending = files.download('token', account, file);
  await vi.runAllTimersAsync(); await expect(pending).resolves.toEqual(bytes);
  expect(Date.now() - started).toBe(300); expect(http).toHaveBeenCalledTimes(5);
});

test('uploads bounded binary media to the exact selected private folder, then verifies safe immutable metadata', async () => {
  const { http, files } = fixture();
  expect(await files.generateId('synthetic-token')).toBe(file.id);
  expect(await files.upload('synthetic-token', input)).toEqual(file);
  const post = http.mock.calls.find(([, init]) => init?.method === 'POST');
  expect(post?.[0]).toBe('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable');
  expect(JSON.parse(post?.[1]?.body as string)).toEqual({ id: file.id, name: input.name, mimeType: input.mimeType,
    parents: [file.folderId], appProperties: { justkvizMedia: 'v1', justkvizSha256: file.sha256 } });
  const put = http.mock.calls.find(([, init]) => init?.method === 'PUT');
  expect(put?.[0]).toBe(session);
  expect(put?.[1]?.body).toEqual(bytes);
  expect(put?.[1]?.headers).toMatchObject({ 'Content-Length': String(bytes.length), 'Content-Type': 'video/mp4' });
  for (const [url, init] of http.mock.calls) {
    expect(new URL(requestUrl(url)).origin).toBe('https://www.googleapis.com');
    expect(init?.redirect).toBe('error');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer synthetic-token' });
  }
  expect(JSON.stringify(file)).not.toContain('synthetic-token');
});

test('supports photo, audio and video MIME types without creating Google Workspace conversions', async () => {
  for (const mimeType of ['image/jpeg', 'image/png', 'image/webp', 'audio/mpeg', 'audio/wav', 'video/mp4', 'video/webm']) {
    const { files } = fixture({ filePatch: { mimeType } });
    await expect(files.upload('token', { ...input, mimeType })).resolves.toMatchObject({ mimeType });
  }
});

test('pre-generated file IDs make a matching retry read-only after conflict, and mismatching retries fail closed', async () => {
  const { http, files } = fixture({ conflict: true });
  await expect(files.upload('token', input)).resolves.toEqual(file);
  expect(http.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(0);
  await expect(fixture({ conflict: true, filePatch: { md5Checksum: '0'.repeat(32) } }).files.upload('token', input)).rejects.toThrow();
});

test('rejects unsafe file identities, metadata and oversize/empty inputs before any IO', async () => {
  const { files, http } = fixture();
  for (const patch of [{ id: '../file' }, { folderId: 'https://evil.invalid/' }, { name: 'x\r\ny' },
    { mimeType: 'application/vnd.google-apps.document' }, { mimeType: 'image/svg+xml' }, { bytes: Buffer.alloc(0) },
    { bytes: Buffer.alloc(MAX_DRIVE_FILE_BYTES + 1) }]) await expect(files.upload('token', { ...input, ...patch })).rejects.toThrow();
  for (const patch of [{ id: '../file' }, { size: MAX_DRIVE_FILE_BYTES + 1 }, { size: 0 }, { md5Checksum: '' }, { sha256: '' }]) {
    await expect(files.download('token', account, { ...file, ...patch })).rejects.toThrow();
  }
  expect(http).not.toHaveBeenCalled();
});

test('rejects every privacy, ownership, parent, marker or content mismatch', async () => {
  for (const filePatch of [{ id: 'another_file' }, { mimeType: 'text/plain' }, { size: String(file.size + 1) }, { md5Checksum: '0'.repeat(32) },
    { sha256Checksum: '0'.repeat(64) }, { trashed: true }, { shared: true }, { ownedByMe: false }, { driveId: 'shared_drive' },
    { parents: [] }, { parents: ['other_folder'] }, { parents: [file.folderId, 'another_folder'] }, { owners: [] },
    { owners: [{ permissionId: 'other_owner' }] }, { owners: [...metadata.owners, ...metadata.owners] },
    { permissions: [] }, { permissions: [...metadata.permissions, { id: 'public', type: 'anyone', role: 'reader' }] },
    { permissions: [{ id: account.permissionId, type: 'user', role: 'writer' }] },
    { permissions: [{ id: account.permissionId, type: 'user', role: 'owner', deleted: true }] },
    { permissions: [{ id: account.permissionId, type: 'user', role: 'owner', pendingOwner: true }] },
    { appProperties: {} }, { appProperties: { justkvizMedia: 'v1', justkvizSha256: '0'.repeat(64) } }]) {
    const { files, http } = fixture({ filePatch });
    await expect(files.download('token', account, file)).rejects.toBeInstanceOf(DriveProviderError);
    expect(http.mock.calls.some(([url]) => requestUrl(url).includes('alt=media'))).toBe(false);
  }
});

test('revalidates folder privacy before creating an upload session and before private downloads', async () => {
  for (const folderPatch of [{ shared: true }, { ownedByMe: false }, { trashed: true }, { capabilities: { canAddChildren: false } },
    { permissions: [...folder.permissions, { id: 'public', type: 'anyone', role: 'reader' }] }]) {
    const { files, http } = fixture({ folderPatch });
    await expect(files.upload('token', input)).rejects.toThrow();
    expect(http).toHaveBeenCalledTimes(1);
  }
});

test('rejects an attacker-controlled resumable session destination before sending bytes or bearer token there', async () => {
  for (const location of ['https://evil.invalid/upload', 'http://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=x',
    'https://www.googleapis.com.evil.invalid/upload/drive/v3/files?uploadType=resumable&upload_id=x',
    'https://token@www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=x',
    'https://www.googleapis.com/drive/v3/files?uploadType=resumable&upload_id=x',
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', session + '#fragment']) {
    const { files, http } = fixture({ location });
    await expect(files.upload('token', input)).rejects.toBeInstanceOf(DriveProviderError);
    expect(http.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
  }
});

test('private download returns exact verified bytes, rechecks after IO and rejects changed/truncated bytes', async () => {
  const { files, http } = fixture();
  await expect(files.download('token', account, file)).resolves.toEqual(bytes);
  expect(http.mock.calls.filter(([url]) => requestUrl(url).includes('alt=media'))).toHaveLength(1);
  expect(http).toHaveBeenCalledTimes(5);
  for (const body of [Buffer.from('different'), Buffer.alloc(bytes.length), bytes.subarray(0, -1)]) {
    await expect(fixture({ body }).files.download('token', account, file)).rejects.toBeInstanceOf(DriveProviderError);
  }
  const changed = fixture();
  changed.http.mockImplementationOnce(() => Promise.resolve(json(folder))).mockImplementationOnce(() => Promise.resolve(json(metadata)))
    .mockImplementationOnce(() => Promise.resolve(new Response(bytes))).mockImplementationOnce(() => Promise.resolve(json({ ...folder, shared: true })));
  await expect(changed.files.download('token', account, file)).rejects.toThrow();
});

test('verifies live folder and file concurrently while retaining both checks before byte download', async () => {
  const pending = new Map<string, (response: Response) => void>();
  const http = vi.fn<typeof fetch>(url => new Promise(resolve => { pending.set(new URL(requestUrl(url)).pathname, resolve); }));
  const files = new GoogleDriveFiles(http, environment);
  const verified = files.verify('token', account, file);
  expect(http).toHaveBeenCalledTimes(2);
  expect(pending.has('/drive/v3/files/' + file.folderId)).toBe(true);
  expect(pending.has('/drive/v3/files/' + file.id)).toBe(true);
  pending.get('/drive/v3/files/' + file.id)!(json(metadata));
  pending.get('/drive/v3/files/' + file.folderId)!(json(folder));
  await expect(verified).resolves.toEqual(file);
  for (const [url] of http.mock.calls) expect(new URL(requestUrl(url)).searchParams.has('alt')).toBe(false);
  await expect(fixture({ folderPatch: { shared: true } }).files.download('token', account, file)).rejects.toThrow();
});

test('stream size limit cancels dishonest bodies independently of Content-Length', async () => {
  const cancel = vi.fn();
  const { files } = fixture({ mediaResponse: () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(Buffer.alloc(bytes.length + 1)); }, cancel,
  })) });
  await expect(files.download('token', account, file)).rejects.toThrow();
  expect(cancel).toHaveBeenCalled();
  await expect(fixture({ mediaResponse: () => new Response(bytes, { headers: { 'Content-Length': String(bytes.length + 1) } }) })
    .files.download('token', account, file)).rejects.toThrow();
});

test('bounds metadata responses, malformed responses and generation results', async () => {
  for (const response of [() => new Response('x'.repeat(65_537)), () => new Response('invalid-json'),
    () => json({ ids: [] }), () => json({ ids: ['../bad'] }), () => json({ ids: ['valid_id', 'second_id'] })]) {
    const files = new GoogleDriveFiles(vi.fn(() => Promise.resolve(response())), environment);
    await expect(files.generateId('token')).rejects.toBeInstanceOf(DriveProviderError);
  }
});

test('emulators cannot call real Drive and provider failures never expose tokens or raw responses', async () => {
  const http = vi.fn<typeof fetch>(() => Promise.resolve(new Response('PRIVATE RESPONSE', { status: 401 })));
  const local = new GoogleDriveFiles(http, { GCLOUD_PROJECT: 'demo-filmovy-kviz-v2', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' });
  await expect(local.generateId('secret-token')).rejects.toThrow();
  expect(http).not.toHaveBeenCalled();
  const cloud = new GoogleDriveFiles(http, environment);
  await expect(cloud.generateId('secret-token')).rejects.toMatchObject({ reauthorization: true, message: 'Připojení Disku není nyní dostupné.' });
  const network = new GoogleDriveFiles(vi.fn(() => Promise.reject(new Error('secret-token PRIVATE RESPONSE'))), environment);
  await expect(network.generateId('secret-token')).rejects.toMatchObject({ reauthorization: false, message: 'Připojení Disku není nyní dostupné.' });
  const failedUpload = fixture({ putStatus: 403 });
  await expect(failedUpload.files.upload('token', input)).rejects.toThrow();
});

test('timeouts cover both a stalled fetch and stalled response stream', async () => {
  const stalled = new GoogleDriveFiles(vi.fn(() => new Promise<Response>(() => {})), environment, 5);
  await expect(stalled.generateId('token')).rejects.toBeInstanceOf(DriveProviderError);
  const cancel = vi.fn();
  const stream = new GoogleDriveFiles(vi.fn(() => Promise.resolve(new Response(new ReadableStream({ cancel })))), environment, 5);
  await expect(stream.generateId('token')).rejects.toBeInstanceOf(DriveProviderError);
  expect(cancel).toHaveBeenCalled();
});
