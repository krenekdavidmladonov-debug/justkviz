import type { EventLifecycleStatus, RegistrationStatus } from './types';

interface EventTiming {
  readonly startsAt?: Date;
  readonly timeZone?: string;
  readonly lifecycleStatus?: EventLifecycleStatus;
  readonly cancelled?: boolean;
}
interface RegistrationEvent extends EventTiming {
  readonly registrationPublished: boolean;
  readonly registrationStatus: RegistrationStatus;
  readonly registrationOpensAt?: Date;
  readonly registrationClosesAt?: Date;
  readonly teamCapacity: number;
  readonly peopleCapacity: number;
  readonly acceptedTeams: number;
  readonly acceptedPeople: number;
  readonly teamSizeMin: number;
}
const millis = (value: Date | number) => value instanceof Date ? value.getTime() : value;
const validDate = (value?: Date): value is Date => value instanceof Date && Number.isFinite(value.getTime());
function calendarDay(date: Date, timeZone = 'Europe/Prague'): number {
  let parts: Intl.DateTimeFormatPart[];
  try { parts = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(date); }
  catch { parts = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Prague', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(date); }
  const part = (type: string) => Number(parts.find(item => item.type === type)?.value);
  return Date.UTC(part('year'), part('month') - 1, part('day')) / 86400000;
}
export function isPastEvent(event: EventTiming, now: Date | number = Date.now()): boolean {
  if (event.lifecycleStatus === 'live' || event.lifecycleStatus === 'finalizing') return false;
  if (['completed', 'cancelled', 'archived'].includes(event.lifecycleStatus ?? '') || event.cancelled) return true;
  return validDate(event.startsAt) && calendarDay(event.startsAt, event.timeZone) < calendarDay(new Date(millis(now)), event.timeZone);
}
export function eventCountdown(event: EventTiming, now: Date | number = Date.now()): string {
  if (event.cancelled || event.lifecycleStatus === 'cancelled') return 'Akce zrušena';
  if (event.lifecycleStatus === 'live' || event.lifecycleStatus === 'finalizing') return 'Právě probíhá';
  if (['completed', 'archived'].includes(event.lifecycleStatus ?? '')) return 'Akce skončila';
  if (!validDate(event.startsAt)) return 'Termín není stanoven';
  const days = calendarDay(event.startsAt, event.timeZone) - calendarDay(new Date(millis(now)), event.timeZone);
  return days < 0 ? 'Akce skončila' : days === 0 ? 'Dnes' : days === 1 ? 'Zítra' : `Za ${days} ${days < 5 ? 'dny' : 'dní'}`;
}
export function eventDateLabel(event: EventTiming): string {
  if (!validDate(event.startsAt)) return 'Termín není stanoven';
  try { return new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'medium', timeStyle: 'short', timeZone: event.timeZone ?? 'Europe/Prague' }).format(event.startsAt); }
  catch { return new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Prague' }).format(event.startsAt); }
}
export function eventCapacity(event: Pick<RegistrationEvent, 'teamCapacity' | 'peopleCapacity' | 'acceptedTeams' | 'acceptedPeople'>) {
  return {
    freeTeams: event.teamCapacity > 0 ? Math.max(0, event.teamCapacity - event.acceptedTeams) : null,
    freePeople: event.peopleCapacity > 0 ? Math.max(0, event.peopleCapacity - event.acceptedPeople) : null,
  };
}
export function registrationPresentation(event: RegistrationEvent, now: Date | number = Date.now()): { status: RegistrationStatus; label: string; canRegister: boolean } {
  let status: RegistrationStatus = 'closed';
  const opens = event.registrationOpensAt?.getTime(), closes = event.registrationClosesAt?.getTime();
  const current = millis(now), capacity = eventCapacity(event);
  // The server derives status from visibility, window and counters; a stored
  // status may be stale after time passes and is not an independent pause switch.
  if (event.registrationPublished && !event.cancelled && event.teamSizeMin <= 4 && !['cancelled', 'completed', 'archived'].includes(event.lifecycleStatus ?? '')
    && opens !== undefined && closes !== undefined && Number.isFinite(opens) && Number.isFinite(closes)) {
    if (current < opens) status = 'scheduled';
    else if (current < closes) status = capacity.freeTeams === 0 ? 'full' : 'open';
  }
  const labels: Record<RegistrationStatus, string> = { scheduled: 'Registrace se otevřou později', open: 'Registrace otevřené', paused: 'Registrace pozastavené', full: 'Obsazeno', closed: 'Registrace uzavřené' };
  return { status, label: labels[status], canRegister: status === 'open' };
}
