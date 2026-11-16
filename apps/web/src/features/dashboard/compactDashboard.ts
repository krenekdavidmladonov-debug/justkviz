import { eventOperational } from '@filmovy-kviz/quiz-domain';
import { isPastEvent } from '../events/eventPresentation';
import type { EventRecord } from '../events/types';

/** Only published upcoming and current events belong on the overview. */
export function compactDashboardEvents(events: readonly EventRecord[], now = Date.now()) {
  const live = (event: EventRecord) => Number(['live', 'finalizing'].includes(event.lifecycleStatus));
  return events.filter(event => event.registrationPublished === true && eventOperational(event)
    && Number.isFinite(event.startsAt.getTime()) && !isPastEvent(event, now))
    .sort((a, b) => live(b) - live(a) || a.startsAt.getTime() - b.startsAt.getTime());
}

export function compactEventCountdown(event: EventRecord, now = Date.now()): { main: string; detail?: string } {
  if (['live', 'finalizing'].includes(event.lifecycleStatus)) return { main: 'Právě probíhá' };
  const remaining = event.startsAt.getTime() - now;
  if (!Number.isFinite(remaining)) return { main: 'Bez termínu' };
  if (remaining <= 0) return { main: 'Termín nastal' };
  const minutes = Math.ceil(remaining / 60_000);
  const days = Math.floor(minutes / 1440), hours = Math.floor(minutes % 1440 / 60), rest = minutes % 60;
  if (days > 0) return { main: `${days} ${days === 1 ? 'den' : days < 5 ? 'dny' : 'dní'}`, detail: `${hours} h ${rest} min` };
  if (hours > 0) return { main: `${hours} h`, detail: `${rest} min` };
  return { main: `${minutes} min` };
}
