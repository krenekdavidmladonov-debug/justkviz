import QRCode from 'qrcode';
import type { Credential } from './api';
import { publicRegistrationUrl } from '../events/registrationSharing';
export function refereeUrl(credential: Credential, config: { projectId: string; useEmulators: boolean }, origin: string) {
  if (!/^[A-Za-z0-9_-]{1,150}$/u.test(credential.accessId) || !/^[A-Za-z0-9_-]{43}$/u.test(credential.key)) throw new Error('Neplatný přístup.');
  const base = new URL(publicRegistrationUrl(credential.eventId, config, origin));
  return base.origin + '/referee/' + credential.eventId + '#access=' + credential.accessId + '&key=' + credential.key;
}
export const refereeQr = (url: string) => QRCode.toDataURL(url, { margin: 4, scale: 8, errorCorrectionLevel: 'M' });
const storageKey = (eventId: string) => 'referee-access-v2:' + eventId;
const legacyKey = (eventId: string) => 'referee-access-v1:' + eventId;
export const refereeAccessMessages = {
  'not-found': 'Odkaz je neplatný nebo byl nahrazen novým. Otevřete znovu odkaz nebo QR od organizátora.',
  revoked: 'Organizátor tento přístup odebral.',
  expired: 'Platnost odkazu vypršela. Požádejte organizátora o nový odkaz.',
  'issuer-inactive': 'Přístup zneplatněn – správce, který ho vydal, už nemá oprávnění. Požádejte o nový odkaz.',
  'event-closed': 'Akce už není otevřená pro zápis bodů.',
};
export type RefereeAccessReason = keyof typeof refereeAccessMessages;
export function refereeAccessReason(issue: unknown): RefereeAccessReason | null {
  const error = issue as { code?: string; details?: { refereeAccess?: unknown } } | null;
  const reason = error?.details?.refereeAccess;
  return error?.code === 'functions/permission-denied' && typeof reason === 'string' && Object.hasOwn(refereeAccessMessages, reason) ? reason as RefereeAccessReason : null;
}
function validCredential(value: unknown, eventId: string): value is Credential {
  const data = value as Partial<Credential> | null;
  return data?.eventId === eventId && typeof data.accessId === 'string' && /^[A-Za-z0-9_-]{1,150}$/u.test(data.accessId)
    && typeof data.key === 'string' && /^[A-Za-z0-9_-]{43}$/u.test(data.key);
}
function storedReferee(eventId: string): unknown {
  try { return JSON.parse(localStorage.getItem(storageKey(eventId)) ?? 'null') as unknown; } catch { return null; }
}
export function rememberReferee(credential: Credential, expiresAt: string | null) {
  try {
    const stored = storedReferee(credential.eventId);
    // An older open tab must not overwrite a replacement link from another tab.
    if (expiresAt !== null && validCredential(stored, credential.eventId) && (stored.accessId !== credential.accessId || stored.key !== credential.key)) return;
    localStorage.setItem(storageKey(credential.eventId), JSON.stringify({ ...credential, expiresAt }));
  } catch { /* Storage may be unavailable; the open panel still works. */ }
}
export function consumeRefereeAccess(eventId: string): { credential: Credential | null; reason: RefereeAccessReason | null } {
  const fragment = window.location.hash;
  // Remove secrets before SDK requests, including invalid inputs. replaceState also removes this history entry's fragment.
  if (fragment) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
  let legacy: string | null = null;
  try { legacy = sessionStorage.getItem(legacyKey(eventId)); sessionStorage.removeItem(legacyKey(eventId)); } catch { /* Storage may be disabled. */ }
  if (fragment) {
    const input = new URLSearchParams(fragment.slice(1));
    const accessId = input.get('access') ?? '', key = input.get('key') ?? '';
    const credential = { eventId, accessId, key };
    if (!validCredential(credential, eventId)) { forgetReferee(eventId); return { credential: null, reason: 'not-found' }; }
    // Expiry is learned from the first server-confirmed read, including migrated v1 grants.
    rememberReferee(credential, null); return { credential, reason: null };
  }
  try {
    const stored = localStorage.getItem(storageKey(eventId));
    const data: unknown = JSON.parse(stored ?? legacy ?? 'null');
    if (validCredential(data, eventId)) {
      const expiresAt = (data as Credential & { expiresAt?: unknown }).expiresAt;
      if (typeof expiresAt === 'string' && Number.isFinite(Date.parse(expiresAt))) {
        // Device clocks can be ahead. Only the server decides expiry; retain a
        // seven-day grace period before cleaning up an unused stored credential.
        if (Date.parse(expiresAt) + 7 * 86400000 < Date.now()) { forgetReferee(eventId); return { credential: null, reason: 'expired' }; }
      } else if (expiresAt != null) { forgetReferee(eventId); return { credential: null, reason: 'not-found' }; }
      const credential = { eventId, accessId: data.accessId, key: data.key };
      if (!stored) rememberReferee(credential, null);
      return { credential, reason: null };
    }
  } catch { /* Invalid or unavailable storage is treated as a missing link. */ }
  forgetReferee(eventId); return { credential: null, reason: 'not-found' };
}
export function forgetReferee(eventId: string, credential?: Credential) {
  try {
    const stored = storedReferee(eventId);
    if (credential && validCredential(stored, eventId) && (stored.accessId !== credential.accessId || stored.key !== credential.key)) return;
    localStorage.removeItem(storageKey(eventId));
  } catch { /* Storage may be disabled. */ }
  try { sessionStorage.removeItem(legacyKey(eventId)); } catch { /* Storage may be disabled. */ }
}
