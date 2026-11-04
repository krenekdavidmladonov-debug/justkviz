// @vitest-environment happy-dom
import React, { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AdminSettingsPage } from '../apps/web/src/routes/admin/AdminSettingsPage';
import { DriveConnectionCallback, DriveConnectionSessionGuard } from '../apps/web/src/features/drive/DriveConnectionCallback';
import { clearForeignDriveConnectionState, driveConnectionSettingsDestination, finishDriveConnection, prepareDriveConnection } from '../apps/web/src/features/drive/session';
import * as api from '../apps/web/src/features/drive/api';
import { openDriveFolderPicker } from '../apps/web/src/features/drive/picker';

const auth = vi.hoisted(() => ({ uid: 'owner', role: 'owner', loading: false, denied: [] as string[] }));
vi.mock('../apps/web/src/auth/AuthProvider', () => ({ useAuth: () => ({
  currentUser: auth.uid ? { uid: auth.uid } : null,
  membership: { role: auth.role, version: 1 }, loading: auth.loading,
  can: (permission: string) => !auth.denied.includes(permission),
}) }));
vi.mock('../apps/web/src/features/drive/api', () => ({
  readDriveConnection: vi.fn(), beginDriveConnection: vi.fn(), completeDriveConnection: vi.fn(),
  getDriveFolderPicker: vi.fn(), selectDriveFolder: vi.fn(), createDriveMediaFolder: vi.fn(), disconnectDriveConnection: vi.fn(),
}));
vi.mock('../apps/web/src/features/drive/picker', () => ({ openDriveFolderPicker: vi.fn() }));
let host: HTMLDivElement, root: Root;
const connected: api.DriveConnectionStatus = { configured: true, status: 'connected', accountEmail: 'synthetic@example.test', folder: { id: 'synthetic-folder', name: 'Média', url: 'https://drive.google.com/drive/folders/synthetic-folder' } };
const folderRequired: api.DriveConnectionStatus = { configured: true, status: 'folder-required', accountEmail: connected.accountEmail };
const credentials: api.DriveFolderPickerCredentials = { accessToken: 'synthetic-token', developerKey: 'browser-key', appId: 'app-id', suggestedFolderName: 'Média', expiresAt: Date.now() + 60_000 };
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('React', React);
  vi.clearAllMocks(); sessionStorage.clear(); clearForeignDriveConnectionState(null);
  auth.uid = 'owner'; auth.role = 'owner'; auth.loading = false; auth.denied = [];
  vi.mocked(api.readDriveConnection).mockResolvedValue(connected);
  vi.mocked(api.completeDriveConnection).mockResolvedValue(folderRequired);
  vi.mocked(api.getDriveFolderPicker).mockResolvedValue(credentials);
  vi.mocked(api.selectDriveFolder).mockResolvedValue(connected);
  vi.mocked(api.createDriveMediaFolder).mockResolvedValue(connected);
  vi.mocked(api.disconnectDriveConnection).mockResolvedValue({ configured: true, status: 'disconnected' });
  vi.mocked(openDriveFolderPicker).mockResolvedValue(null);
  window.history.replaceState(null, '', '/admin/settings');
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function settings() {
  const router = createMemoryRouter([{ path: '/admin/settings', element: <AdminSettingsPage /> }], { initialEntries: ['/admin/settings'] });
  await act(async () => root.render(<RouterProvider router={router} />)); return router;
}
async function callback(query: string, strict = false) {
  window.history.replaceState(null, '', '/admin/settings/drive/callback' + query);
  const router = createMemoryRouter([
    { path: '/admin/settings/drive/callback', element: <DriveConnectionCallback /> },
    { path: '/admin/settings', element: <p>Settings</p> },
  ], { initialEntries: ['/admin/settings/drive/callback' + query] });
  await act(async () => root.render(strict ? <StrictMode><RouterProvider router={router} /></StrictMode> : <RouterProvider router={router} />));
  return router;
}
function pending(state = 'synthetic-state') {
  prepareDriveConnection(auth.uid, state, 'https://accounts.google.com/o/oauth2/v2/auth?state=' + state);
}
async function click(text: string) {
  const button = [...host.querySelectorAll('button')].find(value => value.textContent === text);
  expect(button).toBeDefined(); await act(async () => button!.click());
}

