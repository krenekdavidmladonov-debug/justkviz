import { eventOperational } from '@filmovy-kviz/quiz-domain';
import { randomUUID } from 'node:crypto';
import { Timestamp, type DocumentReference, type Firestore } from 'firebase-admin/firestore';

import { EmailDeliveryError, type DeliveryErrorCode } from './errors.js';
import type { EmailIntent } from './intent.js';
import { ownerNotificationIntentId, registrationOwnerNotificationAuthorized } from './organizer.js';
import { allowedRegistrationOwnerNotificationIntent, registrationOwnerNotificationActivation } from './runtime.js';
import { eventTeamMessage, messageCopy, teamMessageEventTitle, type TeamMessageContent } from './team-message.js';
import { managementUrl, registrationEmail, registrationOwnerNotification, type EmailBody } from './templates.js';
import type { TokenEnvelope, TokenVault } from './token-vault.js';

export interface EmailMessage extends EmailBody {
  readonly idempotencyKey: string;
  readonly to: string;
  readonly createdAtMillis?: number;
}
export interface EmailTransport {
  // Retryable means known non-acceptance. Uncertain send outcomes must never be
  // resubmitted automatically; Gmail offers no stable Message-ID deduplication.
  send(message: EmailMessage): Promise<void>;
}
export const MAX_EMAIL_ATTEMPTS = 5;
export const MAX_EMAIL_AGE_MS = 24 * 60 * 60 * 1000;
export const EMAIL_LEASE_MS = 120_000;
export function retryDelayMillis(attempt: number): number { return Math.min(600_000, 30_000 * 2 ** (attempt - 1)); }
type Resolve<T> = T | (() => T);
const resolve = <T>(value: Resolve<T>): T => typeof value === 'function' ? (value as () => T)() : value;

export async function readProtectedEnvelope<T = TokenEnvelope>(read: () => Promise<T | undefined>): Promise<T | undefined> {
  try { return await read(); }
  catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    if ([4, 8, 10, 13, 14, 'deadline-exceeded', 'resource-exhausted', 'aborted', 'internal', 'unavailable'].includes(code as string | number)) {
      throw new EmailDeliveryError('provider-unavailable', true);
    }
    throw new EmailDeliveryError('configuration-invalid', false);
  }
}

