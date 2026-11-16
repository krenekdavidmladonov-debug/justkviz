import { eventDisposition, eventOperational, hasPermission, type Membership } from '@filmovy-kviz/quiz-domain';
import { HttpsError } from 'firebase-functions/v2/https';
export function assertEventOperational(event: Record<string, unknown> | undefined): asserts event is Record<string, unknown> {
  if (!event) throw new HttpsError('not-found', 'Akce není dostupná.');
  if (!event || !eventOperational(event)) throw new HttpsError('failed-precondition', 'Akce je uzavřená, v archivu nebo v koši. Provozní změny nejsou povolené.');
}
/** A completed active event may only be hidden; this never reopens its operations. */
export function isCompletedEventHide(event: Record<string, unknown>, request: unknown): boolean {
  if (!request || typeof request !== 'object' || Array.isArray(request)) return false;
  const data = request as Record<string, unknown>;
  return eventDisposition(event) === 'active' && event.lifecycleStatus === 'completed'
    && data.published === false && data.registrationOpensAt === undefined && data.registrationClosesAt === undefined;
}
export function assertEventReadable(event: Record<string, unknown> | undefined, member: Membership, management = false): asserts event is Record<string, unknown> {
  if (!event) throw new HttpsError('not-found', 'Akce není dostupná.');
  const disposition = eventDisposition(event);
  if (['trash', 'deleting'].includes(disposition) && !(management && (hasPermission(member, 'event.manage') || hasPermission(member, 'event.delete')))) {
    throw new HttpsError('permission-denied', 'Akce je dostupná pouze ve správě koše.');
  }
}
export function assertCapability(event: Record<string, unknown>, capability: Record<string, unknown>): void {
  assertEventOperational(event);
  if ((event.capabilityVersion ?? 0) !== (capability.capabilityVersion ?? 0)) throw new HttpsError('permission-denied', 'Odkaz byl odvolán. Vyžádejte si nový přístup.');
}
