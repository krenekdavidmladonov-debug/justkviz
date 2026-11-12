import { EmailDeliveryError } from './errors.js';
import { mailbox } from './gmail.js';
import { requireEmailEmulator } from './token-vault.js';

export const EMAIL_STAGING_PROJECT = 'filmovy-kviz-v2-staging';
export const EMAIL_KEYRING_SECRET = 'EMAIL_TOKEN_KEYRING';
export interface RegistrationEmailActivation {
  readonly activatedAtMillis: number;
  readonly recipient?: string;
  /** Absence retains the original selected-recipient deployment contract. */
  readonly recipientPolicy?: 'future-public-registration';
}

export interface RegistrationOwnerNotificationActivation {
  readonly activatedAtMillis: number;
  readonly recipient: string;
  readonly ownerUid: string;
}

/** Independent, default-off opt-in; malformed notification config never blocks registration. */
export function registrationOwnerNotificationActivation(environment: NodeJS.ProcessEnv = process.env): RegistrationOwnerNotificationActivation | null {
  const mode = environment.REGISTRATION_OWNER_NOTIFICATION_MODE;
  if (mode === undefined || mode === 'off') return null;
  try {
    if (mode === 'emulator') {
      const project = requireEmailEmulator(environment);
      if ([environment.GCLOUD_PROJECT, environment.GOOGLE_CLOUD_PROJECT].some(value => value !== undefined && value !== project)) return null;
      if (environment.FIREBASE_CONFIG !== undefined && (JSON.parse(environment.FIREBASE_CONFIG) as { projectId?: unknown }).projectId !== project) return null;
    } else if (mode !== 'staging' || !registrationEmailActivation(environment)) return null;
    const cutoff = environment.REGISTRATION_OWNER_NOTIFICATION_ACTIVATED_AT ?? '';
    const ownerUid = environment.REGISTRATION_OWNER_NOTIFICATION_OWNER_UID ?? '';
    if (!/^[a-zA-Z0-9_-]{1,128}$/u.test(ownerUid)
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(cutoff)
      || !Number.isFinite(Date.parse(cutoff)) || new Date(cutoff).toISOString() !== cutoff) return null;
    return { recipient: mailbox(environment.REGISTRATION_OWNER_NOTIFICATION_RECIPIENT ?? ''), ownerUid, activatedAtMillis: Date.parse(cutoff) };
  } catch { return null; }
}

/** This allowlist never widens the participant recipient policy. */
export function allowedRegistrationOwnerNotificationIntent(intent: Record<string, unknown>, activation: RegistrationOwnerNotificationActivation): boolean {
  const createdAt = timestampMillis(intent.createdAt), registrationCreatedAt = timestampMillis(intent.registrationCreatedAt);
  return intent.type === 'registration-organizer-notification' && intent.recipientPolicy === 'future-public-registration-owner'
    && intent.provenance === 'public-registration-create' && intent.ownerUid === activation.ownerUid && intent.recipient === activation.recipient
    && createdAt !== undefined && createdAt >= activation.activatedAtMillis && registrationCreatedAt === createdAt;
}

// No parameter declarations or secret reads during Functions discovery.
export function emailEmulatorRuntime(environment: NodeJS.ProcessEnv = process.env): boolean {
  return environment.FUNCTIONS_EMULATOR === 'true' || Boolean(environment.FIRESTORE_EMULATOR_HOST)
    || (environment.GCLOUD_PROJECT ?? environment.GOOGLE_CLOUD_PROJECT ?? '').startsWith('demo-');
}

