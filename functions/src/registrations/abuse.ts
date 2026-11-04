import { createHash } from 'node:crypto';
import { warn } from 'firebase-functions/logger';
import type { DocumentReference, Transaction } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

export const registrationAbusePolicy = { burst: 3, refillMillis: 600_000 } as const;
export interface RegistrationAbuseState {
  readonly tokens: number;
  readonly updatedAtMillis: number;
}

export function registrationContactKey(eventId: string, normalizedEmail: string): string {
  return createHash('sha256').update(JSON.stringify(['justkviz/registration-contact/v1', eventId, normalizedEmail.trim().toLowerCase()])).digest('hex');
}

/** A contact is a submitted destination, not proof of a person's identity.
 * Rotating addresses remains possible. No IP, browser clock or App Check required.
 */
export function nextRegistrationAbuseState(value: unknown, now: number): RegistrationAbuseState {
  if (!Number.isSafeInteger(now) || now < 0) throw new HttpsError('unavailable', 'Registration protection is unavailable.');
  let tokens: number = registrationAbusePolicy.burst;
  let updatedAtMillis = now;
  if (value !== undefined) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpsError('unavailable', 'Registration protection is unavailable.');
    const old = value as Partial<RegistrationAbuseState>;
    if (typeof old.tokens !== 'number' || !Number.isFinite(old.tokens) || old.tokens < 0 || old.tokens > registrationAbusePolicy.burst
      || !Number.isSafeInteger(old.updatedAtMillis) || (old.updatedAtMillis as number) < 0) {
      throw new HttpsError('unavailable', 'Registration protection is unavailable.');
    }
    updatedAtMillis = Math.max(now, old.updatedAtMillis as number);
    tokens = Math.min(registrationAbusePolicy.burst, old.tokens + Math.max(0, now - (old.updatedAtMillis as number)) / registrationAbusePolicy.refillMillis);
  }
  if (tokens < 1) {
    throw new HttpsError('resource-exhausted', 'Too many registration requests. Try again later.', {
      reason: 'registration-rate-limit',
      retryAfterSeconds: Math.ceil((updatedAtMillis - now + (1 - tokens) * registrationAbusePolicy.refillMillis) / 1000),
    });
  }
  return { tokens: tokens - 1, updatedAtMillis };
}

/** Last read before create writes; only a committed new registration consumes.
 * Independent documents prevent another contact from exhausting a shared bucket.
 */
export async function consumeRegistrationBudget(tx: Transaction, eventRef: DocumentReference, normalizedEmail: string): Promise<void> {
  const ref = eventRef.collection('registrationAbuse').doc(registrationContactKey(eventRef.id, normalizedEmail));
  const old = await tx.get(ref);
  tx.set(ref, nextRegistrationAbuseState(old.data(), Date.now()));
}

export function isRegistrationThrottle(error: unknown): boolean {
  if (!(error instanceof HttpsError) || error.code !== 'resource-exhausted') return false;
  const details = error.details;
  return !!details && typeof details === 'object' && 'reason' in details && details.reason === 'registration-rate-limit';
}
/** Outside the transaction retry callback; no payload or identifiers are logged. */
export function reportRegistrationThrottle(error: unknown): never {
  if (isRegistrationThrottle(error)) warn('justkviz.registration.throttled', { operation: 'createEventRegistration', code: 'resource-exhausted' });
  throw error;
}