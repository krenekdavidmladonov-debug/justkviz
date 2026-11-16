import { createHash } from 'node:crypto';
import { requireRealDriveRuntime } from './config.js';
import { boundedString, DriveProviderError, folderId, parseDriveFolder, type DriveAccount } from './provider.js';

export const MAX_DRIVE_FILE_BYTES = 25 * 1024 * 1024;
const MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'audio/mpeg', 'audio/wav', 'video/mp4', 'video/webm']);
const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FILE_FIELDS = 'id,mimeType,size,md5Checksum,sha256Checksum,parents,trashed,ownedByMe,shared,driveId,owners(permissionId),permissions(id,type,role,deleted,pendingOwner),appProperties';
const FOLDER_FIELDS = 'id,name,mimeType,trashed,ownedByMe,shared,driveId,capabilities(canAddChildren),owners(permissionId),permissions(id,type,role,deleted,pendingOwner)';
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const digest = (algorithm: string, bytes: Uint8Array) => createHash(algorithm).update(bytes).digest('hex');
function fail(): never { throw new DriveProviderError(false); }

/** Private server binding, never a public playback URL or browser-supplied authority. */
export interface DriveFileReference {
  id: string;
  folderId: string;
  mimeType: string;
  size: number;
  md5Checksum: string;
  sha256: string;
}
export interface DriveFileUpload {
  /** Persist the pre-generated ID before IO; reuse it for retries. */
  id: string;
  folderId: string;
  account: DriveAccount;
  name: string;
  mimeType: string;
  bytes: Uint8Array;
}
export interface DriveFiles {
  generateId: (accessToken: string) => Promise<string>;
  upload: (accessToken: string, input: DriveFileUpload) => Promise<DriveFileReference>;
  verify: (accessToken: string, account: DriveAccount, file: DriveFileReference) => Promise<DriveFileReference>;
  download: (accessToken: string, account: DriveAccount, file: DriveFileReference) => Promise<Buffer>;
}
function validateReference(file: DriveFileReference): void {
  folderId(file.id); folderId(file.folderId);
  if (!MIME_TYPES.has(file.mimeType) || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_DRIVE_FILE_BYTES
    || !/^[a-f0-9]{32}$/u.test(file.md5Checksum) || !/^[a-f0-9]{64}$/u.test(file.sha256)) fail();
}
function parseFile(data: Record<string, unknown>, account: DriveAccount, expected: DriveFileReference): DriveFileReference {
  const owners = data.owners, permissions = data.permissions, parents = data.parents, properties = object(data.appProperties);
  if (data.id !== expected.id || data.mimeType !== expected.mimeType || data.size !== String(expected.size)
    || data.md5Checksum !== expected.md5Checksum || (data.sha256Checksum !== undefined && data.sha256Checksum !== expected.sha256)
    || data.trashed !== false || data.ownedByMe !== true || data.shared !== false || data.driveId !== undefined
    || !Array.isArray(parents) || parents.length !== 1 || parents[0] !== expected.folderId
    || !Array.isArray(owners) || owners.length !== 1 || object(owners[0]).permissionId !== account.permissionId
    || !Array.isArray(permissions) || permissions.length !== 1
    || properties.justkvizMedia !== 'v1' || properties.justkvizSha256 !== expected.sha256) fail();
  const permission = object(permissions[0]);
  if (permission.id !== account.permissionId || permission.type !== 'user' || permission.role !== 'owner'
    || permission.deleted === true || permission.pendingOwner === true) fail();
  return { id: expected.id, folderId: expected.folderId, mimeType: expected.mimeType,
    size: expected.size, md5Checksum: expected.md5Checksum, sha256: expected.sha256 };
}

/** Transport only. The caller must authorize current membership/scope and pin the connection before and after IO. */
export class GoogleDriveFiles implements DriveFiles {
  constructor(private readonly http: typeof fetch = fetch, private readonly environment: NodeJS.ProcessEnv = process.env,
    private readonly timeoutMillis = 60_000) {}

