// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openDriveFolderPicker } from '../apps/web/src/features/drive/picker';
import { DriveConnectionCard } from '../apps/web/src/features/drive/DriveConnectionCard';
import * as api from '../apps/web/src/features/drive/api';

vi.mock('../apps/web/src/auth/AuthProvider', () => ({ useAuth: () => ({
  currentUser: { uid: 'owner' }, membership: { role: 'owner', version: 1 }, can: () => true, loading: false,
}) }));
vi.mock('../apps/web/src/features/drive/api', () => ({
  readDriveConnection: vi.fn(), beginDriveConnection: vi.fn(), disconnectDriveConnection: vi.fn(),
  getDriveFolderPicker: vi.fn(), selectDriveFolder: vi.fn(),
}));
const folderMime = 'application/vnd.google-apps.folder';
const credentials = () => ({ accessToken: 'synthetic-token', developerKey: 'synthetic-key', appId: '123',
  suggestedFolderName: 'Média', expiresAt: Date.now() + 3_600_000 });
const connected: api.DriveConnectionStatus = { configured: true, status: 'connected', accountEmail: 'owner@example.test',
  folder: { id: 'original-folder', name: 'Původní média', url: 'https://drive.google.com/drive/folders/original-folder' } };
function googlePicker() {
  let receive!: (event: { action?: string; docs?: unknown }) => void;
  const options: Record<string, unknown> = {};
  const visible = vi.fn(), dispose = vi.fn();
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
    build() { return { setVisible: visible, dispose }; }
  }
  const sdk = { DocsView: View, PickerBuilder: Builder, ViewId: { FOLDERS: 'folders' },
    DocsViewMode: { LIST: 'list' }, Action: { PICKED: 'picked', CANCEL: 'cancel', ERROR: 'error' } };
  vi.stubGlobal('google', { picker: sdk });
  return { receive: (event: Parameters<typeof receive>[0]) => receive(event), visible, dispose, options, sdk };
}
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(api.readDriveConnection).mockResolvedValue(connected);
  vi.mocked(api.getDriveFolderPicker).mockImplementation(() => Promise.resolve(credentials()));
});
afterEach(() => {
  document.head.querySelectorAll('script[src="https://apis.google.com/js/api.js"]').forEach(script => script.remove());
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

it('uses official PICKED shape, binds origin and closes/disposes exactly once even after a late callback', async () => {
  const f = googlePicker(), controller = new AbortController();
  const remove = vi.spyOn(controller.signal, 'removeEventListener');
  const selection = openDriveFolderPicker(credentials(), controller.signal); await Promise.resolve();
  expect(f.options).toMatchObject({ viewId: 'folders', origin: window.location.origin, mime: folderMime, selectFolder: true });
  f.receive({ action: 'picked', docs: [{ id: 'selected-folder', mimeType: folderMime, name: 'Ignored metadata' }] });
  expect(await selection).toBe('selected-folder');
  controller.abort(); f.receive({ action: 'cancel' }); await vi.advanceTimersByTimeAsync(130_000);
  expect(f.visible.mock.calls).toEqual([[true], [false]]); expect(f.dispose).toHaveBeenCalledOnce();
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function)); expect(vi.getTimerCount()).toBe(0);
  expect(sessionStorage.length).toBe(0);
});

it.each([undefined, null, [], {}, [{ id: 'folder', mimeType: 'image/png' }], [{ id: '', mimeType: folderMime }],
  [{ id: 'https://untrusted.test', mimeType: folderMime }], [{ id: 'one', mimeType: folderMime }, { id: 'two', mimeType: folderMime }]])(
  'rejects malformed PICKED docs %j instead of claiming the user cancelled', async docs => {
    const f = googlePicker(), selection = openDriveFolderPicker(credentials());
    const assertion = expect(selection).rejects.toMatchObject({ pickerCode: 'invalid-selection' });
    await Promise.resolve(); f.receive({ action: 'picked', docs }); await assertion;
    expect(f.dispose).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });

it.each(['cancel', 'error'])('handles official %s callback without leaking provider response', async action => {
  const f = googlePicker(), selection = openDriveFolderPicker(credentials());
  const assertion = action === 'cancel' ? expect(selection).resolves.toBeNull() : expect(selection).rejects.toMatchObject({ pickerCode: 'unavailable' });
  await Promise.resolve(); f.receive({ action, docs: 'provider-private-response' }); await assertion;
  expect(f.dispose).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});

