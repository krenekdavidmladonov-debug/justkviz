import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { EventPricing } from '../functions/src/events/types';
import { requestedEventConfiguration } from '../functions/src/events/validation';
import { requestedEventPricing, storedEventPricing } from '../functions/src/events/pricing';
import { buildPublicEventProjection } from '../functions/src/events/model';

// Actual mutation handlers with atomic synthetic transactions. Authorization has
// separate emulator coverage; this fixture isolates pricing persistence.
const state = vi.hoisted((): { records: Record<string, Record<string, unknown>>; sequence: number } => ({ records: {}, sequence: 0 }));
interface Ref { path: string; id: string; collection(name: string): { doc(id?: string): Ref } }
function document(path: string): Ref {
  return { path, id: path.split('/').at(-1)!, collection: name => ({ doc: (id = `synthetic_${++state.sequence}`) => document(`${path}/${name}/${id}`) }) };
}
interface Transaction {
  get(ref: Ref): Promise<{ exists: boolean; id: string; data(): Record<string, unknown> | undefined }>;
  create(ref: Ref, value: Record<string, unknown>): void;
  update(ref: Ref, value: Record<string, unknown>): void;
  set(ref: Ref, value: Record<string, unknown>): void;
  delete(ref: Ref): void;
}
const database = {
  doc: document,
  collection: (name: string) => ({ doc: (id = `synthetic_${++state.sequence}`) => document(`${name}/${id}`) }),
  runTransaction: async <T>(handler: (tx: Transaction) => Promise<T>): Promise<T> => {
    const pending: (() => void)[] = [];
    const result = await handler({
      get: ref => Promise.resolve({ exists: state.records[ref.path] !== undefined, id: ref.id, data: () => state.records[ref.path] }),
      create: (ref, value) => { if (state.records[ref.path]) throw new Error('Duplicate synthetic document'); pending.push(() => { state.records[ref.path] = value; }); },
      update: (ref, value) => { if (!state.records[ref.path]) throw new Error('Missing synthetic document'); pending.push(() => { state.records[ref.path] = { ...state.records[ref.path], ...value }; }); },
      set: (ref, value) => { pending.push(() => { state.records[ref.path] = value; }); },
      delete: ref => { pending.push(() => { delete state.records[ref.path]; }); },
    });
    pending.forEach(write => write());
    return result;
  },
};
vi.mock('../functions/node_modules/firebase-admin/lib/esm/firestore/index.js', async () => ({
  getFirestore: () => database, Timestamp: (await import('firebase/firestore')).Timestamp, FieldValue: { delete: () => null },
}));
vi.mock('../functions/src/access/authorization', () => ({
  accessActor: () => ({ uid: 'synthetic-owner' }), grantCreatedResource: () => undefined,
  securedOnCall: (_name: string, _options: unknown, handler: (request: EventRequest) => unknown) => ({ run: handler }),
  runAccessTransaction: (_db: unknown, handler: (tx: Transaction) => Promise<unknown>) => database.runTransaction(handler),
}));
vi.mock('../functions/src/live/event-lifecycle', () => ({ eventSessions: () => Promise.resolve([]), closeSessions: () => undefined }));
vi.mock('../functions/src/email/intent', () => ({ enqueueRegistrationEmail: () => false }));
vi.mock('../functions/src/email/organizer', () => ({ enqueueRegistrationOwnerNotification: () => false }));
vi.mock('../functions/src/email/runtime', () => ({
  emailEmulatorRuntime: () => false, registrationEmailActivation: () => false,
  registrationEmailRecipientEligible: () => false, registrationEmailSecrets: () => [],
}));
const { Timestamp } = await import('firebase/firestore');
const { createEvent, updateEvent } = await import('../functions/src/events/callables');
type EventRequest = Parameters<typeof createEvent.run>[0];
const { cancelEvent, archiveEvent } = await import('../functions/src/events/management');
const { configureEventRegistration, createEventRegistration, updateEventRegistration, cancelEventRegistration,
  adminAddEventTeam, adminUpdateEventTeam, adminCancelEventRegistration } = await import('../functions/src/registrations/callables');
