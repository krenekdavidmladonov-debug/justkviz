import type { EventFormValues } from '../../features/events/types';

export interface EventCreationAttempt {
  readonly actorUid: string;
  readonly requestId: string;
  readonly submittedValues: EventFormValues | null;
}
type AttemptStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const storageKey = (uid: string) => `justkviz.event-create-attempt:${encodeURIComponent(uid)}`;
function sessionStore(): AttemptStorage | undefined {
  try { return window.sessionStorage; } catch { return undefined; }
}
export function newEventCreationAttempt(actorUid: string): EventCreationAttempt {
  return { actorUid, requestId: crypto.randomUUID(), submittedValues: null };
}
function validValues(value: unknown): value is EventFormValues {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const allowed = ['title', 'startsAt', 'timeZone', 'venueName', 'publicLocation', 'description', 'utcOffset', 'pricingMode', 'pricingAmountCzk', 'pricingHidden', 'teamCapacity', 'peopleCapacity', 'teamSizeMin', 'teamSizeMax'];
  return Object.keys(v).every(key => allowed.includes(key))
    && typeof v.title === 'string' && v.title.length > 0 && v.title.length <= 300
    && typeof v.startsAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(v.startsAt)
    && v.timeZone === 'Europe/Prague'
    && typeof v.venueName === 'string' && v.venueName.length > 0 && v.venueName.length <= 300
    && typeof v.publicLocation === 'string' && v.publicLocation.length > 0 && v.publicLocation.length <= 500
    && (v.description === undefined || (typeof v.description === 'string' && v.description.length <= 2000))
    && (v.utcOffset === undefined || ['', '+01:00', '+02:00'].includes(v.utcOffset as string))
    && ['per-team', 'per-event', 'agreement'].includes(v.pricingMode as string)
    && Number.isInteger(v.pricingAmountCzk) && (v.pricingAmountCzk as number) >= 0 && (v.pricingAmountCzk as number) <= 1_000_000
    && (v.pricingHidden === undefined || typeof v.pricingHidden === 'boolean')
    && ['teamCapacity', 'peopleCapacity', 'teamSizeMin', 'teamSizeMax'].every(key => Number.isInteger(v[key]) && (v[key] as number) > 0)
    && (v.teamSizeMin as number) <= (v.teamSizeMax as number) && (v.teamSizeMax as number) <= 4;
}
function parse(raw: string, uid: string): EventCreationAttempt | null {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  return Object.keys(v).sort().join(',') === 'actorUid,requestId,submittedValues'
    && v.actorUid === uid && typeof v.requestId === 'string' && /^[\w-]{1,150}$/u.test(v.requestId)
    && (v.submittedValues === null || validValues(v.submittedValues)) ? v as unknown as EventCreationAttempt : null;
}
/** Null blocks a new submission until an unreadable prior attempt is explicitly reset. */
export function loadEventCreationAttempt(uid: string, storage = sessionStore()): EventCreationAttempt | null {
  try {
    if (!storage) return null;
    const raw = storage.getItem(storageKey(uid));
    return raw === null ? newEventCreationAttempt(uid) : parse(raw, uid);
  } catch { return null; }
}
/** Read back before dispatch: an unrecorded ambiguous write must never be sent. */
export function persistEventCreationAttempt(attempt: EventCreationAttempt, storage = sessionStore()): boolean {
  try {
    if (!storage) return false;
    const raw = JSON.stringify(attempt);
    if (!parse(raw, attempt.actorUid)) return false;
    storage.setItem(storageKey(attempt.actorUid), raw);
    return storage.getItem(storageKey(attempt.actorUid)) === raw;
  } catch { return false; }
}
export function clearEventCreationAttempt(attempt: EventCreationAttempt, storage = sessionStore()): void {
  try {
    const raw = storage?.getItem(storageKey(attempt.actorUid));
    const current = raw ? parse(raw, attempt.actorUid) : null;
    if (current?.requestId === attempt.requestId) storage?.removeItem(storageKey(attempt.actorUid));
  } catch { /* Keeping a successful attempt permits a harmless identical retry. */ }
}
