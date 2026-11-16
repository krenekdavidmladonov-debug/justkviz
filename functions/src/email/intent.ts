import { Timestamp, type DocumentReference, type Transaction } from 'firebase-admin/firestore';

import type { RegistrationEmailContent, RegistrationEmailType } from './templates.js';
import { futurePublicRegistrationEligible, registrationEmailActivation, registrationEmailRecipientEligible } from './runtime.js';

export type DeliveryStatus = 'pending' | 'processing' | 'sent' | 'failed';
interface EmailIntentState {
  readonly capabilityVersion?: number;
  readonly eventId: string;
  readonly registrationId: string;
  readonly recipient: string;
  readonly status: DeliveryStatus;
  readonly attempts: number;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
  readonly sentAt: Timestamp | null;
  readonly lastError: import('./errors.js').DeliveryErrorCode | null;
  readonly nextAttemptAt?: Timestamp | null;
  readonly leaseId: string | null;
  readonly leaseUntil: Timestamp | null;
}

export interface RegistrationOwnerNotificationContent {
  readonly eventTitle: string;
  readonly startsAtMillis: number;
  readonly timeZone: string;
  readonly teamName: string;
  readonly memberCount: number;
}
export interface RegistrationOwnerNotificationIntent extends EmailIntentState {
  readonly type: 'registration-organizer-notification';
  readonly content: RegistrationOwnerNotificationContent;
  readonly recipientPolicy: 'future-public-registration-owner';
  readonly provenance: 'public-registration-create';
  readonly ownerUid: string;
  readonly registrationCreatedAt: Timestamp;
}

export interface RegistrationEmailIntent extends EmailIntentState {
  readonly type: RegistrationEmailType;
  readonly content: RegistrationEmailContent;
  readonly recipientPolicy?: 'future-public-registration';
  readonly registrationCreatedAt?: Timestamp;
}
export interface EventTeamEmailIntent extends EmailIntentState {
  readonly type: 'event-team-message';
  readonly campaignId: string;
}
export type EmailIntent = RegistrationEmailIntent | EventTeamEmailIntent | RegistrationOwnerNotificationIntent;

// Called only after the domain transaction has authorized and validated its operation.
// No raw token, full URL, provider body or client-supplied destination enters the audit.
export function enqueueRegistrationEmail(transaction: Transaction, eventRef: DocumentReference, registrationRef: DocumentReference,
  intentId: string, type: RegistrationEmailType, event: Record<string, unknown>, registration: Record<string, unknown>, now: Timestamp) {
  if (!registrationEmailRecipientEligible(registration.contactEmail as string)) return false;
  const activation = registrationEmailActivation();
  const future = activation?.recipientPolicy === 'future-public-registration';
  if (future && !futurePublicRegistrationEligible(registration, now.toMillis(), activation)) return false;
  const venue = event.venue as { name: string; publicLocation: string };
  const intent: RegistrationEmailIntent = {
    ...(future ? { recipientPolicy: 'future-public-registration' as const, registrationCreatedAt: registration.createdAt as Timestamp } : {}),
    capabilityVersion: Number(event.capabilityVersion ?? 0),
    eventId: eventRef.id, registrationId: registrationRef.id, type,
    recipient: registration.contactEmail as string,
    content: { eventTitle: event.title as string, startsAtMillis: (event.startsAt as Timestamp).toMillis(), timeZone: event.timeZone as string,
      venueName: venue.name, publicLocation: venue.publicLocation, teamName: registration.teamName as string, memberCount: registration.memberCount as number },
    status: 'pending', nextAttemptAt: null, attempts: 0, lastError: null, createdAt: now, updatedAt: now, sentAt: null, leaseId: null, leaseUntil: null,
  };
  transaction.create(eventRef.collection('emailIntents').doc(intentId), intent);
  transaction.update(registrationRef, { emailDelivery: { intentId, type, status: 'pending', updatedAt: now } });
  return true;
}