const configuration = {
  title: 'Synthetic pricing event', startsAt: '2035-01-01T18:00:00Z', timeZone: 'Europe/Prague',
  venue: { name: 'Synthetic venue', publicLocation: 'Synthetic hall' },
  teamCapacity: 20, peopleCapacity: 80, teamSizeMin: 1, teamSizeMax: 4,
};
const custom: EventPricing = { mode: 'per-event', amountCzk: 12_500 };
const eventRef = 'events/event';
const publicRef = 'publicEvents/event';
function request(data: unknown): EventRequest { return { data } as EventRequest; }
function seed() {
  state.records = { [eventRef]: {
    ...configuration, startsAt: Timestamp.fromDate(new Date(configuration.startsAt)), pricing: custom,
    revision: 7, lifecycleStatus: 'scheduled', registrationStatus: 'open', registrationPublished: true,
    acceptedTeams: 0, acceptedPeople: 0, registrationOpensAt: Timestamp.fromMillis(1),
    registrationClosesAt: Timestamp.fromDate(new Date('2035-01-01T17:00:00Z')),
    scoring: { unitScale: 2, rankingMode: 'dense', started: false },
  }, [publicRef]: { pricing: { mode: 'per-team', amountCzk: 1 }, privateStaleSentinel: true } };
}
function expectPricing(pricing: EventPricing) {
  expect(state.records[eventRef]?.pricing).toEqual(pricing);
  expect(state.records[publicRef]?.pricing).toEqual(pricing.hidden ? { mode: 'agreement', amountCzk: null, hidden: true } : pricing);
}
beforeEach(() => { state.sequence = 0; seed(); });

describe('trusted event pricing validation', () => {
  test.each([
    { mode: 'per-team', amountCzk: 0 }, { mode: 'per-team', amountCzk: 350 },
    { mode: 'per-event', amountCzk: 1_000_000 }, { mode: 'agreement', amountCzk: null },
    { mode: 'per-team', amountCzk: 350, hidden: true }, { mode: 'per-event', amountCzk: 0, hidden: false },
  ])('accepts the bounded explicit contract %j', pricing => {
    expect(requestedEventConfiguration({ event: { ...configuration, pricing } }).pricing).toEqual(pricing);
  });
  test.each([
    null, undefined, [], {}, '350', { mode: 'per-person', amountCzk: 350 },
    { mode: 'per-team', amountCzk: -1 }, { mode: 'per-team', amountCzk: 1.5 },
    { mode: 'per-team', amountCzk: 1_000_001 }, { mode: 'per-event', amountCzk: '350' },
    { mode: 'per-event', amountCzk: null }, { mode: 'agreement', amountCzk: 0 },
    { mode: 'per-team', amountCzk: Number.NaN }, { mode: 'per-team', amountCzk: Infinity },
    { mode: 'per-team' }, { mode: 'agreement' }, { mode: 'per-team', amountCzk: 350, contactEmail: 'private@example.test' },
    { mode: 'per-team', amountCzk: 350, hidden: 'true' }, { mode: 'per-team', amountCzk: 350, hidden: null },
    { mode: 'per-team', amountCzk: 350, hidden: undefined },
  ])('rejects malformed pricing without coercion %j', pricing => {
    expect(() => requestedEventConfiguration({ event: { ...configuration, pricing } })).toThrow('pricing');
  });
  test('distinguishes absent legacy input and validates malformed stored values', () => {
    expect(requestedEventConfiguration({ event: configuration })).not.toHaveProperty('pricing');
    expect(storedEventPricing(undefined)).toEqual({ mode: 'per-team', amountCzk: 350 });
    expect(() => storedEventPricing({ mode: 'agreement', amountCzk: 350 })).toThrow('pricing');
    expect(requestedEventPricing({ mode: 'per-team', amountCzk: 350, hidden: true })).toEqual({ mode: 'per-team', amountCzk: 350, hidden: true });
    expect(storedEventPricing({ mode: 'per-team', amountCzk: 350, hidden: false })).toEqual({ mode: 'per-team', amountCzk: 350 });
  });
  test('projection removes nested private fields and never mutates its input', () => {
    const input = { ...configuration, pricing: { ...custom, contactEmail: 'PRIVATE', secret: { answer: 'PRIVATE' } },
      registrationStatus: 'open' as const, registrationPublished: true, acceptedTeams: 0, acceptedPeople: 0,
      registrationOpensAt: null, registrationClosesAt: null, revision: 7, updatedAt: null };
    expect(buildPublicEventProjection(input).pricing).toEqual(custom);
    expect(JSON.stringify(buildPublicEventProjection(input))).not.toContain('PRIVATE');
    expect(input.pricing).toHaveProperty('secret');
    const hidden = buildPublicEventProjection({ ...input, pricing: { ...input.pricing, hidden: true } });
    expect(hidden.pricing).toEqual({ mode: 'agreement', amountCzk: null, hidden: true });
    expect(hidden.pricing).not.toMatchObject(custom);
  });
});