// Recipient/content always come from the committed server-owned intent, never a task.
export async function deliverRegistrationEmail(db: Firestore, ref: DocumentReference, transport: Resolve<EmailTransport>,
  vault: Resolve<TokenVault>, origin: Resolve<string>, clock: () => number = Date.now,
  allowIntent?: (intent: Record<string, unknown>) => boolean) {
  if (!/^events\/[^/]+\/emailIntents\/[^/]+$/u.test(ref.path)) throw new Error('Invalid email intent path.');
  const leaseId = randomUUID();
  const claimed = await db.runTransaction(async (transaction) => {
    const event = (await transaction.get(ref.parent.parent!)).data();
    if (!event || !eventOperational(event)) return { result: 'unchanged' as const };
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return { result: 'unchanged' as const };
    if (allowIntent && !allowIntent(snapshot.data() ?? {})) return { result: 'unchanged' as const };
    const intent = snapshot.data() as EmailIntent;
    if ((event.capabilityVersion ?? 0) !== (intent.capabilityVersion ?? 0)) return { result: 'unchanged' as const };
    if (intent.status === 'sent' || intent.status === 'failed') return { result: 'unchanged' as const };
    const now = Timestamp.fromMillis(clock());
    const uncertain = intent.status === 'processing' || intent.lastError === 'outcome-unknown';
    if (intent.leaseUntil && intent.leaseUntil.toMillis() > now.toMillis()) return { result: 'busy' as const };
    if (!uncertain && intent.status === 'pending' && intent.nextAttemptAt && intent.nextAttemptAt.toMillis() > now.toMillis()) return { result: 'pending' as const };
    const valid = intent.eventId === ref.parent.parent?.id && typeof intent.registrationId === 'string'
      && /^[a-zA-Z0-9_-]{1,150}$/u.test(intent.registrationId) && Number.isInteger(intent.attempts) && intent.attempts >= 0
      && intent.createdAt instanceof Timestamp && (['registration-confirmed', 'registration-updated', 'registration-cancelled'].includes(intent.type)
        || intent.type === 'registration-organizer-notification'
        || (intent.type === 'event-team-message' && /^[a-f0-9]{64}$/u.test(intent.campaignId)));
    if (!valid) {
      transaction.update(ref, { status: 'failed', lastError: 'configuration-invalid', leaseId: null, leaseUntil: null, updatedAt: now });
      return { result: 'failed' as const };
    }
    const organizer = intent.type === 'registration-organizer-notification';
    const registrationRef = intent.type === 'event-team-message' || organizer ? null : ref.parent.parent.collection('registrations').doc(intent.registrationId);
    const registration = registrationRef ? await transaction.get(registrationRef) : null;
    if (organizer) {
      const activation = registrationOwnerNotificationActivation();
      if (!activation || !allowedRegistrationOwnerNotificationIntent(intent as unknown as Record<string, unknown>, activation)) return { result: 'unchanged' as const };
      const canonical = (await transaction.get(ref.parent.parent.collection('registrations').doc(intent.registrationId))).data();
      const member = (await transaction.get(db.doc('memberships/' + activation.ownerUid))).data();
      if (ref.id !== ownerNotificationIntentId(intent.registrationId) || intent.createdAt.toMillis() > now.toMillis()
        || !canonical || canonical.eventId !== intent.eventId || canonical.source === 'manual' || !['accepted', 'cancelled'].includes(canonical.status as string)
        || !(canonical.createdAt instanceof Timestamp) || canonical.createdAt.toMillis() !== intent.createdAt.toMillis()
        || typeof canonical.managementTokenHash !== 'string' || !/^[a-f0-9]{64}$/u.test(canonical.managementTokenHash)
        || !registrationOwnerNotificationAuthorized(member, activation, intent.eventId, event)) {
        transaction.update(ref, { status: 'failed', lastError: 'configuration-invalid', leaseId: null, leaseUntil: null, updatedAt: now });
        return { result: 'failed' as const };
      }
    }
    const summary = registration?.data()?.emailDelivery as { intentId?: string } | undefined;
    // A crashed processing worker may already have sent. Lease expiry is not
    // evidence of non-acceptance, even when the crash actually preceded send.
    // Deployed legacy workers also persisted unknown outcomes as pending: those
    // records must not get one extra automatic submission after this upgrade.
    const exhausted = intent.attempts >= MAX_EMAIL_ATTEMPTS || now.toMillis() - intent.createdAt.toMillis() >= MAX_EMAIL_AGE_MS;
    const terminal = uncertain || exhausted;
    const status = terminal ? 'failed' : 'processing';
    transaction.update(ref, terminal
      ? { status, lastError: uncertain ? 'outcome-unknown' : 'attempts-exhausted', leaseId: null, leaseUntil: null, nextAttemptAt: null, updatedAt: now }
      : { status, attempts: intent.attempts + 1, updatedAt: now, leaseId, leaseUntil: Timestamp.fromMillis(now.toMillis() + EMAIL_LEASE_MS), nextAttemptAt: null });
    if (registrationRef && summary?.intentId === ref.id) transaction.update(registrationRef, { emailDelivery: { intentId: ref.id, type: intent.type, status, updatedAt: now } });
    return terminal ? { result: 'failed' as const } : { intent, registrationRef };
  });
  if (!claimed.intent) return claimed.result;
  const { intent, registrationRef } = claimed;
  let status: 'sent' | 'failed' | 'pending' = 'sent';
  let lastError: DeliveryErrorCode | null = null;
  try {
    // Resolve secrets only after a claim. Missing configuration becomes terminal.
    const selectedTransport = resolve(transport);
    let body: EmailBody;
    if (intent.type === 'registration-organizer-notification') {
      body = registrationOwnerNotification(intent.content, resolve(origin), intent.eventId);
    } else if (intent.type === 'event-team-message') {
      const campaign = await readProtectedEnvelope(async () => (await ref.parent.parent!.collection('emailCampaigns').doc(intent.campaignId).get()).data());
      if (!campaign || campaign.eventId !== intent.eventId || !campaign.content) throw new EmailDeliveryError('configuration-invalid', false);
      const content = campaign.content as TeamMessageContent;
      let brandingOrigin: string | undefined;
      try { brandingOrigin = resolve(origin); } catch { /* Branding is optional for organizational messages. */ }
      body = eventTeamMessage({ ...messageCopy({ subject: content.subject, message: content.message }), eventTitle: teamMessageEventTitle(content.eventTitle) }, brandingOrigin);
    } else {
      const selectedVault = resolve(vault);
      const selectedOrigin = resolve(origin);
      let link: string | undefined;
      if (intent.type === 'registration-confirmed' || intent.type === 'registration-updated') {
        const protectedLink = await readProtectedEnvelope(async () => (await ref.parent.parent!.collection('emailSecrets').doc(ref.id).get()).data());
        if (protectedLink) {
          if (!protectedLink.envelope) throw new EmailDeliveryError('configuration-invalid', false);
          link = managementUrl(selectedOrigin, intent.eventId, intent.registrationId, selectedVault.open(protectedLink.envelope as TokenEnvelope, ref.path));
        } else if (intent.type === 'registration-confirmed') throw new EmailDeliveryError('configuration-invalid', false);
        // Historical update intents never had an envelope. Keep them deliverable
        // without a CTA; do not mint a capability, intent or replacement message.
      }
      body = registrationEmail(intent.type, intent.content, link, selectedOrigin);
    }
    const currentEvent = (await ref.parent.parent!.get()).data();
    if (!currentEvent || !eventOperational(currentEvent) || (currentEvent.capabilityVersion ?? 0) !== (intent.capabilityVersion ?? 0)) return 'unchanged';
    if (intent.type === 'registration-organizer-notification') {
      const activation = registrationOwnerNotificationActivation();
      const member = activation ? (await db.doc('memberships/' + activation.ownerUid).get()).data() : undefined;
      if (!activation || !allowedRegistrationOwnerNotificationIntent(intent as unknown as Record<string, unknown>, activation)
        || !registrationOwnerNotificationAuthorized(member, activation, intent.eventId, currentEvent)) throw new EmailDeliveryError('configuration-invalid', false);
    }
    await selectedTransport.send({ idempotencyKey: ref.path, to: intent.recipient, createdAtMillis: intent.createdAt.toMillis(),
      ...body });
  } catch (error) {
    lastError = error instanceof EmailDeliveryError ? error.code : 'delivery-unavailable';
    status = error instanceof EmailDeliveryError && error.code !== 'outcome-unknown' && error.retryable && intent.attempts + 1 < MAX_EMAIL_ATTEMPTS
      && clock() - intent.createdAt.toMillis() < MAX_EMAIL_AGE_MS ? 'pending' : 'failed';
  }
  const recorded = await db.runTransaction(async (transaction) => {
    const event = (await transaction.get(ref.parent.parent!)).data();
    if (!event || !eventOperational(event)) return false;
    const current = await transaction.get(ref);
    const registration = registrationRef ? await transaction.get(registrationRef) : null;
    if (current.data()?.leaseId !== leaseId || (event.capabilityVersion ?? 0) !== (intent.capabilityVersion ?? 0)) return false;
    const now = Timestamp.fromMillis(clock());
    transaction.update(ref, { status, updatedAt: now, sentAt: status === 'sent' ? now : null, lastError,
      leaseId: null, leaseUntil: null, nextAttemptAt: status === 'pending' ? Timestamp.fromMillis(now.toMillis() + retryDelayMillis(intent.attempts + 1)) : null });
    const summary = registration?.data()?.emailDelivery as { intentId?: string } | undefined;
    if (registrationRef && summary?.intentId === ref.id) transaction.update(registrationRef, { emailDelivery: { intentId: ref.id, type: intent.type, status, updatedAt: now } });
    // Keep encrypted envelope/receipt for create-response recovery after acceptance.
    return true;
  });
  return recorded ? status : 'busy';
}
