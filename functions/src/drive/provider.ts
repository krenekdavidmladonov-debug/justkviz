import { HttpsError } from 'firebase-functions/v2/https';
import { DRIVE_SCOPE, requireRealDriveRuntime, type DriveConfiguration } from './config.js';

export interface DriveToken { accessToken: string; refreshToken?: string; expiresIn: number }
export interface DriveAccount { email: string; permissionId: string }
export interface DriveFolder { id: string; name: string; url: string }
export const DRIVE_MEDIA_FOLDER_NAME = 'JustKvíz – média aplikace';
export interface DriveProvider {
  exchange: (code: string, verifier: string) => Promise<DriveToken>;
  refresh: (refreshToken: string) => Promise<DriveToken>;
  account: (accessToken: string) => Promise<DriveAccount>;
  folder: (accessToken: string, folderId: string, account: DriveAccount) => Promise<DriveFolder>;
  generateFolderId: (accessToken: string) => Promise<string>;
  createMediaFolder: (accessToken: string, folderId: string, account: DriveAccount) => Promise<DriveFolder>;
  revoke: (token: string) => Promise<void>;
}
export class DriveProviderError extends Error {
  constructor(readonly reauthorization: boolean) { super('Připojení Disku není nyní dostupné.'); }
}
export function boundedString(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || !value || value.length > maximum
    || [...value].some(point => point.charCodeAt(0) < 32 || point.charCodeAt(0) === 127)) throw new HttpsError('invalid-argument', 'Neplatná hodnota pro připojení Disku.');
  return value;
}
export function folderId(value: unknown): string {
  const id = boundedString(value, 200);
  if (!/^[a-zA-Z0-9_-]{5,200}$/u.test(id)) throw new HttpsError('invalid-argument', 'Neplatná složka.');
  return id;
}
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function parseDriveToken(data: Record<string, unknown>): DriveToken {
  const accessToken = boundedString(data.access_token, 8192);
  if (!/^[\x21-\x7e]+$/u.test(accessToken) || data.token_type !== 'Bearer'
    || !Number.isSafeInteger(data.expires_in) || (data.expires_in as number) < 60 || (data.expires_in as number) > 3600
    || data.scope !== DRIVE_SCOPE) throw new DriveProviderError(false);
  const refreshToken = data.refresh_token === undefined ? undefined : boundedString(data.refresh_token, 8192);
  return { accessToken, ...(refreshToken ? { refreshToken } : {}), expiresIn: data.expires_in as number };
}
export function parseDriveAccount(data: Record<string, unknown>): DriveAccount {
  const user = object(data.user), email = boundedString(user.emailAddress, 254), permissionId = boundedString(user.permissionId, 200);
  // This integration is deliberately restricted to a personal Google account.
  if (!/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:gmail|googlemail)\.com$/u.test(email)
    || !/^[a-zA-Z0-9_-]{1,200}$/u.test(permissionId)) throw new DriveProviderError(false);
  return { email, permissionId };
}
export function parseDriveFolder(data: Record<string, unknown>, requestedId: string, account: DriveAccount): DriveFolder {
  const capabilities = object(data.capabilities), permissions = data.permissions, owners = data.owners;
  if (data.id !== requestedId || data.mimeType !== 'application/vnd.google-apps.folder' || data.trashed !== false
    || data.ownedByMe !== true || data.shared !== false || data.driveId !== undefined || capabilities.canAddChildren !== true
    || !Array.isArray(owners) || owners.length !== 1 || object(owners[0]).permissionId !== account.permissionId
    || !Array.isArray(permissions) || permissions.length !== 1) throw new HttpsError('failed-precondition', 'Vyberte vlastní soukromou složku bez sdílení.');
  const permission = object(permissions[0]);
  if (permission.type !== 'user' || permission.role !== 'owner' || permission.id !== account.permissionId
    || permission.deleted === true || permission.pendingOwner === true) throw new HttpsError('failed-precondition', 'Vyberte vlastní soukromou složku bez sdílení.');
  const name = boundedString(data.name, 255);
  return { id: requestedId, name, url: 'https://drive.google.com/drive/folders/' + requestedId };
}

