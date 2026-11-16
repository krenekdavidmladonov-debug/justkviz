import { createHash, randomBytes } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import type { TokenEnvelope } from '../email/token-vault.js';
import { DRIVE_SCOPE, type DriveConfiguration } from './config.js';
import { boundedString, DriveProviderError, folderId, type DriveAccount, type DriveFolder, type DriveProvider } from './provider.js';

export interface DriveConnection {
  revision: number;
  generation: number;
  refreshToken?: TokenEnvelope;
  account?: DriveAccount;
  folder?: DriveFolder;
  /** Private retry reservation; persisted before app-created folder IO. */
  folderCreation?: { id: string };
  reauthorizationRequired?: boolean;
  revokingUntil?: number;
}
export interface DriveOAuthState {
  uid: string;
  membershipVersion: number;
  revision: number;
  generation: number;
  expiresAt: number;
  verifier: TokenEnvelope;
  consumed: boolean;
}
export interface DriveView {
  membershipVersion: number;
  connection: DriveConnection;
  state?: DriveOAuthState;
  writeConnection(connection: DriveConnection): void;
  writeState(state: DriveOAuthState): void;
  audit(kind: 'drive-connect-begin' | 'drive-connect-complete' | 'drive-folder-selected' | 'drive-disconnect'): void;
}
/** Implementations must reauthorize the current owner inside every transaction. */
export interface DriveStore { run<T>(stateHash: string | undefined, handler: (view: DriveView) => T): Promise<T> }
export interface DriveStatus {
  configured: boolean;
  status: 'not-configured' | 'disconnected' | 'folder-required' | 'connected' | 'reauthorization-required';
  accountEmail?: string;
  folder?: DriveFolder;
  message?: string;
}
export function driveStatus(configured: boolean, connection: DriveConnection): DriveStatus {
  if (!configured) return { configured: false, status: 'not-configured', message: 'Připojení Disku zatím není nakonfigurované.' };
  if (!connection.refreshToken || !connection.account) return { configured: true, status: 'disconnected' };
  if (connection.reauthorizationRequired) return { configured: true, status: 'reauthorization-required', accountEmail: connection.account.email };
  return { configured: true, status: connection.folder ? 'connected' : 'folder-required', accountEmail: connection.account.email,
    ...(connection.folder ? { folder: { id: connection.folder.id, name: connection.folder.name, url: connection.folder.url } } : {}) };
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const stale = () => new HttpsError('aborted', 'Připojení se změnilo. Spusťte připojení znovu.');
const context = (uid: string, kind: string, binding: string) => `justkviz-drive:v1:${uid}:${kind}:${binding}`;
export class DriveConnectionService {
  constructor(private readonly uid: string, private readonly store: DriveStore,
    private readonly config: DriveConfiguration | undefined, private readonly provider: DriveProvider,
    private readonly now: () => number = Date.now) {}
  private requireConfig(): DriveConfiguration {
    if (!this.config) throw new HttpsError('failed-precondition', 'Připojení Disku není nakonfigurované.');
    return this.config;
  }
  read(): Promise<DriveStatus> { return this.store.run(undefined, view => driveStatus(!!this.config, view.connection)); }
  async begin(): Promise<{ authorizationUrl: string; state: string }> {
    const config = this.requireConfig(), state = randomBytes(32).toString('base64url'), digest = hash(state);
    const verifier = randomBytes(32).toString('base64url'), challenge = createHash('sha256').update(verifier).digest('base64url');
    await this.store.run(digest, view => {
      if ((view.connection.revokingUntil ?? 0) > this.now()) throw new HttpsError('failed-precondition', 'Odpojení Disku ještě probíhá. Zkuste to za chvíli.');
      const connection = { ...view.connection, revision: view.connection.revision + 1 };
      view.writeConnection(connection);
      view.audit('drive-connect-begin');
      view.writeState({ uid: this.uid, membershipVersion: view.membershipVersion, revision: connection.revision,
        generation: connection.generation, expiresAt: this.now() + 600_000, consumed: false,
        verifier: config.vault.seal(verifier, context(this.uid, 'pkce', digest)) });
    });
    const query = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri,
      response_type: 'code', scope: DRIVE_SCOPE, access_type: 'offline', prompt: 'consent',
      include_granted_scopes: 'false', state, code_challenge: challenge, code_challenge_method: 'S256' });
    return { authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?' + query.toString(), state };
  }
  async complete(codeInput: unknown, stateInput: unknown): Promise<DriveStatus> {
    const config = this.requireConfig(), code = boundedString(codeInput, 4096), state = boundedString(stateInput, 43);
    if (!/^[a-zA-Z0-9_-]{43}$/u.test(state)) throw new HttpsError('invalid-argument', 'Neplatné ověření připojení.');
    const digest = hash(state);
    // Consume before Google IO, so a failed exchange and concurrent requests cannot replay it.
    const pending = await this.store.run(digest, view => {
      const saved = view.state;
      if (!saved || saved.uid !== this.uid || saved.membershipVersion !== view.membershipVersion || saved.consumed
        || saved.expiresAt <= this.now() || saved.expiresAt > this.now() + 600_000
        || saved.revision !== view.connection.revision || saved.generation !== view.connection.generation) throw stale();
      view.writeState({ ...saved, consumed: true });
      return saved;
    });
    try {
      const token = await this.provider.exchange(code, config.vault.open(pending.verifier, context(this.uid, 'pkce', digest)));
      if (!token.refreshToken) throw new DriveProviderError(true);
      const account = await this.provider.account(token.accessToken);
      return await this.store.run(undefined, view => {
        if (view.membershipVersion !== pending.membershipVersion || view.connection.revision !== pending.revision
          || view.connection.generation !== pending.generation) throw stale();
        const next: DriveConnection = { revision: pending.revision + 1, generation: pending.generation,
          refreshToken: config.vault.seal(token.refreshToken!, context(this.uid, 'refresh', String(pending.generation))), account };
        view.writeConnection(next);
        view.audit('drive-connect-complete');
        return driveStatus(true, next);
      });
    } catch (error) { throw this.safeError(error); }
  }
  private async credentials(): Promise<{ connection: DriveConnection; membershipVersion: number; refreshToken: string }> {
    const config = this.requireConfig();
    return this.store.run(undefined, view => {
      if (!view.connection.refreshToken || !view.connection.account || view.connection.reauthorizationRequired) {
        throw new HttpsError('failed-precondition', 'Nejdříve připojte Disk.');
      }
      return { connection: view.connection, membershipVersion: view.membershipVersion,
        refreshToken: config.vault.open(view.connection.refreshToken, context(this.uid, 'refresh', String(view.connection.generation))) };
    });
  }
  private same(view: DriveView, snapshot: { connection: DriveConnection; membershipVersion: number }): void {
    if (view.membershipVersion !== snapshot.membershipVersion || view.connection.revision !== snapshot.connection.revision
      || view.connection.generation !== snapshot.connection.generation) throw stale();
  }
  private async providerFailure(error: unknown, snapshot: { connection: DriveConnection; membershipVersion: number }): Promise<never> {
    if (error instanceof DriveProviderError && error.reauthorization) {
      await this.store.run(undefined, view => { this.same(view, snapshot);
        view.writeConnection({ ...view.connection, revision: view.connection.revision + 1, reauthorizationRequired: true });
      });
    }
    throw this.safeError(error);
  }
  private safeError(error: unknown): HttpsError {
    return error instanceof HttpsError ? error : new HttpsError('unavailable', 'Připojení Disku není nyní dostupné. Zkuste připojení znovu.');
  }
  async picker(): Promise<{ accessToken: string; expiresAt: number; developerKey: string; appId: string; suggestedFolderName: string }> {
    const config = this.requireConfig(), snapshot = await this.credentials();
    try {
      const token = await this.provider.refresh(snapshot.refreshToken), expiresAt = this.now() + token.expiresIn * 1000;
      return await this.store.run(undefined, view => {
        this.same(view, snapshot);
        // Persist a rotated refresh token only as ciphertext, while serializing against disconnect.
        if (token.refreshToken) view.writeConnection({ ...view.connection, revision: view.connection.revision + 1,
          refreshToken: config.vault.seal(token.refreshToken, context(this.uid, 'refresh', String(view.connection.generation))) });
        return { accessToken: token.accessToken, expiresAt, developerKey: config.developerKey, appId: config.appId, suggestedFolderName: 'JustKvíz – média' };
      });
    } catch (error) { return this.providerFailure(error, snapshot); }
  }
  async select(folderInput: unknown): Promise<DriveStatus> {
    const config = this.requireConfig(), id = folderId(folderInput), snapshot = await this.credentials();
    try {
      const token = await this.provider.refresh(snapshot.refreshToken);
      const account = await this.provider.account(token.accessToken);
      if (account.permissionId !== snapshot.connection.account!.permissionId || account.email !== snapshot.connection.account!.email) throw new DriveProviderError(true);
      const folder = await this.provider.folder(token.accessToken, id, account);
      return await this.store.run(undefined, view => {
        this.same(view, snapshot);
        const next = { ...view.connection, revision: view.connection.revision + 1, folder,
          ...(token.refreshToken ? { refreshToken: config.vault.seal(token.refreshToken, context(this.uid, 'refresh', String(view.connection.generation))) } : {}) };
        view.writeConnection(next);
        view.audit('drive-folder-selected');
        return driveStatus(true, next);
      });
    } catch (error) { return this.providerFailure(error, snapshot); }
  }
  async createFolder(): Promise<DriveStatus> {
    const config = this.requireConfig();
    let snapshot = await this.credentials();
    // This fallback never replaces a folder that the owner already selected.
    if (snapshot.connection.folder) return driveStatus(true, snapshot.connection);
    try {
      const token = await this.provider.refresh(snapshot.refreshToken);
      const account = await this.provider.account(token.accessToken);
      if (account.permissionId !== snapshot.connection.account!.permissionId || account.email !== snapshot.connection.account!.email) throw new DriveProviderError(true);
      const id = folderId(snapshot.connection.folderCreation?.id ?? await this.provider.generateFolderId(token.accessToken));
      snapshot = await this.store.run(undefined, view => {
        this.same(view, snapshot);
        if (view.connection.folder) throw stale();
        const next: DriveConnection = { ...view.connection, revision: view.connection.revision + 1, folderCreation: { id },
          ...(token.refreshToken ? { refreshToken: config.vault.seal(token.refreshToken, context(this.uid, 'refresh', String(view.connection.generation))) } : {}) };
        view.writeConnection(next);
        return { ...snapshot, connection: next, membershipVersion: view.membershipVersion };
      });
      const folder = await this.provider.createMediaFolder(token.accessToken, id, account);
      if (folder.id !== id) throw new DriveProviderError(false);
      return await this.store.run(undefined, view => {
        this.same(view, snapshot);
        if (view.connection.folder || view.connection.folderCreation?.id !== id) throw stale();
        const next: DriveConnection = { ...view.connection, revision: view.connection.revision + 1, folder };
        delete next.folderCreation;
        view.writeConnection(next);
        view.audit('drive-folder-selected');
        return driveStatus(true, next);
      });
    } catch (error) { return this.providerFailure(error, snapshot); }
  }
  async disconnect(): Promise<DriveStatus> {
    // Credentials are removed first even when OAuth config is incomplete or Google is unavailable.
    const prior = await this.store.run(undefined, view => {
      const previous = view.connection;
      // A bounded lease prevents another tab reconnecting while old grant revocation is in flight.
      view.writeConnection({ revision: previous.revision + 1, generation: previous.generation + 1, revokingUntil: this.now() + 60_000 });
      view.audit('drive-disconnect');
      return previous;
    });
    if (prior.refreshToken && this.config) {
      try { await this.provider.revoke(this.config.vault.open(prior.refreshToken, context(this.uid, 'refresh', String(prior.generation)))); }
      catch { /* Local invalidation succeeds independently of best-effort provider revocation. */ }
    }
    return this.store.run(undefined, view => {
      if (view.connection.revision === prior.revision + 1 && view.connection.generation === prior.generation + 1) {
        const next = { revision: view.connection.revision, generation: view.connection.generation };
        view.writeConnection(next);
        return driveStatus(!!this.config, next);
      }
      return driveStatus(!!this.config, view.connection);
    });
  }
}