it.each([
  { role: 'admin', denied: [] }, { role: 'owner', denied: ['users.manage'] }, { role: 'owner', denied: ['quiz.media.upload'] },
])('does not request or display private connection data without owner and both permissions: %j', async access => {
  auth.role = access.role; auth.denied = access.denied; await settings();
  expect(api.readDriveConnection).not.toHaveBeenCalled(); expect(host.textContent).not.toContain('synthetic@example.test');
  expect(host.querySelector('#drive-connection-heading')).toBeNull();
});
it('shows the connected account, safe folder link and an explicit disconnect confirmation', async () => {
  await settings(); expect(host.textContent).toContain(connected.accountEmail);
  expect(host.querySelector('a[href="https://drive.google.com/drive/folders/synthetic-folder"]')).not.toBeNull();
  await click('Odpojit Google Disk'); expect(api.disconnectDriveConnection).not.toHaveBeenCalled();
  expect(host.textContent).toContain('Soubory ve složce zůstanou zachované.');
  await click('Zrušit'); expect(api.disconnectDriveConnection).not.toHaveBeenCalled();
  await click('Odpojit Google Disk'); await click('Potvrdit odpojení');
  expect(api.disconnectDriveConnection).toHaveBeenCalledOnce(); expect(host.textContent).not.toContain(connected.accountEmail);
  expect(host.textContent).toContain('Google Disk byl odpojen.');
});
it.each(['https://justkviz-v2.web.app', 'https://justkviz-v2.firebaseapp.com',
  'https://filmovy-kviz-v2-staging.web.app', 'https://filmovy-kviz-v2-staging.firebaseapp.com'])(
  'starts reconnect from canonical Settings before creating OAuth state on a retained origin: %s', async origin => {
    const original = window.location.href;
    window.location.href = origin + '/admin/settings';
    try {
      vi.mocked(api.readDriveConnection).mockResolvedValue({ configured: true, status: 'reauthorization-required' });
      await settings();
      expect(host.querySelector('a[href="https://justkviz.cz/admin/settings"]')?.textContent).toBe('Připojit Google Disk na justkviz.cz');
      expect(api.beginDriveConnection).not.toHaveBeenCalled();
      expect(sessionStorage.length).toBe(0);
    } finally { window.location.href = original; }
  });
it.each(['https://justkviz.cz', 'http://localhost:5173', 'http://127.0.0.1:5173',
  'https://justkviz-v2.web.app.evil.example', 'https://evil.example'])(
  'does not rewrite canonical, local or unrecognized origins: %s', origin => {
    expect(driveConnectionSettingsDestination(origin)).toBeNull();
  });
