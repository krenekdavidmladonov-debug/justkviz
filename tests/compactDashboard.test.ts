import { describe, expect, it } from 'vitest';
import { compactDashboardEvents, compactEventCountdown } from '../apps/web/src/features/dashboard/compactDashboard';
import { eventFormRecord } from './browser/events-form-ux.data';
const now = Date.parse('2030-10-15T12:00:00Z');
const event = (id: string, startsAt: string) => ({ ...eventFormRecord(), id, startsAt: new Date(startsAt), lifecycleStatus: 'ready' as const, registrationPublished: true });
describe('published compact event list', () => {
  it('selects real live events first and includes today after start while excluding previous local calendar days', () => {
    const later = event('later', '2030-10-20T18:00:00Z'), today = event('today', '2030-10-15T09:00:00Z');
    const live = { ...later, id: 'live', lifecycleStatus: 'live' as const };
    expect(compactDashboardEvents([later, event('yesterday', '2030-10-14T21:30:00Z'), today, live], now).map(item => item.id)).toEqual(['live', 'today', 'later']);
  });
  it('uses the event calendar zone across midnight and filters operational disposition, completed and invalid dates', () => {
    const late = Date.parse('2030-10-15T22:30:00Z'); // Prague is already October 16.
    const sameDay = event('same-day', '2030-10-15T22:05:00Z');
    const base = event('next', '2030-10-17T18:00:00Z');
    expect(compactDashboardEvents([event('previous-day', '2030-10-15T21:59:00Z'), sameDay, { ...base, id: 'trash', disposition: 'trash' }, { ...base, id: 'done', lifecycleStatus: 'completed' }, { ...base, id: 'missing', startsAt: new Date(NaN) }], late).map(item => item.id)).toEqual(['same-day']);
  });
  it('includes only explicitly published events and does not modify the input ordering', () => {
    const later = event('later', '2030-10-20T18:00:00Z'), earlier = { ...event('hidden', '2030-10-18T18:00:00Z'), registrationPublished: false };
    const source = [later, earlier, { ...earlier, id: 'hidden-live', lifecycleStatus: 'live' as const }]; expect(compactDashboardEvents(source, now).map(item => item.id)).toEqual(['later']); expect(source.map(item => item.id)).toEqual(['later', 'hidden', 'hidden-live']);
  });
});
describe('actual time countdown', () => {
  it('shows days and remaining hours/minutes from the real instant, rounding a partial minute upward', () => {
    expect(compactEventCountdown(event('five', '2030-10-20T18:07:00Z'), now)).toEqual({ main: '5 dní', detail: '6 h 7 min' });
    expect(compactEventCountdown(event('hours', '2030-10-15T13:05:01Z'), now)).toEqual({ main: '1 h', detail: '6 min' });
    expect(compactEventCountdown(event('minute', '2030-10-15T12:00:01Z'), now)).toEqual({ main: '1 min' });
  });
  it('does not invent a live state when time has passed and does not invent a missing date', () => {
    expect(compactEventCountdown(event('today', '2030-10-15T09:00:00Z'), now)).toEqual({ main: 'Termín nastal' });
    expect(compactEventCountdown({ ...eventFormRecord(), startsAt: new Date(NaN) }, now)).toEqual({ main: 'Bez termínu' });
    expect(compactEventCountdown({ ...event('future', '2030-10-20T18:00:00Z'), lifecycleStatus: 'live' }, now)).toEqual({ main: 'Právě probíhá' });
  });
});