  private async request<T>(url: string, accessToken: string, init: RequestInit, maximum: number,
    handle: (response: Response, bytes: Buffer) => T): Promise<T> {
    requireRealDriveRuntime(this.environment);
    // Every destination is constructed here or validated as a Google resumable session.
    if (!/^[\x21-\x7e]{1,8192}$/u.test(accessToken)) fail();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      return await Promise.race([
        (async () => {
          const response = await this.http(url, { ...init, headers: { ...init.headers, Authorization: 'Bearer ' + accessToken },
            redirect: 'error', signal: controller.signal });
          if (response.status === 401) throw new DriveProviderError(true);
          const length = response.headers.get('content-length');
          if (length !== null && (!/^\d+$/u.test(length) || Number(length) > maximum)) fail();
          reader = response.body?.getReader();
          const chunks: Uint8Array[] = [];
          let size = 0;
          if (reader) while (true) {
            const next = await reader.read();
            if (next.done) break;
            if (!(next.value instanceof Uint8Array)) fail();
            size += next.value.byteLength;
            if (size > maximum) fail();
            chunks.push(next.value);
          }
          return handle(response, Buffer.concat(chunks, size));
        })(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new DriveProviderError(false)); }, this.timeoutMillis);
        }),
      ]);
    } catch (error) {
      controller.abort();
      // Do not wait for an uncooperative upstream stream to acknowledge cancellation.
      if (reader) void reader.cancel().catch(() => {});
      if (error instanceof DriveProviderError) throw error;
      throw new DriveProviderError(false);
    } finally { if (timer) clearTimeout(timer); }
  }
  private json(url: string, token: string): Promise<Record<string, unknown>> {
    return this.request(url, token, {}, 65_536, (response, bytes) => {
      if (response.status !== 200) fail();
      return object(JSON.parse(bytes.toString('utf8')));
    });
  }
  private async folder(token: string, id: string, account: DriveAccount): Promise<void> {
    const data = await this.json(API + '/' + folderId(id) + '?fields=' + encodeURIComponent(FOLDER_FIELDS), token);
    try { parseDriveFolder(data, id, account); } catch { fail(); }
  }
  async generateId(token: string): Promise<string> {
    const data = await this.json(API + '/generateIds?count=1&space=drive&type=files', token);
    if (!Array.isArray(data.ids) || data.ids.length !== 1) fail();
    try { return folderId(data.ids[0]); } catch { return fail(); }
  }
  async verify(token: string, account: DriveAccount, file: DriveFileReference): Promise<DriveFileReference> {
    validateReference(file);
    // Both checks use the same pinned account/reference and must pass before any bytes are used.
    const [, metadata] = await Promise.all([
      this.folder(token, file.folderId, account),
      this.json(API + '/' + file.id + '?fields=' + encodeURIComponent(FILE_FIELDS), token),
    ]);
    return parseFile(metadata, account, file);
  }
  async upload(token: string, input: DriveFileUpload): Promise<DriveFileReference> {
    folderId(input.id); folderId(input.folderId);
    const name = boundedString(input.name, 255);
    if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength < 1 || input.bytes.byteLength > MAX_DRIVE_FILE_BYTES
      || !MIME_TYPES.has(input.mimeType)) fail();
    // Own the bounded buffer: the caller cannot change content while requests are in flight.
    const bytes = Buffer.from(input.bytes);
    const file: DriveFileReference = { id: input.id, folderId: input.folderId, mimeType: input.mimeType,
      size: bytes.byteLength, md5Checksum: digest('md5', bytes), sha256: digest('sha256', bytes) };
    await this.folder(token, file.folderId, input.account);
    const session = await this.request(UPLOAD + '?uploadType=resumable', token, { method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': file.mimeType, 'X-Upload-Content-Length': String(file.size) },
      body: JSON.stringify({ id: file.id, name, mimeType: file.mimeType, parents: [file.folderId],
        appProperties: { justkvizMedia: 'v1', justkvizSha256: file.sha256 } }),
    }, 65_536, response => {
      if (response.status === 409) return undefined;
      if (response.status !== 200) fail();
      const location = response.headers.get('location');
      if (!location || location.length > 8192) fail();
      const url = new URL(location);
      if (url.origin !== 'https://www.googleapis.com' || url.pathname !== '/upload/drive/v3/files'
        || url.username || url.password || url.hash || url.searchParams.get('uploadType') !== 'resumable'
        || !url.searchParams.get('upload_id')) fail();
      return url.href;
    });
    if (session) await this.request(session, token, { method: 'PUT',
      headers: { 'Content-Type': file.mimeType, 'Content-Length': String(file.size) }, body: bytes,
    }, 65_536, response => { if (response.status !== 200 && response.status !== 201 && response.status !== 409) fail(); });
    // A replay conflict is accepted only if the already-created file still matches every binding.
    return this.verify(token, input.account, file);
  }
  async download(token: string, account: DriveAccount, file: DriveFileReference): Promise<Buffer> {
    await this.verify(token, account, file);
    const bytes = await this.request(API + '/' + file.id + '?alt=media', token, {}, file.size, (response, body) => {
      if (response.status !== 200 || body.byteLength !== file.size || digest('md5', body) !== file.md5Checksum
        || digest('sha256', body) !== file.sha256) fail();
      return body;
    });
    // External edits/moves/sharing during download must not satisfy a stale private binding.
    await this.verify(token, account, file);
    return bytes;
  }
}
