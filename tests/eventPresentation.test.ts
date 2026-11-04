import { describe, expect, it } from 'vitest';
import { eventCapacity, eventCountdown, eventDateLabel, isPastEvent, registrationPresentation } from '../apps/web/src/features/events/eventPresentation';
import { eventFormRecord } from './browser/events-form-ux.data';
const now = new Date('2030-03-30T22:30:00Z');
const event = () => ({ ...eventFormRecord(), registrationPublished: true, registrationOpensAt: new Date('2030-03-01T00:00:00Z'), registrationClosesAt: new Date('2030-04-01T00:00:00Z') });
describe('event calendar presentation', () => {
  it('counts calendar days in the event zone across the short DST night and midnight', () => {
    expect(eventCountdown({ startsAt: new Date('2030-03-31T21:00:00Z'), timeZone: 'Europe/Prague' }, now)).toBe('Zítra');
    expect(eventCountdown({ startsAt: new Date('2030-03-31T22:00:00Z'), timeZone: 'Europe/Prague' }, now)).toBe('Za 2 dny');
    expect(eventCountdown({ startsAt: new Date('2030-10-27T23:00:00Z'), timeZone: 'Europe/Prague' }, new Date('2030-10-26T22:30:00Z'))).toBe('Zítra');
  });
  it('prefers real live/finished lifecycle and handles missing dates without invention', () => {
    expect(eventCountdown({ ...event(), lifecycleStatus: 'live' }, now)).toBe('Právě probíhá');
    expect(isPastEvent({ ...event(), lifecycleStatus: 'live' }, now)).toBe(false);
    expect(eventCountdown({ ...event(), lifecycleStatus: 'completed' }, now)).toBe('Akce skončila');
    expect(eventCountdown({}, now)).toBe('Termín není stanoven');
    expect(eventDateLabel({ startsAt: new Date(NaN) })).toBe('Termín není stanoven');
  });
});
describe('registration presentation', () => {
  it('separates publication from readiness and derives current window status rather than a stale cached status', () => {
    expect(registrationPresentation({ ...event(), registrationStatus: 'scheduled' }, now).canRegister).toBe(true);
    expect(registrationPresentation({ ...event(), registrationPublished: false, lifecycleStatus: 'ready' }, now).canRegister).toBe(false);
    expect(registrationPresentation({ ...event(), registrationOpensAt: new Date('2030-04-01') }, now).status).toBe('scheduled');
    expect(registrationPresentation({ ...event(), registrationClosesAt: now }, now).status).toBe('closed');
    expect(registrationPresentation({ ...event(), registrationOpensAt: undefined }, now).status).toBe('closed');
    expect(registrationPresentation({ ...event(), lifecycleStatus: 'completed' }, now).canRegister).toBe(false);
  });
  it('uses only available team places even when the legacy person limit has been reached', () => {
    const record = { ...event(), teamCapacity: 10, acceptedTeams: 3, peopleCapacity: 20, acceptedPeople: 19 };
    expect(eventCapacity(record)).toEqual({ freeTeams: 7, freePeople: 1 });
    expect(registrationPresentation(record, now)).toMatchObject({ status: 'open', canRegister: true });
    expect(registrationPresentation({ ...record, acceptedPeople: 25 }, now).canRegister).toBe(true);
    expect(registrationPresentation({ ...record, acceptedTeams: 10 }, now)).toMatchObject({ status: 'full', label: 'Obsazeno', canRegister: false });
    expect(registrationPresentation({ ...record, acceptedPeople: 17 }, now).canRegister).toBe(true);
    expect(registrationPresentation({ ...record, teamSizeMin: 5 }, now).canRegister).toBe(false);
  });
});
