import type { DriveFolderPickerCredentials } from './api';

interface PickerView {
  setIncludeFolders(value: boolean): PickerView;
  setSelectFolderEnabled(value: boolean): PickerView;
  setMimeTypes(value: string): PickerView;
  setMode(value: string): PickerView;
}
interface Picker { setVisible(value: boolean): void; dispose?(): void }
interface PickerEvent { action?: string; docs?: unknown }
interface PickerBuilder {
  addView(view: PickerView): PickerBuilder;
  setOAuthToken(value: string): PickerBuilder;
  setDeveloperKey(value: string): PickerBuilder;
  setAppId(value: string): PickerBuilder;
  setOrigin(value: string): PickerBuilder;
  setTitle(value: string): PickerBuilder;
  setCallback(callback: (event: PickerEvent) => void): PickerBuilder;
  build(): Picker;
}
interface GooglePicker {
  DocsView: new (viewId: string) => PickerView;
  PickerBuilder: new () => PickerBuilder;
  ViewId: { FOLDERS: string };
  DocsViewMode: { LIST: string };
  Action: { PICKED: string; CANCEL: string; ERROR?: string };
}

export type DrivePickerErrorCode = 'unavailable' | 'expired' | 'timeout' | 'invalid-selection';
export class DrivePickerError extends Error {
  constructor(readonly pickerCode: DrivePickerErrorCode) {
    super('Google Drive folder picker failed');
    this.name = 'DrivePickerError';
  }
}
type PickerWindow = Window & typeof globalThis & {
  gapi?: { load(name: string, options: { callback: () => void; onerror: () => void; timeout: number; ontimeout: () => void }): void };
  google?: { picker?: GooglePicker };
};
let loading: Promise<GooglePicker> | undefined;
function loadPicker(): Promise<GooglePicker> {
  const host = window as PickerWindow;
  if (host.google?.picker) return Promise.resolve(host.google.picker);
  if (loading) return loading;
  loading = new Promise<GooglePicker>((resolve, reject) => {
    const script = document.createElement('script');
    let settled = false;
    const timeout = window.setTimeout(fail, 15000);
    function fail() {
      if (settled) return;
      settled = true; window.clearTimeout(timeout); script.onload = null; script.onerror = null; script.remove();
      reject(new DrivePickerError('unavailable'));
    }
    function ready() {
      if (settled) return;
      if (!host.gapi) { fail(); return; }
      try { host.gapi.load('picker', { callback: () => {
        if (settled) return;
        window.clearTimeout(timeout);
        if (host.google?.picker) { settled = true; script.onload = null; script.onerror = null; resolve(host.google.picker); } else fail();
      }, onerror: fail, timeout: 15000, ontimeout: fail }); } catch { fail(); }
    }
    if (host.gapi) ready();
    else {
      script.src = 'https://apis.google.com/js/api.js'; script.async = true;
      script.onload = ready; script.onerror = fail; document.head.append(script);
    }
  }).catch(error => { loading = undefined; throw error; });
  return loading;
}

/** Google receives the short-lived token in memory; the application receives only a folder ID. */
export function openDriveFolderPicker(credentials: DriveFolderPickerCredentials, signal?: AbortSignal): Promise<string | null> {
  if (signal?.aborted) return Promise.resolve(null);
  if (!Number.isFinite(credentials.expiresAt) || credentials.expiresAt <= Date.now()) return Promise.reject(new DrivePickerError('expired'));
  return new Promise((resolve, reject) => {
    let picker: Picker | undefined;
    let settled = false;
    let timeout: number | undefined;
    const close = () => {
      // A broken third-party UI must not prevent releasing our own pending state.
      try { picker?.setVisible(false); } catch { /* Continue cleanup. */ }
      try { picker?.dispose?.(); } catch { /* Continue cleanup. */ }
    };
    const finish = (id: string | null, failure?: DrivePickerError) => {
      if (settled) return;
      settled = true; window.clearTimeout(timeout); signal?.removeEventListener('abort', cancel); close();
      if (failure) reject(failure); else resolve(id);
    };
    const cancel = () => finish(null);
    signal?.addEventListener('abort', cancel, { once: true });
    void loadPicker().then(api => {
      if (settled) return;
      if (credentials.expiresAt <= Date.now()) { finish(null, new DrivePickerError('expired')); return; }
      try {
        const folders = new api.DocsView(api.ViewId.FOLDERS).setIncludeFolders(true).setSelectFolderEnabled(true)
          .setMimeTypes('application/vnd.google-apps.folder').setMode(api.DocsViewMode.LIST);
        picker = new api.PickerBuilder().addView(folders).setOAuthToken(credentials.accessToken)
          .setDeveloperKey(credentials.developerKey).setAppId(credentials.appId).setOrigin(window.location.origin)
          .setTitle(`Vyberte složku pro média (${credentials.suggestedFolderName})`)
          .setCallback(event => {
            if (!event || settled) return;
            if (event.action === api.Action.CANCEL) finish(null);
            if (api.Action.ERROR && event.action === api.Action.ERROR) finish(null, new DrivePickerError('unavailable'));
            if (event.action === api.Action.PICKED) {
              const folder: unknown = Array.isArray(event.docs) && event.docs.length === 1 ? event.docs[0] : undefined;
              if (folder && typeof folder === 'object' && 'mimeType' in folder && folder.mimeType === 'application/vnd.google-apps.folder'
                && 'id' in folder && typeof folder.id === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(folder.id)) finish(folder.id);
              else finish(null, new DrivePickerError('invalid-selection'));
            }
          }).build();
        if (settled) { close(); return; }
        // Google may render a blank iframe without delivering any callback.
        // Bound this interactive session as well as the separate library load.
        timeout = window.setTimeout(() => finish(null, new DrivePickerError('timeout')), Math.min(120_000, credentials.expiresAt - Date.now()));
        picker.setVisible(true);
      } catch { finish(null, new DrivePickerError('unavailable')); }
    }, () => finish(null, new DrivePickerError('unavailable')));
  });
}
