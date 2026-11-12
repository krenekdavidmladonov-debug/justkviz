import { HttpsError } from 'firebase-functions/v2/https';
import { createTokenVault, type TokenEnvelope, type TokenVault } from '../email/token-vault.js';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const CALLBACK_PATH = '/admin/settings/drive/callback';
export interface DriveConfiguration {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  developerKey: string;
  appId: string;
  vault: TokenVault;
}
export function driveKeyring(raw: string): TokenVault {
  try {
    if (raw.length > 16_384) throw new Error();
    const parsed = JSON.parse(raw) as { activeKeyId?: unknown; keys?: Record<string, unknown> };
    if (typeof parsed.activeKeyId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/u.test(parsed.activeKeyId)
      || !parsed.keys || Object.keys(parsed.keys).length > 10) throw new Error();
    const vaults = new Map<string, TokenVault>();
    for (const [id, value] of Object.entries(parsed.keys)) {
      if (!/^[a-zA-Z0-9_-]{1,64}$/u.test(id) || typeof value !== 'string' || !/^[a-zA-Z0-9+/]{43}=$/u.test(value)) throw new Error();
      vaults.set(id, createTokenVault(id, Buffer.from(value, 'base64')));
    }
    const active = vaults.get(parsed.activeKeyId);
    if (!active) throw new Error();
    return { seal: (token, context) => active.seal(token, context), open: (envelope: TokenEnvelope, context) => {
      const selected = vaults.get(envelope.keyId);
      if (!selected) throw new Error('Drive token protection is unavailable.');
      return selected.open(envelope, context);
    } };
  } catch { throw new HttpsError('failed-precondition', 'Připojení Disku není nakonfigurované.'); }
}

export function driveConfiguration(env: NodeJS.ProcessEnv, secrets: { clientSecret: string; keyring: string }): DriveConfiguration | undefined {
  if (env.DRIVE_CONNECTION_ENABLED !== 'true') return undefined;
  try {
    const clientId = env.DRIVE_OAUTH_CLIENT_ID ?? '', redirectUri = env.DRIVE_OAUTH_REDIRECT_URI ?? '';
    const developerKey = env.DRIVE_PICKER_API_KEY ?? '', appId = env.DRIVE_PICKER_APP_ID ?? '';
    if (!/^[a-zA-Z0-9_-]{10,200}\.apps\.googleusercontent\.com$/u.test(clientId)
      || !/^[\x21-\x7e]{10,8192}$/u.test(secrets.clientSecret)
      || !/^[a-zA-Z0-9_-]{20,200}$/u.test(developerKey) || !/^[1-9]\d{4,24}$/u.test(appId)) return undefined;
    // Google revocation affects grants across clients in the same Cloud project.
    // Media OAuth/Picker must use a dedicated project, separate from V2/Gmail.
    if (appId === '177615774316' || !clientId.startsWith(appId + '-')) return undefined;
    const uri = new URL(redirectUri), project = env.GCLOUD_PROJECT ?? env.GOOGLE_CLOUD_PROJECT ?? '';
    const cloudOrigins = ['https://justkviz.cz', 'https://justkviz-v2.web.app', 'https://justkviz-v2.firebaseapp.com',
      'https://filmovy-kviz-v2-staging.web.app', 'https://filmovy-kviz-v2-staging.firebaseapp.com'];
    const localEndpoint = /^(?:localhost|127\.0\.0\.1|\[::1\]):([1-9]\d{0,4})$/u.exec(env.FIRESTORE_EMULATOR_HOST ?? '');
    const local = project.startsWith('demo-') && !!localEndpoint && Number(localEndpoint[1]) <= 65535
      && uri.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(uri.hostname) && !!uri.port;
    const cloud = !env.FUNCTIONS_EMULATOR && !env.FIRESTORE_EMULATOR_HOST && project === 'filmovy-kviz-v2-staging' && cloudOrigins.includes(uri.origin);
    if ((!local && !cloud) || uri.pathname !== CALLBACK_PATH || uri.search || uri.hash || uri.username || uri.password) return undefined;
    return { clientId, clientSecret: secrets.clientSecret, redirectUri, developerKey, appId, vault: driveKeyring(secrets.keyring) };
  } catch { return undefined; }
}

export function requireRealDriveRuntime(env: NodeJS.ProcessEnv = process.env): void {
  const project = env.GCLOUD_PROJECT ?? env.GOOGLE_CLOUD_PROJECT ?? '';
  if (project !== 'filmovy-kviz-v2-staging' || project.startsWith('demo-') || env.FUNCTIONS_EMULATOR || env.FIRESTORE_EMULATOR_HOST
    || env.FIREBASE_AUTH_EMULATOR_HOST || env.FIREBASE_STORAGE_EMULATOR_HOST) {
    throw new HttpsError('failed-precondition', 'Skutečný Disk není v místním prostředí dostupný.');
  }
}
