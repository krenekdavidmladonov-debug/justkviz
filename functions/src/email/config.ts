import { HttpsError } from 'firebase-functions/v2/https';

import { EmailDeliveryError } from './errors.js';
import { GmailEmailTransport } from './gmail.js';
import { createTokenVault, emulatorTokenVault, type TokenVault } from './token-vault.js';
import { emailEmulatorRuntime, EMAIL_KEYRING_SECRET, registrationEmailActivation } from './runtime.js';

export { emailEmulatorRuntime } from './runtime.js';
// String bindings are supported by Functions v2; values are read only at invocation.
export const gmailWorkerSecrets: string[] = registrationEmailActivation()
  ? [EMAIL_KEYRING_SECRET, 'GMAIL_OAUTH_CLIENT_ID', 'GMAIL_OAUTH_CLIENT_SECRET', 'GMAIL_OAUTH_REFRESH_TOKEN'] : [];

export function keyringVault(serialized: string): TokenVault {
  try {
    const data = JSON.parse(serialized) as { activeKeyId: string; keys: Record<string, string> };
    if (!/^[a-zA-Z0-9_-]{1,64}$/u.test(data.activeKeyId) || !data.keys || Array.isArray(data.keys) || Object.keys(data.keys).length > 10) throw new Error();
    const vaults = new Map(Object.entries(data.keys).map(([id, value]) => {
      if (!/^[a-zA-Z0-9_-]{1,64}$/u.test(id) || typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/u.test(value)) throw new Error();
      const key = Buffer.from(value, 'base64');
      if (key.length !== 32 || key.toString('base64') !== value) throw new Error();
      return [id, createTokenVault(id, key)] as const;
    }));
    const active = vaults.get(data.activeKeyId);
    if (!active) throw new Error();
    return { seal: (token, context) => active.seal(token, context), open: (envelope, context) => {
      const selected = vaults.get(envelope.keyId);
      if (!selected) throw new Error('Management link protection is unavailable.');
      return selected.open(envelope, context);
    } };
  } catch { throw new EmailDeliveryError('configuration-invalid', false); }
}

export function registrationTokenVault(): TokenVault {
  try {
    if (emailEmulatorRuntime()) return emulatorTokenVault();
    if (!registrationEmailActivation()) throw new Error();
    return keyringVault(process.env.EMAIL_TOKEN_KEYRING ?? '');
  } catch { throw new HttpsError('failed-precondition', 'Registration email link protection is not configured.'); }
}

export function cloudEmailOrigin(): string {
  // Exact V2 origins only; retain the Firebase addresses for old links and rollback.
  const origin = process.env.EMAIL_PUBLIC_ORIGIN;
  if (!registrationEmailActivation() || !origin || !['https://justkviz.cz', 'https://justkviz-v2.web.app', 'https://filmovy-kviz-v2-staging.web.app'].includes(origin)) throw new EmailDeliveryError('configuration-invalid', false);
  return origin;
}

export function cloudGmailTransport(): GmailEmailTransport {
  if (!registrationEmailActivation()) throw new EmailDeliveryError('configuration-invalid', false);
  return new GmailEmailTransport({ clientId: process.env.GMAIL_OAUTH_CLIENT_ID ?? '', clientSecret: process.env.GMAIL_OAUTH_CLIENT_SECRET ?? '', refreshToken: process.env.GMAIL_OAUTH_REFRESH_TOKEN ?? '',
    sender: process.env.GMAIL_SENDER_EMAIL ?? '', replyTo: process.env.GMAIL_REPLY_TO ?? '', projectId: process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? '' }, fetch);
}
