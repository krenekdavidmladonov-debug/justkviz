import { expect, test, vi } from 'vitest';
import { createTokenVault } from '../functions/src/email/token-vault';
import { CALLBACK_PATH, DRIVE_SCOPE, driveConfiguration, driveKeyring, type DriveConfiguration } from '../functions/src/drive/config';
import { DRIVE_MEDIA_FOLDER_NAME, DriveProviderError, GoogleDriveProvider, parseDriveAccount, parseDriveFolder, parseDriveToken, type DriveProvider } from '../functions/src/drive/provider';
import { DriveConnectionService, type DriveConnection, type DriveOAuthState, type DriveStore } from '../functions/src/drive/service';

const account = { email: 'owner@gmail.com', permissionId: 'owner_permission' };
const selectedFolder = { id: 'private_folder', name: 'JustKvíz – média', url: 'https://drive.google.com/drive/folders/private_folder' };
const config: DriveConfiguration = { clientId: '123456789012-client.apps.googleusercontent.com', clientSecret: 'synthetic-client-secret',
  redirectUri: 'https://justkviz-v2.web.app' + CALLBACK_PATH, developerKey: 'synthetic_public_picker_key', appId: '123456789012',
  vault: createTokenVault('drive-test', Buffer.alloc(32, 41)) };
const keyring = JSON.stringify({ activeKeyId: 'current', keys: { current: Buffer.alloc(32, 41).toString('base64') } });
const environment = { GCLOUD_PROJECT: 'filmovy-kviz-v2-staging', DRIVE_CONNECTION_ENABLED: 'true', DRIVE_OAUTH_CLIENT_ID: config.clientId,
  DRIVE_OAUTH_REDIRECT_URI: config.redirectUri, DRIVE_PICKER_API_KEY: config.developerKey, DRIVE_PICKER_APP_ID: config.appId };