describe('event pricing persistence across actual handlers', () => {
  test('creates an explicit default and supports copying custom or agreed prices', async () => {
    const prices: (EventPricing | undefined)[] = [undefined, custom, { mode: 'agreement', amountCzk: null }, { ...custom, hidden: true }];
    for (const pricing of prices) {
      const result = await createEvent.run(request({ event: { ...configuration, ...(pricing === undefined ? {} : { pricing }) }, expectedRevision: 0 }));
      const expected = pricing ?? { mode: 'per-team', amountCzk: 350 };
      expect(state.records[`events/${result.eventId}`]?.pricing).toEqual(expected);
      expect(state.records[`publicEvents/${result.eventId}`]?.pricing).toEqual(pricing?.hidden ? { mode: 'agreement', amountCzk: null, hidden: true } : expected);
    }
  });
  test('an old update client preserves authoritative pricing and stale revisions abort', async () => {
    await updateEvent.run(request({ eventId: 'event', expectedRevision: 7, event: { ...configuration, title: 'Renamed' } }));
    expectPricing(custom);
    await expect(updateEvent.run(request({ eventId: 'event', expectedRevision: 7, event: { ...configuration, pricing: { mode: 'per-team', amountCzk: 1 } } }))).rejects.toMatchObject({ code: 'aborted' });
    expectPricing(custom);
  });
  test('an explicit price change updates event and projection atomically', async () => {
    const pricing = { mode: 'agreement' as const, amountCzk: null };
    await updateEvent.run(request({ eventId: 'event', expectedRevision: 7, event: { ...configuration, pricing } }));
    expectPricing(pricing);
    expect(state.records[publicRef]).not.toHaveProperty('privateStaleSentinel');
  });
  test('old clients preserve hidden pricing and an explicit false unhides it without losing the amount', async () => {
    const hidden = { ...custom, hidden: true };
    state.records[eventRef]!.pricing = hidden;
    await updateEvent.run(request({ eventId: 'event', expectedRevision: 7, event: configuration }));
    expectPricing(hidden);
    await updateEvent.run(request({ eventId: 'event', expectedRevision: 8, event: { ...configuration, pricing: custom } }));
    expectPricing(hidden);
    await updateEvent.run(request({ eventId: 'event', expectedRevision: 9, event: { ...configuration, pricing: { ...custom, hidden: false } } }));
    expectPricing(custom);
  });
  test('malformed price changes leave the current event untouched', async () => {
    const previousEvent = state.records[eventRef], previousPublic = state.records[publicRef];
    await expect(updateEvent.run(request({ eventId: 'event', expectedRevision: 7,
      event: { ...configuration, pricing: { mode: 'per-team', amountCzk: -1 } } }))).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(state.records[eventRef]).toBe(previousEvent);
    expect(state.records[publicRef]).toBe(previousPublic);
  });
  test('legacy events gain the default on configuration update', async () => {
    delete state.records[eventRef]!.pricing;
    await updateEvent.run(request({ eventId: 'event', expectedRevision: 7, event: configuration }));
    expectPricing({ mode: 'per-team', amountCzk: 350 });
  });
  test.each([false, true])('publication and public create/edit/cancel preserve custom event pricing (hidden: %s)', async hidden => {
    const pricing = { ...custom, ...(hidden ? { hidden: true } : {}) };
    state.records[eventRef]!.pricing = pricing;
    await configureEventRegistration.run(request({ eventId: 'event', expectedRevision: 7, published: true }));
    expectPricing(pricing);
    const team = { eventId: 'event', teamName: 'Synthetic team', memberCount: 2, contactEmail: 'synthetic@example.test', pricing: { mode: 'per-team', amountCzk: 1 } };
    const result = await createEventRegistration.run(request(team));
    expectPricing(pricing);
    const capability = { eventId: 'event', registrationId: result.registrationId, token: result.managementToken };
    await updateEventRegistration.run(request({ ...team, ...capability, memberCount: 3 }));
    expectPricing(pricing);
    await cancelEventRegistration.run(request(capability));
    expectPricing(pricing);
  });
  test.each([false, true])('manual add/edit/admin cancel preserve custom event pricing (hidden: %s)', async hidden => {
    const pricing = { ...custom, ...(hidden ? { hidden: true } : {}) };
    state.records[eventRef]!.pricing = pricing;
    const team = { eventId: 'event', requestId: 'synthetic_request', teamName: 'Synthetic team', memberCount: 2 };
    const result = await adminAddEventTeam.run(request(team));
    expectPricing(pricing);
    await adminUpdateEventTeam.run(request({ ...team, registrationId: result.registrationId, expectedRevision: 1, memberCount: 3 }));
    expectPricing(pricing);
    await adminCancelEventRegistration.run(request({ eventId: 'event', registrationId: result.registrationId }));
    expectPricing(pricing);
  });
  test.each([false, true])('cancellation and archive use authoritative event pricing (hidden: %s)', async hidden => {
    const pricing = { ...custom, ...(hidden ? { hidden: true } : {}) };
    state.records[eventRef]!.pricing = pricing;
    await cancelEvent.run(request({ eventId: 'event', expectedRevision: 7 }));
    expectPricing(pricing);
    await archiveEvent.run(request({ eventId: 'event', expectedRevision: 8 }));
    expectPricing(pricing);
  });
});
