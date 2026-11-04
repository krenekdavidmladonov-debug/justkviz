import { Timestamp } from 'firebase/firestore';
import { describe, expect, test } from 'vitest';
import { mapEvent } from '../apps/web/src/features/events/eventMappers';
import type { EventFormValues, EventRecord } from '../apps/web/src/features/events/types';
import { validateEventConfiguration } from '../functions/src/events/model';
import { createEventFormData, eventFormRecord } from './browser/events-form-ux.data';

const values: EventFormValues = {
  title: 'Nová akce', startsAt: '2030-10-20T19:00', timeZone: 'Europe/Prague',
  venueName: 'Testovací sál', publicLocation: 'Testovací lokalita',
  teamCapacity: 20, peopleCapacity: 80, teamSizeMin: 2, teamSizeMax: 4,
  pricingMode: 'per-team', pricingAmountCzk: 350,
};

// Exercise the real repository mapper with Firestore date values, without initializing Firebase.
function storedData(record: EventRecord): Record<string, unknown> {
  return {
    ...record, startsAt: Timestamp.fromDate(record.startsAt),
    ...(record.registrationOpensAt ? { registrationOpensAt: Timestamp.fromDate(record.registrationOpensAt) } : {}),
    ...(record.registrationClosesAt ? { registrationClosesAt: Timestamp.fromDate(record.registrationClosesAt) } : {}),
    ...(record.quizAssignment ? { quizAssignment: { ...record.quizAssignment, lockedAt: Timestamp.fromDate(record.quizAssignment.lockedAt) } } : {}),
  };
}