it('keeps a connected Drive usable from an old admin address without requiring reconnection', async () => {
  const original = window.location.href;
  window.location.href = 'https://justkviz-v2.web.app/admin/settings';
  try {
    await settings();
    expect(host.querySelector('a[href="https://justkviz.cz/admin/settings"]')).toBeNull();
    await click('Změnit složku');
    expect(api.getDriveFolderPicker).toHaveBeenCalledOnce();
    expect(openDriveFolderPicker).toHaveBeenCalledOnce();
    expect(api.beginDriveConnection).not.toHaveBeenCalled();
  } finally { window.location.href = original; }
});
it('starts OAuth on the canonical domain with pending state stored on that same origin', async () => {
  const original = window.location.href;
  window.location.href = 'https://justkviz.cz/admin/settings';
  const navigate = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
  try {
    vi.mocked(api.readDriveConnection).mockResolvedValue({ configured: true, status: 'disconnected' });
    vi.mocked(api.beginDriveConnection).mockResolvedValue({ state: 'canonical-state',
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=canonical-state' });
    await settings();
    await click('Připojit Google Disk');
    expect(api.beginDriveConnection).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?state=canonical-state');
    expect(JSON.parse(sessionStorage.getItem('justkviz.drive.connection') ?? 'null')).toMatchObject({ uid: 'owner', state: 'canonical-state' });
    expect(window.location.origin).toBe('https://justkviz.cz');
  } finally { navigate.mockRestore(); window.location.href = original; }
});
it('truthfully explains missing configuration without a connect button', async () => {
  vi.mocked(api.readDriveConnection).mockResolvedValue({ configured: false, status: 'not-configured' }); await settings();
  expect(host.textContent).toContain('Připojení Google Disku zatím není aktivované.');
  expect(host.textContent).not.toContain('Po uložení otázky se připraví');
  expect([...host.querySelectorAll('button')].some(button => button.textContent === 'Připojit Google Disk')).toBe(false);
});
it('creates the application folder without opening the Google picker', async () => {
  vi.mocked(api.readDriveConnection).mockResolvedValue(folderRequired); await settings();
  await click('Vytvořit složku aplikace');
  expect(api.createDriveMediaFolder).toHaveBeenCalledOnce();
  expect(openDriveFolderPicker).not.toHaveBeenCalled();
  expect(host.querySelector('a[href="https://drive.google.com/drive/folders/synthetic-folder"]')).not.toBeNull();
});
it('shows pending state and a retryable safe error without leaking provider messages', async () => {
  let reject!: (error: Error) => void;
  vi.mocked(api.readDriveConnection).mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  await settings(); expect(host.textContent).toContain('Načítám stav připojení');
  await act(async () => reject(new Error('secret-provider-error synthetic-token')));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('nepodařilo načíst');
  expect(host.textContent).not.toContain('secret-provider-error');
  await click('Znovu načíst stav'); expect(host.textContent).toContain(connected.accountEmail);
});
it('cancels folder selection safely and sends only a selected folder ID to the server', async () => {
  vi.mocked(api.readDriveConnection).mockResolvedValue(folderRequired); await settings();
  await click('Vybrat složku pro média'); expect(api.selectDriveFolder).not.toHaveBeenCalled();
  expect(host.textContent).toContain('Výběr složky byl zrušen.');
  vi.mocked(openDriveFolderPicker).mockResolvedValue('synthetic-folder');
  let resolve!: (status: api.DriveConnectionStatus) => void;
  vi.mocked(api.selectDriveFolder).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await click('Vybrat složku pro média');
  expect(api.selectDriveFolder).toHaveBeenCalledExactlyOnceWith('synthetic-folder');
  expect([...host.querySelectorAll('button')].every(button => button.disabled)).toBe(true);
  expect(host.textContent).not.toContain('Složka pro média byla uložena.');
  await act(async () => resolve(connected)); expect(host.textContent).toContain('Složka pro média byla uložena.');
  expect(sessionStorage.length).toBe(0); expect(window.location.href).not.toContain(credentials.accessToken);
});
it('strips the callback URL before Auth resolves and completes a StrictMode callback exactly once', async () => {
  pending(); auth.loading = true; const router = await callback('?code=synthetic-code&state=synthetic-state', true);
  expect(window.location.search).toBe(''); expect(api.completeDriveConnection).not.toHaveBeenCalled();
  auth.loading = false;
  await act(async () => { await router.navigate(router.state.location.pathname + router.state.location.search, { replace: true }); });
  expect(api.completeDriveConnection).toHaveBeenCalledExactlyOnceWith('synthetic-code', 'synthetic-state');
  expect(api.readDriveConnection).toHaveBeenCalledOnce(); expect(sessionStorage.length).toBe(0);
  expect(router.state.location.state).toEqual({ driveConnectionResult: 'connected' });
});
it('preserves a declined-consent result under StrictMode without a server exchange', async () => {
  pending(); const router = await callback('?error=access_denied&state=synthetic-state', true);
  expect(router.state.location.state).toEqual({ driveConnectionResult: 'cancelled' });
  expect(api.completeDriveConnection).not.toHaveBeenCalled(); expect(sessionStorage.length).toBe(0);
});
it.each(['foreign-state', 'cross-user', 'expired'])('rejects an invalid callback binding (%s)', async kind => {
  pending();
  if (kind === 'cross-user') auth.uid = 'other-owner';
  if (kind === 'expired') {
    const key = sessionStorage.key(0)!; const value = JSON.parse(sessionStorage.getItem(key)!) as Record<string, unknown>;
    sessionStorage.setItem(key, JSON.stringify({ ...value, createdAt: Date.now() - 11 * 60_000 }));
  }
  const router = await callback('?code=synthetic-code&state=' + (kind === 'foreign-state' ? 'other-state' : 'synthetic-state'), true);
  expect(api.completeDriveConnection).not.toHaveBeenCalled(); expect(api.readDriveConnection).not.toHaveBeenCalled();
  expect(router.state.location.state).toEqual({ driveConnectionResult: 'expired' }); expect(sessionStorage.length).toBe(0);
});
it('denies callback exchanges without current owner permission', async () => {
  pending(); auth.denied = ['quiz.media.upload']; const router = await callback('?code=synthetic-code&state=synthetic-state');
  expect(api.completeDriveConnection).not.toHaveBeenCalled(); expect(router.state.location.state).toEqual({ driveConnectionResult: 'forbidden' });
  expect(sessionStorage.length).toBe(0);
});
it('clears pending state on signout and on an account switch away from settings', async () => {
  pending(); auth.uid = ''; await act(async () => root.render(<DriveConnectionSessionGuard />)); expect(sessionStorage.length).toBe(0);
  auth.uid = 'owner'; pending(); auth.uid = 'other-owner';
  await act(async () => root.render(<DriveConnectionSessionGuard />)); expect(sessionStorage.length).toBe(0);
});
it.each(['https://accounts.google.com.evil.test/o/oauth2/v2/auth?state=s', 'http://accounts.google.com/o/oauth2/v2/auth?state=s', 'https://accounts.google.com/other?state=s', 'https://accounts.google.com/o/oauth2/v2/auth?state=other'])('rejects an unexpected authorization destination: %s', url => {
  expect(() => prepareDriveConnection('owner', 's', url)).toThrow(); expect(sessionStorage.length).toBe(0);
});
it('returns a safe failed result for provider failures', async () => {
  pending(); vi.mocked(api.completeDriveConnection).mockRejectedValueOnce(new Error('private token'));
  expect(await finishDriveConnection('owner', '?code=synthetic-code&state=synthetic-state')).toBe('failed');
  expect(sessionStorage.length).toBe(0);
});
it('fails closed when browser session storage is unavailable', async () => {
  const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
  const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked'); });
  try {
    clearForeignDriveConnectionState(null);
    expect(await finishDriveConnection('owner', '?code=synthetic-code&state=synthetic-state')).toBe('expired');
    expect(api.completeDriveConnection).not.toHaveBeenCalled();
  } finally { read.mockRestore(); remove.mockRestore(); }
});
it('opens the official folder-only Picker with same-origin binding and keeps the access token out of storage', async () => {
  const actual = await vi.importActual<typeof import('../apps/web/src/features/drive/picker')>('../apps/web/src/features/drive/picker');
  let receive!: (event: { action: string; docs?: { id: string; mimeType: string }[] }) => void;
  const options: Record<string, unknown> = {};
  class View {
    constructor(id: string) { options.viewId = id; }
    setIncludeFolders(value: boolean) { options.includeFolders = value; return this; }
    setSelectFolderEnabled(value: boolean) { options.selectFolder = value; return this; }
    setMimeTypes(value: string) { options.mime = value; return this; }
    setMode(value: string) { options.mode = value; return this; }
  }
  class Builder {
    addView() { return this; }
    setOAuthToken(value: string) { options.token = value; return this; }
    setDeveloperKey(value: string) { options.key = value; return this; }
    setAppId(value: string) { options.app = value; return this; }
    setOrigin(value: string) { options.origin = value; return this; }
    setTitle() { return this; }
    setCallback(callback: typeof receive) { receive = callback; return this; }
    build() { return { setVisible: vi.fn() }; }
  }
  vi.stubGlobal('google', { picker: { DocsView: View, PickerBuilder: Builder, ViewId: { FOLDERS: 'folders' }, DocsViewMode: { LIST: 'list' }, Action: { PICKED: 'picked', CANCEL: 'cancel' } } });
  const selection = actual.openDriveFolderPicker(credentials); await Promise.resolve();
  expect(options).toMatchObject({ token: credentials.accessToken, origin: window.location.origin, mime: 'application/vnd.google-apps.folder', selectFolder: true, includeFolders: true });
  receive({ action: 'picked', docs: [{ id: 'selected-folder', mimeType: 'application/vnd.google-apps.folder' }] });
  expect(await selection).toBe('selected-folder'); expect(sessionStorage.length).toBe(0);
  const cancelled = actual.openDriveFolderPicker(credentials); await Promise.resolve(); receive({ action: 'cancel' });
  expect(await cancelled).toBeNull();
});
