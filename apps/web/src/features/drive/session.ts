import { completeDriveConnection, readDriveConnection } from './api';

const stateKey = 'justkviz.drive.connection';
const stateLifetime = 10 * 60 * 1000;
interface PendingConnection { uid: string; state: string; createdAt: number }
export type DriveConnectionResult = 'connected' | 'cancelled' | 'failed' | 'expired' | 'forbidden';
let completed: { uid: string; state: string; promise: Promise<DriveConnectionResult> } | undefined;

/** OAuth pending state is origin-bound, so legacy tabs reconnect from the canonical Settings page. */
export function driveConnectionSettingsDestination(origin: string): string | null {
  return ['https://justkviz-v2.web.app', 'https://justkviz-v2.firebaseapp.com',
    'https://filmovy-kviz-v2-staging.web.app', 'https://filmovy-kviz-v2-staging.firebaseapp.com'].includes(origin)
    ? 'https://justkviz.cz/admin/settings' : null;
}

export function clearDriveConnectionState() { try { sessionStorage.removeItem(stateKey); } catch { /* Storage may be blocked by the browser. */ } }
function readPending(): PendingConnection | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(stateKey) ?? 'null') as PendingConnection | null;
    if (!value || typeof value.uid !== 'string' || typeof value.state !== 'string' || typeof value.createdAt !== 'number') return null;
    return value;
  } catch { return null; }
}
export function clearForeignDriveConnectionState(uid: string | null) {
  const pending = readPending();
  if (!uid || !pending || pending.uid !== uid || Date.now() - pending.createdAt > stateLifetime) clearDriveConnectionState();
  if (completed && completed.uid !== uid) completed = undefined;
}
export function prepareDriveConnection(uid: string, state: string, authorizationUrl: string): string {
  const url = new URL(authorizationUrl);
  if (url.origin !== 'https://accounts.google.com' || url.pathname !== '/o/oauth2/v2/auth' || url.username || url.password || url.hash || !state || url.searchParams.get('state') !== state) {
    clearDriveConnectionState(); throw new Error('Invalid authorization destination');
  }
  completed = undefined;
  sessionStorage.setItem(stateKey, JSON.stringify({ uid, state, createdAt: Date.now() }));
  return url.href;
}
/** Only the pending state, UID and timestamp persist; codes and tokens never do. */
export function finishDriveConnection(uid: string, query: string): Promise<DriveConnectionResult> {
  const params = new URLSearchParams(query);
  const state = params.get('state');
  if (state && completed?.uid === uid && completed.state === state) return completed.promise;
  const pending = readPending();
  clearDriveConnectionState();
  if (!pending || pending.uid !== uid || !state || state !== pending.state || params.getAll('state').length !== 1 ||
    Date.now() - pending.createdAt > stateLifetime || pending.createdAt > Date.now()) return Promise.resolve('expired');
  if (params.has('error')) {
    const promise = Promise.resolve<DriveConnectionResult>(params.get('error') === 'access_denied' ? 'cancelled' : 'failed');
    completed = { uid, state, promise }; return promise;
  }
  const code = params.get('code');
  if (!code || params.getAll('code').length !== 1) return Promise.resolve('failed');
  const promise = (async (): Promise<DriveConnectionResult> => {
    try {
      await completeDriveConnection(code, state);
      const status = await readDriveConnection();
      return status.status === 'connected' || status.status === 'folder-required' ? 'connected' : 'failed';
    } catch { return 'failed'; }
  })();
  completed = { uid, state, promise };
  return promise;
}