it('bounds an unresponsive white Picker iframe and releases all session resources', async () => {
  const f = googlePicker(), selection = openDriveFolderPicker(credentials());
  const assertion = expect(selection).rejects.toMatchObject({ pickerCode: 'timeout' });
  await Promise.resolve(); await vi.advanceTimersByTimeAsync(120_000); await assertion;
  expect(f.visible.mock.calls).toEqual([[true], [false]]); expect(f.dispose).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  f.receive({ action: 'picked', docs: [{ id: 'too-late', mimeType: folderMime }] });
  expect(f.dispose).toHaveBeenCalledOnce();
});

it('cancels immediately during SDK loading and does not create a Picker after a late load', async () => {
  vi.stubGlobal('google', undefined); let loaded!: () => void;
  vi.stubGlobal('gapi', { load: (_name: string, options: { callback: () => void }) => { loaded = options.callback; } });
  const controller = new AbortController(), selection = openDriveFolderPicker(credentials(), controller.signal);
  controller.abort(); expect(await selection).toBeNull();
  const f = googlePicker(); loaded(); await Promise.resolve();
  expect(f.visible).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});

it('rejects expired credentials before loading the Google library', async () => {
  vi.stubGlobal('google', undefined);
  await expect(openDriveFolderPicker({ ...credentials(), expiresAt: Date.now() })).rejects.toMatchObject({ pickerCode: 'expired' });
  expect(document.head.querySelector('script[src="https://apis.google.com/js/api.js"]')).toBeNull();
});

it('recovers UI from timeout, keeps the original folder and permits a successful retry', async () => {
  const f = googlePicker(), host = document.createElement('div'), root = createRoot(host); document.body.append(host);
  const click = async (label: string) => {
    const button = [...host.querySelectorAll('button')].find(value => value.textContent === label);
    expect(button?.disabled).toBe(false); await act(async () => { button!.click(); await Promise.resolve(); });
  };
  try {
    await act(async () => { root.render(React.createElement(MemoryRouter, null, React.createElement(DriveConnectionCard))); await Promise.resolve(); });
    await click('Změnit složku'); expect(host.textContent).toContain('Čekám na výběr složky');
    await act(async () => vi.advanceTimersByTimeAsync(120_000));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('neodpověděl včas');
    expect(host.textContent).toContain('Původní média'); expect(api.selectDriveFolder).not.toHaveBeenCalled();
    expect(host.querySelector('[aria-busy="false"]')).not.toBeNull();
    await click('Změnit složku'); await click('Zrušit výběr složky');
    expect(host.textContent).toContain('Výběr složky byl zrušen.'); expect(api.selectDriveFolder).not.toHaveBeenCalled();
    vi.mocked(api.selectDriveFolder).mockResolvedValue({ ...connected, folder: { id: 'replacement', name: 'Nová média', url: '' } });
    await click('Změnit složku');
    await act(async () => { f.receive({ action: 'picked', docs: [{ id: 'replacement', mimeType: folderMime }] }); await Promise.resolve(); });
    expect(api.selectDriveFolder).toHaveBeenCalledExactlyOnceWith('replacement'); expect(host.textContent).toContain('Nová média');
    expect(host.textContent).not.toContain('synthetic-token');
  } finally { await act(async () => { root.unmount(); await Promise.resolve(); }); host.remove(); }
});

it('bounds script loading failure and allows a fresh attempt without stale handlers', async () => {
  // This loader test follows the successful shared-load fixture: reload only the
  // picker module so the cached SDK promise does not affect the network fixture.
  vi.resetModules();
  const fresh = await import('../apps/web/src/features/drive/picker');
  vi.stubGlobal('google', undefined); vi.stubGlobal('gapi', undefined);
  const scripts: HTMLScriptElement[] = [];
  vi.spyOn(document.head, 'append').mockImplementation((...nodes) => { scripts.push(nodes[0] as HTMLScriptElement); });
  const selection = fresh.openDriveFolderPicker(credentials());
  const assertion = expect(selection).rejects.toMatchObject({ pickerCode: 'unavailable' });
  const script = scripts[0]!; const remove = vi.spyOn(script, 'remove');
  expect(script.src).toBe('https://apis.google.com/js/api.js'); await vi.advanceTimersByTimeAsync(15_000); await assertion;
  expect(remove).toHaveBeenCalledOnce(); expect(script.onload).toBeNull(); expect(script.onerror).toBeNull();
  const retry = fresh.openDriveFolderPicker(credentials());
  const retryAssertion = expect(retry).rejects.toMatchObject({ pickerCode: 'unavailable' });
  scripts[1]!.dispatchEvent(new Event('error'));
  await retryAssertion; expect(vi.getTimerCount()).toBe(0);
});