const secrets = { clientSecret: config.clientSecret, keyring };
function fixture() {
  let connection: DriveConnection = { revision: 0, generation: 0 }, version = 1, allowed = true, time = 1000;
  const states = new Map<string, DriveOAuthState>(), audit: string[] = [];
  const store: DriveStore = { run: async (digest, handler) => {
    await Promise.resolve();
    if (!allowed) throw new Error('access revoked');
    const copy = structuredClone(connection), current = digest ? structuredClone(states.get(digest)) : undefined;
    let changed: DriveConnection | undefined, state: DriveOAuthState | undefined;
    const result = handler({ membershipVersion: version, connection: copy, state: current,
      writeConnection: next => { changed = structuredClone(next); }, writeState: next => { state = structuredClone(next); }, audit: kind => { audit.push(kind); } });
    if (changed) connection = changed;
    if (digest && state) states.set(digest, state);
    return result;
  } };
  const provider: DriveProvider = { exchange: vi.fn(() => Promise.resolve({ accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh', expiresIn: 3600 })),
    refresh: vi.fn(() => Promise.resolve({ accessToken: 'picker-access', expiresIn: 3600 })),
    account: vi.fn(() => Promise.resolve(account)), folder: vi.fn(() => Promise.resolve(selectedFolder)), revoke: vi.fn(() => Promise.resolve()),
    generateFolderId: vi.fn(() => Promise.resolve('created_folder')), createMediaFolder: vi.fn(() => Promise.resolve({
      id: 'created_folder', name: DRIVE_MEDIA_FOLDER_NAME, url: 'https://drive.google.com/drive/folders/created_folder' })) };
  const service = (uid = 'owner', configuration: DriveConfiguration | undefined = config) => new DriveConnectionService(uid, store, configuration, provider, () => time);
  const connected = async () => { const start = await service().begin(); await service().complete('synthetic-code', start.state); };
  return { service, provider, connected, states, audit, connection: () => connection,
    revoke: () => { allowed = false; }, membershipChanged: () => { version++; }, advance: (ms: number) => { time += ms; } };
}
test('Drive is disabled by default and configuration fails closed for missing credentials, unsafe origins and foreign runtime', () => {
  expect(driveConfiguration({}, secrets)).toBeUndefined();
  expect(driveConfiguration(environment, secrets)).toBeDefined();
  for (const patch of [{ DRIVE_CONNECTION_ENABLED: 'yes' }, { DRIVE_OAUTH_CLIENT_ID: '' }, { DRIVE_PICKER_API_KEY: '' },
    { DRIVE_PICKER_APP_ID: '' }, { GCLOUD_PROJECT: 'foreign' }, { DRIVE_OAUTH_REDIRECT_URI: 'https://evil.example' + CALLBACK_PATH },
    { DRIVE_OAUTH_REDIRECT_URI: config.redirectUri + '?next=evil' }, { DRIVE_OAUTH_REDIRECT_URI: config.redirectUri + '#fragment' },
    { DRIVE_OAUTH_REDIRECT_URI: 'https://justkviz-v2.web.app.evil.example' + CALLBACK_PATH }, { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }]) {
    expect(driveConfiguration({ ...environment, ...patch }, secrets)).toBeUndefined();
  }
  expect(driveConfiguration(environment, { ...secrets, keyring: 'not-json' })).toBeUndefined();
  expect(driveConfiguration(environment, { ...secrets, clientSecret: '' })).toBeUndefined();
  expect(driveConfiguration({ ...environment, DRIVE_PICKER_APP_ID: '177615774316', DRIVE_OAUTH_CLIENT_ID: '177615774316-client.apps.googleusercontent.com' }, secrets)).toBeUndefined();
  expect(driveConfiguration({ ...environment, DRIVE_PICKER_APP_ID: '987654321000' }, secrets)).toBeUndefined();
});
test('Drive callback permits the canonical domain and retained V2 origins only in the existing cloud runtime', () => {
  for (const origin of ['https://justkviz.cz', 'https://justkviz-v2.web.app', 'https://justkviz-v2.firebaseapp.com',
    'https://filmovy-kviz-v2-staging.web.app', 'https://filmovy-kviz-v2-staging.firebaseapp.com']) {
    const env = { ...environment, DRIVE_OAUTH_REDIRECT_URI: origin + CALLBACK_PATH };
    expect(driveConfiguration(env, secrets)?.redirectUri).toBe(origin + CALLBACK_PATH);
    expect(driveConfiguration({ ...env, GCLOUD_PROJECT: 'foreign' }, secrets)).toBeUndefined();
    expect(driveConfiguration({ ...env, FUNCTIONS_EMULATOR: 'true' }, secrets)).toBeUndefined();
  }
  for (const origin of ['http://justkviz.cz', 'https://www.justkviz.cz', 'https://justkviz.cz.evil.example',
    'https://justkviz.cz:444', 'https://evil.example']) {
    expect(driveConfiguration({ ...environment, DRIVE_OAUTH_REDIRECT_URI: origin + CALLBACK_PATH }, secrets)).toBeUndefined();
  }
  for (const suffix of ['?next=evil', '#fragment', '/', '/other']) {
    expect(driveConfiguration({ ...environment, DRIVE_OAUTH_REDIRECT_URI: 'https://justkviz.cz' + CALLBACK_PATH + suffix }, secrets)).toBeUndefined();
  }
  expect(driveConfiguration({ ...environment, DRIVE_OAUTH_REDIRECT_URI: 'https://user:password@justkviz.cz' + CALLBACK_PATH }, secrets)).toBeUndefined();
  expect(driveConfiguration({ ...environment, GCLOUD_PROJECT: 'demo-filmovy-kviz-v2', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
    DRIVE_OAUTH_REDIRECT_URI: 'http://127.0.0.1:5173' + CALLBACK_PATH }, secrets)).toBeDefined();
});
test('dedicated vault authenticates UID, purpose and key version, and supports retained key rotation', () => {
  const vault = driveKeyring(keyring), envelope = vault.seal('private-refresh', 'drive:owner:refresh');
  expect(JSON.stringify(envelope)).not.toContain('private-refresh');
  expect(vault.open(envelope, 'drive:owner:refresh')).toBe('private-refresh');
  expect(() => vault.open(envelope, 'drive:other:refresh')).toThrow();
  expect(() => vault.open(envelope, 'email:owner:refresh')).toThrow();
  expect(() => vault.open({ ...envelope, keyId: 'unknown' }, 'drive:owner:refresh')).toThrow();
  expect(() => driveKeyring(JSON.stringify({ activeKeyId: 'missing', keys: {} }))).toThrow();
});
test('PKCE offline consent requests only drive.file and persists only a hashed state and encrypted verifier', async () => {
  const f = fixture(), first = await f.service().begin(), second = await f.service().begin(), url = new URL(first.authorizationUrl);
  expect(first.state).toHaveLength(43); expect(first.state).not.toBe(second.state);
  expect(url.origin).toBe('https://accounts.google.com');
  expect(url.searchParams.get('scope')).toBe(DRIVE_SCOPE);
  expect(url.searchParams.get('access_type')).toBe('offline');
  expect(url.searchParams.get('prompt')).toBe('consent');
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  expect(url.searchParams.get('include_granted_scopes')).toBe('false');
  expect([...f.states.keys()]).not.toContain(first.state);
  expect(JSON.stringify([...f.states])).not.toContain(first.state);
  expect(f.audit).toEqual(['drive-connect-begin', 'drive-connect-begin']);
});
test('completion binds state to the UID and current membership, expiry, latest attempt, and consumes it once', async () => {
  for (const mode of ['uid', 'membership', 'expiry', 'superseded', 'replay'] as const) {
    const f = fixture(), start = await f.service().begin();
    if (mode === 'membership') f.membershipChanged();
    if (mode === 'expiry') f.advance(600_000);
    if (mode === 'superseded') await f.service().begin();
    if (mode === 'replay') await f.service().complete('code', start.state);
    await expect(f.service(mode === 'uid' ? 'intruder' : 'owner').complete('code', start.state)).rejects.toThrow();
    expect(f.provider.exchange).toHaveBeenCalledTimes(mode === 'replay' ? 1 : 0);
  }
});
test('state is consumed before token exchange, including provider failures and concurrent completion', async () => {
  const f = fixture(), start = await f.service().begin();
  vi.mocked(f.provider.exchange).mockRejectedValue(new Error('provider token=NEVER-EXPOSE'));
  await expect(f.service().complete('code', start.state)).rejects.toThrow('Připojení Disku není nyní dostupné.');
  await expect(f.service().complete('code', start.state)).rejects.toThrow();
  expect(f.provider.exchange).toHaveBeenCalledTimes(1);
  const g = fixture(), start2 = await g.service().begin();
  const results = await Promise.allSettled([g.service().complete('code', start2.state), g.service().complete('code', start2.state)]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(g.provider.exchange).toHaveBeenCalledTimes(1);
});
test('completion encrypts refresh credentials and status exposes only a small allowlist', async () => {
  const f = fixture(); await f.connected();
  const status = await f.service().read();
  expect(status).toEqual({ configured: true, status: 'folder-required', accountEmail: account.email });
  expect(JSON.stringify(f.connection())).not.toContain('synthetic-refresh');
  expect(JSON.stringify(status)).not.toMatch(/refresh|ciphertext|verifier|permissionId/u);
  expect(f.audit).toContain('drive-connect-complete');
  expect(await f.service().select(selectedFolder.id)).toEqual({ ...status, status: 'connected', folder: selectedFolder });
  expect(f.audit).toContain('drive-folder-selected');
  const picker = await f.service().picker();
  expect(picker).toEqual({ accessToken: 'picker-access', expiresAt: 3_601_000, developerKey: config.developerKey, appId: config.appId, suggestedFolderName: 'JustKvíz – média' });
  expect(JSON.stringify(picker)).not.toMatch(/synthetic-refresh|ciphertext/u);
});
test('Google IO cannot complete a write after disconnect or membership revocation', async () => {
  for (const mode of ['disconnect', 'membership', 'revoke'] as const) {
    const f = fixture(), start = await f.service().begin();
    vi.mocked(f.provider.account).mockImplementation(async () => {
      if (mode === 'disconnect') await f.service().disconnect();
      if (mode === 'membership') f.membershipChanged();
      if (mode === 'revoke') f.revoke();
      return account;
    });
    await expect(f.service().complete('code', start.state)).rejects.toThrow();
    expect(f.connection().refreshToken).toBeUndefined();
  }
});
test('picker and folder selection recheck membership and revision after provider IO', async () => {
  for (const operation of ['picker', 'select'] as const) {
    const f = fixture(); await f.connected();
    vi.mocked(f.provider.refresh).mockImplementation(() => { f.membershipChanged(); return Promise.resolve({ accessToken: 'access', expiresIn: 3600 }); });
    await expect(operation === 'picker' ? f.service().picker() : f.service().select(selectedFolder.id)).rejects.toThrow();
    expect(f.connection().folder).toBeUndefined();
  }
});
test('invalid grant records reauthorization status without exposing provider error or losing ciphertext', async () => {
  const f = fixture(); await f.connected();
  vi.mocked(f.provider.refresh).mockRejectedValue(new DriveProviderError(true));
  await expect(f.service().picker()).rejects.toThrow();
  expect(await f.service().read()).toEqual({ configured: true, status: 'reauthorization-required', accountEmail: account.email });
  expect(f.connection().refreshToken).toBeDefined();
});
test('disconnect removes credentials and folder, invalidates states even offline, and blocks reconnect until revocation completes', async () => {
  const f = fixture(); await f.connected(); await f.service().select(selectedFolder.id);
  const pending = await f.service().begin();
  vi.mocked(f.provider.revoke).mockImplementation(async () => {
    expect(f.connection().refreshToken).toBeUndefined();
    expect(f.connection().folder).toBeUndefined();
    await expect(f.service().begin()).rejects.toThrow('Odpojení Disku ještě probíhá.');
    throw new Error('offline token=NEVER-EXPOSE');
  });
  expect(await f.service().disconnect()).toEqual({ configured: true, status: 'disconnected' });
  expect(f.audit).toContain('drive-disconnect');
  await expect(f.service().complete('code', pending.state)).rejects.toThrow();
  await expect(f.service().begin()).resolves.toHaveProperty('authorizationUrl');
});
test('token and account response parsers reject broad scopes, omitted scope, malformed expiry and nonpersonal accounts', () => {
  const valid = { access_token: 'access', token_type: 'Bearer', expires_in: 3600, scope: DRIVE_SCOPE };
  expect(parseDriveToken(valid).accessToken).toBe('access');
  for (const patch of [{ scope: undefined }, { scope: DRIVE_SCOPE + ' https://www.googleapis.com/auth/drive' }, { scope: 'https://www.googleapis.com/auth/drive' },
    { token_type: 'other' }, { access_token: 'x\nsecret' }, { expires_in: Infinity }, { expires_in: 3601 }, { expires_in: '3600' }, { refresh_token: '' }]) expect(() => parseDriveToken({ ...valid, ...patch })).toThrow();
  expect(parseDriveAccount({ user: { emailAddress: account.email, permissionId: account.permissionId } })).toEqual(account);
  for (const email of ['owner@company.test', 'owner@gmail.com.evil.test', 'owner@gmail.com\nInjected']) expect(() => parseDriveAccount({ user: { emailAddress: email, permissionId: 'p' } })).toThrow();
});
test('folder validation requires sole personal ownership, private permissions, add children and a real nontrashed folder', () => {
  const valid = { id: selectedFolder.id, name: selectedFolder.name, mimeType: 'application/vnd.google-apps.folder', trashed: false,
    ownedByMe: true, shared: false, capabilities: { canAddChildren: true }, owners: [{ permissionId: account.permissionId }],
    permissions: [{ id: account.permissionId, type: 'user', role: 'owner' }] };
  expect(parseDriveFolder(valid, selectedFolder.id, account)).toEqual(selectedFolder);
  for (const patch of [{ id: 'other' }, { trashed: true }, { mimeType: 'application/vnd.google-apps.shortcut' }, { shared: true },
    { ownedByMe: false }, { driveId: 'shared-drive' }, { capabilities: { canAddChildren: false } }, { owners: [] },
    { owners: [{ permissionId: 'other' }] }, { permissions: [] }, { permissions: [...valid.permissions, { type: 'anyone', role: 'reader' }] },
    ...['anyone', 'group', 'domain'].map(type => ({ permissions: [{ id: account.permissionId, type, role: 'owner' }] })),
    { permissions: [{ id: account.permissionId, type: 'user', role: 'writer' }] }, { permissions: [{ id: account.permissionId, type: 'user', role: 'owner', pendingOwner: true }] }]) {
    expect(() => parseDriveFolder({ ...valid, ...patch }, selectedFolder.id, account)).toThrow();
  }
});
test('real provider rejects emulator IO before fetch and uses fixed hosts with a bounded timeout and safe errors', async () => {
  const http = vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'SECRET' }), { status: 400 })));
  const local = new GoogleDriveProvider(config, http, { GCLOUD_PROJECT: 'demo-filmovy-kviz-v2', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' });
  await expect(local.refresh('private-refresh')).rejects.toThrow(); expect(http).not.toHaveBeenCalled();
  const cloud = new GoogleDriveProvider(config, http, { GCLOUD_PROJECT: 'filmovy-kviz-v2-staging' });
  await expect(cloud.refresh('private-refresh')).rejects.toMatchObject({ reauthorization: true });
  expect(http.mock.calls[0]?.[0]).toBe('https://oauth2.googleapis.com/token');
  const stalled = new GoogleDriveProvider(config, vi.fn(() => new Promise<Response>(() => {})), { GCLOUD_PROJECT: 'filmovy-kviz-v2-staging' }, 5);
  await expect(stalled.refresh('private-refresh')).rejects.toThrow('Připojení Disku není nyní dostupné.');
});

test('app-created folder reservation is durable before Google IO and is hidden from safe status', async () => {
  const f = fixture(); await f.connected();
  const encrypted = f.connection().refreshToken;
  vi.mocked(f.provider.createMediaFolder).mockImplementationOnce(async (_token, id) => {
    expect(f.connection().folderCreation).toEqual({ id });
    expect(f.connection().folder).toBeUndefined();
    expect(await f.service().read()).not.toHaveProperty('folderCreation');
    return { id, name: DRIVE_MEDIA_FOLDER_NAME, url: 'https://drive.google.com/drive/folders/' + id };
  });
  await expect(f.service().createFolder()).resolves.toMatchObject({ status: 'connected', folder: { id: 'created_folder', name: DRIVE_MEDIA_FOLDER_NAME } });
  expect(f.connection().folderCreation).toBeUndefined();
  expect(f.connection().refreshToken).toEqual(encrypted);
  expect(f.audit.at(-1)).toBe('drive-folder-selected');
  expect(JSON.stringify(await f.service().read())).not.toMatch(/synthetic-access|synthetic-refresh|picker-access|folderCreation/u);
  await f.service().createFolder();
  expect(f.provider.generateFolderId).toHaveBeenCalledTimes(1);
  expect(f.provider.createMediaFolder).toHaveBeenCalledTimes(1);
});

test('ambiguous folder creation retries reuse the same persisted ID without duplicate folders', async () => {
  const f = fixture(); await f.connected();
  vi.mocked(f.provider.createMediaFolder).mockRejectedValueOnce(new Error('uncertain provider acceptance'));
  await expect(f.service().createFolder()).rejects.toMatchObject({ code: 'unavailable' });
  expect(f.connection().folderCreation).toEqual({ id: 'created_folder' });
  await expect(f.service().createFolder()).resolves.toMatchObject({ status: 'connected' });
  expect(f.provider.generateFolderId).toHaveBeenCalledTimes(1);
  expect(vi.mocked(f.provider.createMediaFolder).mock.calls.map(call => call[1])).toEqual(['created_folder', 'created_folder']);
});

test('folder creation does not replace an existing selected folder or run without configuration/current authority', async () => {
  const f = fixture(); await f.connected(); await f.service().select(selectedFolder.id);
  await expect(f.service().createFolder()).resolves.toMatchObject({ folder: selectedFolder });
  expect(f.provider.createMediaFolder).not.toHaveBeenCalled();
  expect(f.provider.generateFolderId).not.toHaveBeenCalled();
  f.revoke();
  await expect(f.service().createFolder()).rejects.toThrow('access revoked');
  const disconnected = fixture();
  await expect(disconnected.service().createFolder()).rejects.toMatchObject({ code: 'failed-precondition' });
  expect(disconnected.provider.refresh).not.toHaveBeenCalled();
  const disabled = new DriveConnectionService('owner', { run: () => Promise.reject(new Error('Unexpected store IO')) }, undefined, disconnected.provider);
  await expect(disabled.createFolder()).rejects.toThrow('Připojení Disku není nakonfigurované.');
});

test('folder creation discards stale success after disconnect, selected-folder replacement or membership revocation', async () => {
  for (const change of ['disconnect', 'select', 'membership', 'revocation']) {
    const f = fixture(); await f.connected();
    let started!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const barrier = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(f.provider.createMediaFolder).mockImplementationOnce(async () => {
      started(); await barrier;
      return { id: 'created_folder', name: DRIVE_MEDIA_FOLDER_NAME, url: 'https://drive.google.com/drive/folders/created_folder' };
    });
    const pending = f.service().createFolder();
    await entered;
    if (change === 'disconnect') await f.service().disconnect();
    if (change === 'select') await f.service().select(selectedFolder.id);
    if (change === 'membership') f.membershipChanged();
    if (change === 'revocation') f.revoke();
    release();
    await expect(pending).rejects.toThrow();
    expect(f.connection().folder?.id).not.toBe('created_folder');
    if (change === 'disconnect') expect(f.connection().refreshToken).toBeUndefined();
    if (change === 'select') expect(f.connection().folder).toEqual(selectedFolder);
  }
});

test('concurrent creation shares a reservation and stale completions cannot overwrite the successful connection', async () => {
  const f = fixture(); await f.connected();
  let started!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const barrier = new Promise<void>(resolve => { release = resolve; });
  vi.mocked(f.provider.createMediaFolder).mockImplementationOnce(async () => {
    started(); await barrier;
    return { id: 'created_folder', name: DRIVE_MEDIA_FOLDER_NAME, url: 'https://drive.google.com/drive/folders/created_folder' };
  });
  const first = f.service().createFolder(); await entered;
  await expect(f.service().createFolder()).resolves.toMatchObject({ status: 'connected', folder: { id: 'created_folder' } });
  release(); await expect(first).rejects.toMatchObject({ code: 'aborted' });
  expect(f.provider.generateFolderId).toHaveBeenCalledTimes(1);
  expect(f.connection().folder?.id).toBe('created_folder');
  expect(f.connection().folderCreation).toBeUndefined();
});

test('folder creation preserves encrypted refresh-token rotation and binds reauthorization errors to the reservation revision', async () => {
  const f = fixture(); await f.connected();
  vi.mocked(f.provider.refresh).mockResolvedValue({ accessToken: 'new-access', refreshToken: 'rotated-refresh', expiresIn: 3600 });
  vi.mocked(f.provider.createMediaFolder).mockRejectedValueOnce(new DriveProviderError(true));
  await expect(f.service().createFolder()).rejects.toThrow();
  expect(f.connection().reauthorizationRequired).toBe(true);
  expect(config.vault.open(f.connection().refreshToken!, 'justkviz-drive:v1:owner:refresh:0')).toBe('rotated-refresh');
  expect(JSON.stringify(f.connection())).not.toContain('rotated-refresh');
  const mismatch = fixture(); await mismatch.connected();
  vi.mocked(mismatch.provider.account).mockResolvedValue({ email: 'other@gmail.com', permissionId: 'other_permission' });
  await expect(mismatch.service().createFolder()).rejects.toThrow();
  expect(mismatch.provider.generateFolderId).not.toHaveBeenCalled();
  expect(mismatch.connection().reauthorizationRequired).toBe(true);
});

test('provider creates only the pre-generated app-marked folder and checks private ownership after success or conflict', async () => {
  const created = { id: 'created_folder', name: DRIVE_MEDIA_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder',
    trashed: false, ownedByMe: true, shared: false, capabilities: { canAddChildren: true },
    owners: [{ permissionId: account.permissionId }], permissions: [{ id: account.permissionId, type: 'user', role: 'owner' }],
    appProperties: { justkvizMediaFolder: 'v1' } };
  for (const status of [200, 409]) {
    const http = vi.fn<typeof fetch>((url, init) => {
      if ((url instanceof Request ? url.url : url.toString()).includes('/generateIds')) return Promise.resolve(new Response(JSON.stringify({ ids: ['created_folder'] })));
      if (init?.method === 'POST') return Promise.resolve(new Response(JSON.stringify(status === 409 ? { error: { code: 409 } } : { id: 'created_folder' }), { status }));
      return Promise.resolve(new Response(JSON.stringify(created)));
    });
    const provider = new GoogleDriveProvider(config, http, { GCLOUD_PROJECT: 'filmovy-kviz-v2-staging' });
    expect(await provider.generateFolderId('synthetic-access')).toBe('created_folder');
    await expect(provider.createMediaFolder('synthetic-access', 'created_folder', account)).resolves.toMatchObject({ id: 'created_folder', name: DRIVE_MEDIA_FOLDER_NAME });
    const post = http.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(post?.[1]?.body as string)).toEqual({ id: 'created_folder', name: DRIVE_MEDIA_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder', appProperties: { justkvizMediaFolder: 'v1' } });
    for (const [url, init] of http.mock.calls) {
      expect(new URL(url instanceof Request ? url.url : url.toString()).origin).toBe('https://www.googleapis.com');
      expect(init?.redirect).toBe('error');
      expect(['PATCH', 'DELETE', 'PUT']).not.toContain(init?.method);
    }
  }
  for (const patch of [{ appProperties: {} }, { shared: true }, { owners: [] }, { trashed: true }]) {
    const http = vi.fn<typeof fetch>((_url, init) => Promise.resolve(init?.method === 'POST'
      ? new Response('{}', { status: 409 }) : new Response(JSON.stringify({ ...created, ...patch }))));
    await expect(new GoogleDriveProvider(config, http, { GCLOUD_PROJECT: 'filmovy-kviz-v2-staging' })
      .createMediaFolder('synthetic-access', 'created_folder', account)).rejects.toThrow();
  }
});