describe('isolated event form data contract', () => {
  test('maps legacy pricing to the default and preserves explicit private-event pricing', () => {
    const record = eventFormRecord();
    expect(mapEvent(record.id, { ...storedData(record), pricing: undefined }).pricing).toEqual({ mode: 'per-team', amountCzk: 350 });
    for (const pricing of [{ mode: 'per-event', amountCzk: 15000 }, { mode: 'agreement', amountCzk: null }, { mode: 'per-event', amountCzk: 15000, hidden: true }]) {
      expect(mapEvent(record.id, { ...storedData(record), pricing }).pricing).toEqual(pricing);
    }
  });
  test('hidden pricing survives save/reload and showing it again retains the private amount', () => {
    const data = createEventFormData();
    data.updateEvent('synthetic-event', 2, { ...values, pricingMode: 'per-event', pricingAmountCzk: 12500, pricingHidden: true });
    const reloaded = data.getEvent('synthetic-event')!;
    expect(mapEvent(reloaded.id, storedData(reloaded)).pricing).toEqual({ mode: 'per-event', amountCzk: 12500, hidden: true });
    data.updateEvent(reloaded.id, reloaded.revision, { ...values, pricingMode: 'per-event', pricingAmountCzk: reloaded.pricing!.amountCzk!, pricingHidden: false });
    expect(data.getEvent(reloaded.id)?.pricing).toEqual({ mode: 'per-event', amountCzk: 12500 });
  });
  test.each([null, { mode: 'agreement', amountCzk: 350 }, { mode: 'per-team', amountCzk: -1 }, { mode: 'per-team', amountCzk: 1.5 }, { mode: 'per-event', amountCzk: 1000001 }, { mode: 'unknown', amountCzk: 350 }])('rejects malformed explicit pricing %j', pricing => {
    expect(() => mapEvent('event', { ...storedData(eventFormRecord()), pricing })).toThrow('Neplatná cena akce.');
  });
  test('the initial detail record passes the real configuration validator and mapper', () => {
    const record = eventFormRecord();
    expect(validateEventConfiguration(record)).toEqual([]);
    expect(mapEvent(record.id, storedData(record))).toEqual(record);
    expect(record).toMatchObject({
      scoring: { unitScale: 2, rankingMode: 'dense', started: false },
      acceptedTeams: 0, acceptedPeople: 0, registrationPublished: false,
      lifecycleStatus: 'draft', registrationStatus: 'scheduled', revision: 2,
    });
    expect(record).not.toHaveProperty('quizAssignment');
  });

  test.each([undefined, { started: false }, { unitScale: 2, rankingMode: 'dense', started: 'false' }])(
    'the real mapper rejects missing or malformed scoring: %j', scoring => {
      const record = eventFormRecord();
      expect(() => mapEvent(record.id, { ...storedData(record), scoring })).toThrow('Konfigurace akce je neplatná.');
    },
  );

  test('create returns the mutation envelope at revision 1 and reloads a complete editable record', () => {
    const data = createEventFormData(null);
    const created = data.createEvent(values);
    expect(created).toEqual({ eventId: 'synthetic-event', revision: 1, lifecycleStatus: 'scheduled', registrationStatus: 'scheduled' });
    const expected: EventRecord = { ...eventFormRecord(), title: values.title, lifecycleStatus: 'scheduled', revision: 1 };
    expect(data.getEvent(created.eventId)).toEqual(expected);
    expect(mapEvent(created.eventId, storedData(expected))).toEqual(expected);
    expect(data.getEvent(created.eventId)?.startsAt.toISOString()).toBe('2030-10-20T17:00:00.000Z');
    expect(data.getEvent(created.eventId)).not.toHaveProperty('venueName');
    const updated = data.updateEvent(created.eventId, created.revision, { ...values, title: 'Upravená akce' });
    expect(updated).toEqual({ ...created, revision: 2 });
    expect(data.getEvent(created.eventId)).toEqual({ ...expected, title: 'Upravená akce', revision: 2 });
    expect(() => data.updateEvent(created.eventId, created.revision, values)).toThrow('Event changed');
    expect(data.getEvent(created.eventId)?.revision).toBe(2);
  });

  test('editing preserves non-form fields, maps Prague time and updates capacity status and revision', () => {
    const initial: EventRecord = {
      ...eventFormRecord(), acceptedTeams: 2, acceptedPeople: 8, registrationPublished: true, registrationStatus: 'open',
      registrationOpensAt: new Date('2030-09-01T10:00:00Z'), registrationClosesAt: new Date('2030-10-20T16:00:00Z'),
      quizAssignment: { quizId: 'quiz-1', quizRevision: 4, snapshotId: 'snapshot-1', quizTitle: 'Syntetický kvíz', roundCount: 1, questionCount: 1, lockedAt: new Date('2030-09-02T10:00:00Z') },
    };
    const data = createEventFormData(initial);
    const edits = { ...values, title: ' Zimní akce ', startsAt: '2030-12-20T19:00', utcOffset: '+01:00', description: ' Popis ', teamCapacity: 2 };
    const originalEdits = structuredClone(edits);
    expect(data.updateEvent(initial.id, initial.revision, edits)).toEqual({ eventId: initial.id, revision: 3, lifecycleStatus: 'draft', registrationStatus: 'full' });
    const expected: EventRecord = { ...initial, title: 'Zimní akce', description: 'Popis', startsAt: new Date('2030-12-20T18:00:00Z'), teamCapacity: 2, registrationStatus: 'full', revision: 3 };
    expect(data.getEvent(initial.id)).toEqual(expected);
    expect(mapEvent(initial.id, storedData(expected))).toEqual(expected);
    expect(edits).toEqual(originalEdits);
    expect(data.getEvent(initial.id)).not.toHaveProperty('utcOffset');
    expect(() => data.updateEvent(initial.id, 3, { ...values, teamCapacity: 1 })).toThrow('Capacity cannot');
    expect(data.getEvent(initial.id)).toEqual(expected);
  });

  test('synthetic create and update failures leave the stored state unchanged', () => {
    const empty = createEventFormData(null, true);
    expect(() => empty.createEvent(values)).toThrow('Změny se nepodařilo uložit');
    expect(empty.getEvent('synthetic-event')).toBeNull();
    const initial = eventFormRecord();
    const seeded = createEventFormData(initial, true);
    expect(() => seeded.updateEvent(initial.id, initial.revision, values)).toThrow('Změny se nepodařilo uložit');
    expect(seeded.getEvent(initial.id)).toEqual(initial);
  });

  test('factories, scenarios and repository reads do not share mutable nested data', () => {
    const initial = eventFormRecord(), other = eventFormRecord();
    expect(initial.venue).not.toBe(other.venue);
    expect(initial.scoring).not.toBe(other.scoring);
    const first = createEventFormData(initial), second = createEventFormData(initial);
    initial.startsAt.setFullYear(1999);
    const read = first.getEvent(initial.id)!;
    expect(read).toEqual(other);
    expect(read.venue).not.toBe(second.getEvent(initial.id)?.venue);
    expect(read.scoring).not.toBe(second.getEvent(initial.id)?.scoring);
    read.startsAt.setFullYear(1998);
    first.updateEvent(initial.id, 2, values);
    expect(first.getEvent(initial.id)?.startsAt.toISOString()).toBe('2030-10-20T17:00:00.000Z');
    expect(second.getEvent(initial.id)).toEqual(other);
  });

  test('unknown IDs cannot read or mutate the event and referee lists are scoped, empty read responses', () => {
    const data = createEventFormData();
    expect(data.getEvent('unknown')).toBeNull();
    expect(() => data.updateEvent('unknown', 2, values)).toThrow('Event was not found');
    expect(() => data.listRefereeAccess('unknown')).toThrow('Event was not found');
    const before = data.getEvent('synthetic-event');
    const accesses = data.listRefereeAccess('synthetic-event');
    expect(accesses).toEqual([]);
    expect(accesses).not.toBe(data.listRefereeAccess('synthetic-event'));
    expect(data.getEvent('synthetic-event')).toEqual(before);
  });
});