export function registrationEmailActivation(environment: NodeJS.ProcessEnv = process.env): RegistrationEmailActivation | null {
  const mode = environment.REGISTRATION_EMAIL_MODE;
  if (mode === undefined || mode === 'off') return null;
  const projects = [environment.GCLOUD_PROJECT, environment.GOOGLE_CLOUD_PROJECT].filter(value => value !== undefined);
  if (environment.FIREBASE_CONFIG !== undefined) {
    try {
      const config = JSON.parse(environment.FIREBASE_CONFIG) as { projectId?: unknown };
      if (!config || config.projectId !== EMAIL_STAGING_PROJECT) throw new Error();
    } catch { throw new EmailDeliveryError('configuration-invalid', false); }
  }
  const cutoff = environment.REGISTRATION_EMAIL_ACTIVATED_AT ?? '';
  if (mode !== 'staging' || emailEmulatorRuntime(environment) || projects.length === 0
    || (environment.FUNCTIONS_EMULATOR !== undefined && environment.FUNCTIONS_EMULATOR !== 'false')
    || projects.some(project => project !== EMAIL_STAGING_PROJECT)
    || Object.keys(environment).some(key => key.endsWith('_EMULATOR_HOST') && Boolean(environment[key]))
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(cutoff)
    || !Number.isFinite(Date.parse(cutoff)) || new Date(cutoff).toISOString() !== cutoff) {
    throw new EmailDeliveryError('configuration-invalid', false);
  }
  const policy = environment.REGISTRATION_EMAIL_RECIPIENT_POLICY ?? 'selected';
  if (policy === 'future-public-registration') return { activatedAtMillis: Date.parse(cutoff), recipientPolicy: policy };
  if (policy !== 'selected') throw new EmailDeliveryError('configuration-invalid', false);
  return { activatedAtMillis: Date.parse(cutoff), recipient: mailbox(environment.REGISTRATION_EMAIL_ALLOWED_RECIPIENT ?? '') };
}

export function registrationEmailSecrets(environment: NodeJS.ProcessEnv = process.env): string[] {
  return registrationEmailActivation(environment) ? [EMAIL_KEYRING_SECRET] : [];
}

export function registrationEmailEnabled(environment: NodeJS.ProcessEnv = process.env): boolean {
  if (registrationEmailActivation(environment)) return true;
  if (!emailEmulatorRuntime(environment)) return false;
  requireEmailEmulator(environment);
  return true;
}

export function registrationEmailRecipientEligible(recipient: string, environment: NodeJS.ProcessEnv = process.env): boolean {
  const activation = registrationEmailActivation(environment);
  if (activation?.recipientPolicy === 'future-public-registration') {
    try { mailbox(recipient); return true; } catch { return false; }
  }
  return activation ? recipient === activation.recipient : registrationEmailEnabled(environment);
}

function timestampMillis(value: unknown): number | undefined {
  const timestamp = value as { toMillis?: () => number } | undefined;
  if (typeof timestamp?.toMillis !== 'function') return undefined;
  const millis = timestamp.toMillis();
  return Number.isFinite(millis) ? millis : undefined;
}

/** Only canonical server registration fields can establish future-online origin. */
export function futurePublicRegistrationEligible(registration: Record<string, unknown>, nowMillis: number, activation: RegistrationEmailActivation): boolean {
  const createdAt = timestampMillis(registration.createdAt);
  return activation.recipientPolicy === 'future-public-registration' && registration.source !== 'manual'
    && typeof registration.managementTokenHash === 'string' && /^[a-f0-9]{64}$/u.test(registration.managementTokenHash)
    && Number.isSafeInteger(nowMillis) && createdAt !== undefined && createdAt >= activation.activatedAtMillis
    && createdAt <= nowMillis && nowMillis >= activation.activatedAtMillis;
}

// Used again inside the delivery lease transaction, before any secret/provider resolution.
export function allowedRegistrationEmailIntent(intent: Record<string, unknown>, activation: RegistrationEmailActivation): boolean {
  const createdAt = timestampMillis(intent.createdAt);
  if (!['registration-confirmed', 'registration-updated', 'registration-cancelled'].includes(intent.type as string)
    || createdAt === undefined || createdAt < activation.activatedAtMillis) return false;
  if (activation.recipientPolicy !== 'future-public-registration') return intent.recipient === activation.recipient;
  const registrationCreatedAt = timestampMillis(intent.registrationCreatedAt);
  if (intent.recipientPolicy !== 'future-public-registration' || registrationCreatedAt === undefined
    || registrationCreatedAt < activation.activatedAtMillis || registrationCreatedAt > createdAt) return false;
  try { mailbox(intent.recipient as string); return true; } catch { return false; }
}
