import { expect, test } from 'vitest';
import { clearEventCreationAttempt, loadEventCreationAttempt, newEventCreationAttempt, persistEventCreationAttempt } from '../apps/web/src/routes/admin/eventCreationRecovery';
import type { EventFormValues } from '../apps/web/src/features/events/types';

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
const values: EventFormValues = { title: 'Synthetic complete event', description: 'Retain all original fields',
  startsAt: '2030-10-27T02:30', utcOffset: '+01:00', timeZone: 'Europe/Prague', venueName: 'Synthetic venue', publicLocation: 'Synthetic location',
  pricingMode: 'per-event', pricingAmountCzk: 1700, pricingHidden: true, teamCapacity: 17, peopleCapacity: 68, teamSizeMin: 1, teamSizeMax: 4 };

test('a reload restores every submitted field and the same actor-bound request after an unknown outcome', () => {
  const store = storage(), first = { ...newEventCreationAttempt('A'), submittedValues: { ...values } };
  expect(persistEventCreationAttempt(first, store)).toBe(true);
  expect(loadEventCreationAttempt('A', store)).toEqual(first);
  first.submittedValues.title = 'Changed later draft';
  expect(loadEventCreationAttempt('A', store)?.submittedValues).toEqual(values);
});

test('A to B to A keeps both attempts separate and stale successful cleanup cannot clear a newer attempt', () => {
  const store = storage(), first = { ...newEventCreationAttempt('A'), submittedValues: values }, other = newEventCreationAttempt('B');
  persistEventCreationAttempt(first, store); persistEventCreationAttempt(other, store);
  expect(loadEventCreationAttempt('B', store)).toEqual(other);
  expect(loadEventCreationAttempt('A', store)).toEqual(first);
  const fresh = newEventCreationAttempt('A'); persistEventCreationAttempt(fresh, store);
  clearEventCreationAttempt(first, store);
  expect(loadEventCreationAttempt('A', store)).toEqual(fresh);
  expect(loadEventCreationAttempt('B', store)).toEqual(other);
  clearEventCreationAttempt(fresh, store);
  expect(loadEventCreationAttempt('A', store)?.requestId).not.toBe(fresh.requestId);
});

test('malformed or unavailable recovery is blocked and cannot silently become a new attempt', () => {
  const denied = { getItem: () => { throw Error('denied'); }, setItem: () => { throw Error('denied'); }, removeItem: () => { throw Error('denied'); } };
  expect(loadEventCreationAttempt('A', denied)).toBeNull();
  expect(persistEventCreationAttempt(newEventCreationAttempt('A'), denied)).toBe(false);
  expect(() => clearEventCreationAttempt(newEventCreationAttempt('A'), denied)).not.toThrow();
  const store = storage(), first = { ...newEventCreationAttempt('A'), submittedValues: values };
  persistEventCreationAttempt(first, store);
  const broken = { ...store, getItem: () => '{broken' };
  expect(loadEventCreationAttempt('A', broken)).toBeNull();
  const foreign = { ...store, getItem: () => JSON.stringify({ ...first, actorUid: 'B' }) };
  expect(loadEventCreationAttempt('A', foreign)).toBeNull();
  const invalidValues = { ...store, getItem: () => JSON.stringify({ ...first, submittedValues: { ...values, teamSizeMax: '4' } }) };
  expect(loadEventCreationAttempt('A', invalidValues)).toBeNull();
});
