import { hasPermission, scopeAllows, type Membership } from '@filmovy-kviz/quiz-domain';
import { Timestamp, type DocumentReference, type Transaction } from 'firebase-admin/firestore';

import type { RegistrationOwnerNotificationIntent } from './intent.js';
import { registrationOwnerNotificationActivation, type RegistrationOwnerNotificationActivation } from './runtime.js';

export function ownerNotificationIntentId(registrationId: string): string {
  return 'owner_' + registrationId;
}

/** Roles alone confer no authority, including the owner label. */
export function registrationOwnerNotificationAuthorized(member: unknown, activation: RegistrationOwnerNotificationActivation,
  eventId: string, event: Record<string, unknown>): boolean {
  if (!member || typeof member !== 'object' || Array.isArray(member)) return false;
  const current = member as Membership;
  return current.uid === activation.ownerUid && current.status === 'active'
    && Array.isArray(current.permissions) && hasPermission(current, 'event.read') && hasPermission(current, 'event.contacts')
    && !!current.events && Array.isArray(current.events.ids) && scopeAllows(current.events, eventId, current.uid, event.createdBy);
}

/** Only called by the successful public create transaction, before its receipt is committed. */
export function enqueueRegistrationOwnerNotification(transaction: Transaction, eventRef: DocumentReference, registrationRef: DocumentReference,
  event: Record<string, unknown>, registration: Record<string, unknown>, now: Timestamp): boolean {
  const activation = registrationOwnerNotificationActivation();
  if (!activation || registration.source === 'manual' || registration.status !== 'accepted'
    || !(registration.createdAt instanceof Timestamp) || registration.createdAt.toMillis() !== now.toMillis()
    || now.toMillis() < activation.activatedAtMillis || typeof registration.managementTokenHash !== 'string'
    || !/^[a-f0-9]{64}$/u.test(registration.managementTokenHash)) return false;
  const intent: RegistrationOwnerNotificationIntent = {
    type: 'registration-organizer-notification', recipientPolicy: 'future-public-registration-owner', provenance: 'public-registration-create',
    ownerUid: activation.ownerUid, recipient: activation.recipient, eventId: eventRef.id, registrationId: registrationRef.id,
    registrationCreatedAt: registration.createdAt, capabilityVersion: Number(event.capabilityVersion ?? 0),
    content: { eventTitle: event.title as string, startsAtMillis: (event.startsAt as Timestamp).toMillis(), timeZone: event.timeZone as string,
      teamName: registration.teamName as string, memberCount: registration.memberCount as number },
    status: 'pending', nextAttemptAt: null, attempts: 0, lastError: null, createdAt: now, updatedAt: now, sentAt: null, leaseId: null, leaseUntil: null,
  };
  transaction.create(eventRef.collection('emailIntents').doc(ownerNotificationIntentId(registrationRef.id)), intent);
  // Organizer delivery is private to this intent and never overwrites participant emailDelivery.
  return true;
}