export class GoogleDriveProvider implements DriveProvider {
  constructor(private readonly config: DriveConfiguration, private readonly http: typeof fetch = fetch,
    private readonly environment: NodeJS.ProcessEnv = process.env, private readonly timeoutMillis = 15_000) {}
  private async request(url: string, init: RequestInit, empty = false, allowConflict = false): Promise<Record<string, unknown>> {
    requireRealDriveRuntime(this.environment);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async () => {
          const response = await this.http(url, { ...init, redirect: 'error', signal: controller.signal });
          // Bound the whole response including streaming bodies before parsing it.
          const reader = response.body?.getReader();
          let text = '', bytes = 0;
          if (reader) {
            const chunks: Uint8Array[] = [];
            while (true) {
              const next = await reader.read();
              if (next.done) break;
              const chunk: unknown = next.value;
              if (!(chunk instanceof Uint8Array)) throw new DriveProviderError(false);
              bytes += chunk.byteLength;
              if (bytes > 65_536) { await reader.cancel(); throw new DriveProviderError(false); }
              chunks.push(chunk);
            }
            text = Buffer.concat(chunks).toString('utf8');
          }
          let data: Record<string, unknown> = {};
          try { data = object(JSON.parse(text)); } catch { if (response.ok && !empty) throw new DriveProviderError(false); }
          if (!response.ok && !(allowConflict && response.status === 409)) throw new DriveProviderError(response.status === 401 || data.error === 'invalid_grant');
          return data;
        })(),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new DriveProviderError(false)); }, this.timeoutMillis); }),
      ]);
    } catch (error) {
      if (error instanceof DriveProviderError) throw error;
      throw new DriveProviderError(false);
    } finally { if (timer) clearTimeout(timer); }
  }
  private async token(values: Record<string, string>): Promise<DriveToken> {
    try {
      return parseDriveToken(await this.request('https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: this.config.clientId, client_secret: this.config.clientSecret, ...values }).toString(),
      }));
    } catch (error) { if (error instanceof DriveProviderError) throw error; throw new DriveProviderError(false); }
  }
  exchange(code: string, verifier: string) { return this.token({ code, code_verifier: verifier, redirect_uri: this.config.redirectUri, grant_type: 'authorization_code' }); }
  refresh(refreshToken: string) { return this.token({ refresh_token: refreshToken, grant_type: 'refresh_token' }); }
  async account(accessToken: string): Promise<DriveAccount> {
    return parseDriveAccount(await this.request('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,permissionId)', { headers: { Authorization: 'Bearer ' + accessToken } }));
  }
  async folder(accessToken: string, requestedId: string, account: DriveAccount): Promise<DriveFolder> {
    const id = folderId(requestedId);
    const fields = 'id,name,mimeType,trashed,ownedByMe,shared,driveId,capabilities(canAddChildren),owners(permissionId),permissions(id,type,role,deleted,pendingOwner)';
    const data = await this.request('https://www.googleapis.com/drive/v3/files/' + id + '?fields=' + encodeURIComponent(fields), { headers: { Authorization: 'Bearer ' + accessToken } });
    return parseDriveFolder(data, id, account);
  }
  async generateFolderId(accessToken: string): Promise<string> {
    const data = await this.request('https://www.googleapis.com/drive/v3/files/generateIds?count=1&space=drive&type=files',
      { headers: { Authorization: 'Bearer ' + accessToken } });
    try {
      if (!Array.isArray(data.ids) || data.ids.length !== 1) throw new DriveProviderError(false);
      return folderId(data.ids[0]);
    } catch { throw new DriveProviderError(false); }
  }
  async createMediaFolder(accessToken: string, requestedId: string, account: DriveAccount): Promise<DriveFolder> {
    const id = folderId(requestedId), headers = { Authorization: 'Bearer ' + accessToken };
    // Only create; an existing pre-generated ID is never overwritten or repurposed.
    await this.request('https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ id, name: DRIVE_MEDIA_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder',
        appProperties: { justkvizMediaFolder: 'v1' } }),
    }, false, true);
    const fields = 'id,name,mimeType,trashed,ownedByMe,shared,driveId,capabilities(canAddChildren),owners(permissionId),permissions(id,type,role,deleted,pendingOwner),appProperties';
    const data = await this.request('https://www.googleapis.com/drive/v3/files/' + id + '?fields=' + encodeURIComponent(fields), { headers });
    if (object(data.appProperties).justkvizMediaFolder !== 'v1') throw new DriveProviderError(false);
    return parseDriveFolder(data, id, account);
  }
  async revoke(token: string): Promise<void> {
    await this.request('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }).toString() }, true);
  }
}
