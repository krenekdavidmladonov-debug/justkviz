import { assertPlayableQuizSource } from '../functions/src/quizzes/playable';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { EditorQuiz, EditorSlide } from '../packages/quiz-domain/src/index';
import {
  buildPublicEventProjection,
  canArchiveEvent,
  canCancelEvent,
  canMutateEvent,
  defaultScoringConfiguration,
  validateEventCapacity,
  validateEventConfiguration,
} from '../functions/src/events/model';
import {
  buildQuizSnapshotMetadata,
  snapshotWriteCount,
} from '../functions/src/events/snapshot-model';
import { requestedEventConfiguration } from '../functions/src/events/validation';
import { eventCreationIdentity } from '../functions/src/events/creation';

const creation = vi.hoisted(() => ({ records: new Map<string, Record<string, unknown>>(), nextId: 0,
  actorUid: 'synthetic-creator', writes: [] as string[], grants: vi.fn(), authorize: vi.fn() }));
interface CreationRef { readonly id: string; readonly path: string }
const creationRef = (path: string): CreationRef => ({ path, id: path.split('/').at(-1)! });
const creationSnapshot = (ref: CreationRef) => ({ exists: creation.records.has(ref.path), data: () => structuredClone(creation.records.get(ref.path)) });
const creationDatabase = {
  doc: creationRef,
  collection: (name: string) => ({ doc: (id = 'synthetic-' + (++creation.nextId)) => creationRef(name + '/' + id) }),
};
vi.mock('../functions/node_modules/firebase-admin/lib/esm/app/index.js', () => ({ getApps: () => [{}], initializeApp: vi.fn() }));
vi.mock('../functions/node_modules/firebase-admin/lib/esm/firestore/index.js', async () => ({
  getFirestore: () => creationDatabase, Timestamp: (await import('firebase/firestore')).Timestamp,
}));
vi.mock('../functions/src/access/authorization', () => ({
  accessActor: () => ({ uid: creation.actorUid, role: 'admin' }),
  securedOnCall: (_name: string, _options: unknown, handler: (request: unknown) => unknown) => ({ run: handler }),
  grantCreatedResource: creation.grants,
  authorize: creation.authorize, currentMembership: vi.fn(),
  runAccessTransaction: async (_db: unknown, handler: (transaction: {
    get: (ref: CreationRef) => Promise<ReturnType<typeof creationSnapshot>>;
    create: (ref: CreationRef, data: Record<string, unknown>) => void;
  }) => Promise<unknown>) => {
    const writes: [CreationRef, Record<string, unknown>][] = [];
    const result = await handler({
      get: ref => Promise.resolve(creationSnapshot(ref)),
      create: (ref, data) => { writes.push([ref, data]); },
    });
    for (const [ref, data] of writes) {
      if (creation.records.has(ref.path)) throw new Error('Synthetic create conflict');
      creation.records.set(ref.path, data);
      creation.writes.push(ref.path);
    }
    return result;
  },
}));
beforeEach(() => {
  creation.records.clear(); creation.writes = []; creation.nextId = 0; creation.actorUid = 'synthetic-creator'; creation.grants.mockClear();
  creation.authorize.mockReset().mockResolvedValue({ permissions: ['event.read', 'event.create'] });
});

const validConfiguration = {
  title: 'Filmový večer',
  startsAt: new Date('2026-10-20T17:00:00.000Z'),
  timeZone: 'Europe/Prague',
  venue: { name: 'Kulturní dům', publicLocation: 'Hlavní sál' },
  teamCapacity: 20,
  peopleCapacity: 120,
  teamSizeMin: 2,
  teamSizeMax: 4,
} as const;
const creationInput = () => ({ expectedRevision: 0, event: { ...validConfiguration, startsAt: validConfiguration.startsAt.toISOString() } });
async function invokeCreation(data: Record<string, unknown>) {
  const { createEvent } = await import('../functions/src/events/callables');
  return createEvent.run({ data, auth: { uid: creation.actorUid, token: { email_verified: true } } } as Parameters<typeof createEvent.run>[0]);
}

describe('event creation retry transaction (isolated adapter)', () => {
  test('returns the same event after the first committed response is lost, without repeated writes or grants', async () => {
    const input = { ...creationInput(), requestId: 'synthetic-lost-response' };
    const original = await invokeCreation(input); // The caller never receives this committed response.
    const records = [...creation.records.entries()];
    const writes = [...creation.writes];
    const retried = await invokeCreation(input);
    expect(retried).toEqual(original);
    expect([...creation.records.entries()]).toEqual(records);
    expect(creation.writes).toEqual(writes);
    expect(creation.grants).toHaveBeenCalledTimes(1);
    expect(creation.authorize).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ uid: creation.actorUid }),
      ['event.read', 'event.create'], { kind: 'event', id: original.eventId }, expect.any(Object));
    expect(creation.records.get('events/' + original.eventId)?.creationFingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(creation.records.get('publicEvents/' + original.eventId)).not.toHaveProperty('creationFingerprint');
  });

  test.each(['', 'bad/request', 'x'.repeat(151), 42, null])('rejects the explicit invalid creation request ID %j before mutation', async requestId => {
    await expect(invokeCreation({ ...creationInput(), requestId })).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(creation.records.size).toBe(0);
    expect(creation.grants).not.toHaveBeenCalled();
  });

  test('preserves independent legacy calls without request IDs and isolates the same ID by actor', async () => {
    const legacy = await invokeCreation(creationInput()), secondLegacy = await invokeCreation(creationInput());
    expect(secondLegacy.eventId).not.toBe(legacy.eventId);
    expect(creation.records.get('events/' + legacy.eventId)).not.toHaveProperty('creationFingerprint');
    const first = await invokeCreation({ ...creationInput(), requestId: 'shared-request' });
    creation.actorUid = 'other-creator';
    const second = await invokeCreation({ ...creationInput(), requestId: 'shared-request' });
    expect(second.eventId).not.toBe(first.eventId);
  });

  test.each([
    { title: 'Changed title' }, { description: 'Changed description' }, { startsAt: '2030-01-01T10:00:00Z' },
    { timeZone: 'UTC' }, { venue: { name: 'Changed venue', publicLocation: validConfiguration.venue.publicLocation } },
    { venue: { name: validConfiguration.venue.name, publicLocation: 'Changed location' } },
    { teamCapacity: 21 }, { peopleCapacity: 121 }, { teamSizeMin: 1 }, { teamSizeMax: 3 },
    { pricing: { mode: 'per-team', amountCzk: 351 } }, { pricing: { mode: 'per-event', amountCzk: 350 } },
    { pricing: { mode: 'per-team', amountCzk: 350, hidden: true } },
  ])('rejects request reuse with changed normalized creation fields %j', async patch => {
    const input = { ...creationInput(), requestId: 'changed-fields' };
    await invokeCreation(input);
    const records = [...creation.records.entries()];
    await expect(invokeCreation({ ...input, event: { ...input.event, ...patch } })).rejects.toMatchObject({ code: 'already-exists' });
    expect([...creation.records.entries()]).toEqual(records);
    expect(creation.grants).toHaveBeenCalledTimes(1);
  });

  test('normalizes equivalent creation values and returns the original receipt after subsequent edits', async () => {
    const input = { ...creationInput(), requestId: 'normalized-retry' };
    const original = await invokeCreation(input);
    const eventPath = 'events/' + original.eventId;
    creation.records.set(eventPath, { ...creation.records.get(eventPath), title: 'Later edited title', revision: 9,
      disposition: 'archived', lifecycleStatus: 'completed', registrationStatus: 'closed' });
    const current = [...creation.records.entries()];
    const retried = await invokeCreation({ ...input, event: { ...input.event, title: '  ' + input.event.title + '  ',
      description: '   ', startsAt: '2026-10-20T19:00:00+02:00', pricing: { mode: 'per-team', amountCzk: 350, hidden: false } } });
    expect(retried).toEqual(original);
    expect([...creation.records.entries()]).toEqual(current);
    expect(creation.grants).toHaveBeenCalledTimes(1);
  });

  test('denies replay when the current scoped authorizer rejects it', async () => {
    const input = { ...creationInput(), requestId: 'scope-removed' };
    await invokeCreation(input);
    creation.authorize.mockRejectedValueOnce(Object.assign(new Error('Scope removed'), { code: 'permission-denied' }));
    const records = [...creation.records.entries()];
    await expect(invokeCreation(input)).rejects.toMatchObject({ code: 'permission-denied' });
    expect([...creation.records.entries()]).toEqual(records);
    expect(creation.grants).toHaveBeenCalledTimes(1);
  });

  test.each(['trash', 'deleting'])('does not replay a creation from %s', async disposition => {
    const input = { ...creationInput(), requestId: 'trashed-attempt' };
    const original = await invokeCreation(input);
    const eventPath = 'events/' + original.eventId;
    creation.records.set(eventPath, { ...creation.records.get(eventPath), disposition });
    const records = [...creation.records.entries()];
    await expect(invokeCreation(input)).rejects.toMatchObject({ code: 'permission-denied' });
    expect([...creation.records.entries()]).toEqual(records);
    expect(creation.grants).toHaveBeenCalledTimes(1);
  });

  test('does not resurrect a permanently removed creation when its tombstone remains', async () => {
    const input = { ...creationInput(), requestId: 'removed-attempt' };
    const original = await invokeCreation(input);
    creation.records.delete('events/' + original.eventId); creation.records.delete('publicEvents/' + original.eventId);
    creation.records.set('eventTombstones/' + original.eventId, { eventId: original.eventId, createdBy: creation.actorUid });
    const records = [...creation.records.entries()];
    await expect(invokeCreation(input)).rejects.toMatchObject({ code: 'failed-precondition' });
    expect([...creation.records.entries()]).toEqual(records);
    expect(creation.grants).toHaveBeenCalledTimes(1);
  });

  test('binds the deterministic identity to actor and request while hashing normalized configuration separately', () => {
    const configuration = requestedEventConfiguration(creationInput());
    const first = eventCreationIdentity('actor-one', 'request-one', configuration);
    expect(first).toEqual({
      eventId: 'event_a151e4565c40981967fde83c87950a60daa1362954964ea1f575ad7bfb5f7ff0',
      fingerprint: 'cddfb6d58650460f3e6bd3b60a82acb23da2184f44df4ee5250f592f73bed98f',
    });
    expect(eventCreationIdentity('actor-one', 'request-two', configuration).eventId).not.toBe(first.eventId);
    expect(eventCreationIdentity('actor-two', 'request-one', configuration).eventId).not.toBe(first.eventId);
    expect(eventCreationIdentity('actor-one', 'request-one', { ...configuration, title: 'Different' })).toMatchObject({ eventId: first.eventId });
    expect(eventCreationIdentity('actor-one', 'request-one', { ...configuration, title: 'Different' }).fingerprint).not.toBe(first.fingerprint);
  });
});

function slide(overrides: Partial<EditorSlide> = {}): EditorSlide {
  return {
    id: 'question-1', position: 1, storedKind: 'free', kind: 'free', isQuestion: true,
    roundId: 'round-1', roundTitle: 'Kolo 1', title: '', text: 'Otázka', moderatorNote: '',
    options: [], correctAnswer: 'Odpověď', media: [],
    presentation: { videoStart: null, videoEnd: null, audioTrigger: null, backgroundOverlay: null, answerOverlay: null, sourceQuestionNumber: null },
    backgroundImage: '', questionImage: '', answerImage: '', mediaSource: '', backgroundOverlay: null,
    clipStartSeconds: null, clipEndSeconds: null, hasLegacyData: false,
    ...overrides,
  };
}

const quiz: EditorQuiz = {
  id: 'quiz-1', title: 'Kvíz', description: 'Popis', revision: 7,
  slideCount: 1, roundCount: 1, questionCount: 1, slides: [slide()],
};

test('immutable event source stores appearance and safe static result templates at lock time', () => {
  const authored: EditorQuiz = { ...quiz, printTemplate: { title: 'Team sheet', layout: 'compact', logoImage: 'https://example.test/logo.png' }, defaultDesign: { textColor: '#fff' }, defaultAppearance: { backgroundImage: '', backgroundOverlay: 30, imageLayout: 'split' }, resultTemplates: { final: { title: 'Winners', design: { accentColor: '#abc' } } } };
  const frozen = JSON.parse(JSON.stringify(buildQuizSnapshotMetadata(authored, { blockerCount: 0, warningCount: 0 }, 'admin', 'now'))) as Record<string, unknown>;
  const laterSource = { ...authored, defaultDesign: { textColor: '#000' }, resultTemplates: { final: { title: 'Changed later' } } };
  expect(laterSource.resultTemplates.final.title).toBe('Changed later');
  expect(frozen).toMatchObject({ quizRevision: 7, printTemplate: authored.printTemplate, defaultDesign: { textColor: '#fff' }, defaultAppearance: { backgroundOverlay: 30 }, resultTemplates: { final: { title: 'Winners', design: { accentColor: '#abc' } } } });
});

describe('event configuration', () => {
  test('accepts team limits and retains a nonbinding historical people limit', () => {
    expect(validateEventCapacity(validConfiguration)).toEqual([]);
    expect(validateEventConfiguration(validConfiguration)).toEqual([]);
    expect(validateEventCapacity({ ...validConfiguration, peopleCapacity: 1 })).toEqual([]);
  });

  test.each([
    [{ teamCapacity: 0 }, 'teamCapacity'],
    [{ peopleCapacity: 0 }, 'peopleCapacity'],
    [{ teamSizeMin: 0 }, 'teamSizeMin'],
    [{ teamSizeMin: 5, teamSizeMax: 4 }, 'teamSizeMax'],
    [{ teamSizeMax: 5 }, 'teamSizeMax'],
  ])('rejects malformed capacity configuration %o', (change, field) => {
    const issues = validateEventCapacity({ ...validConfiguration, ...change });
    expect(issues.some((item) => item.includes(field))).toBe(true);
  });

  test('permits retained team-size limits for publication without accepting new settings above four', () => {
    const request = { event: { ...validConfiguration, startsAt: validConfiguration.startsAt.toISOString(), teamSizeMax: 6 } };
    expect(() => requestedEventConfiguration(request)).toThrow('teamSizeMax');
    expect(requestedEventConfiguration(request, { allowLegacyTeamSize: true }).teamSizeMax).toBe(6);
    expect(() => requestedEventConfiguration({ event: { ...request.event, allowLegacyTeamSize: true } })).toThrow('teamSizeMax');
  });

  test.each(['', '   ', 'x'.repeat(501), 'Praha\u202e 1'])('rejects missing or invalid public venue details before creating the event', async publicLocation => {
    const event = { ...creationInput().event, venue: { ...validConfiguration.venue, publicLocation } };
    await expect(invokeCreation({ expectedRevision: 0, event })).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(creation.writes).toEqual([]);
  });

  test.each(['2026-03-29T02:30', '2026-10-25T02:30', '2026-02-30T09:00:00Z', '2026-03-29T24:00:00Z'])('requires an explicit, valid instant for %s', startsAt => {
    expect(() => requestedEventConfiguration({ event: { ...creationInput().event, startsAt } })).toThrow('Datum a čas');
  });

  test.each([
    ['2026-10-25T02:30+02:00', '2026-10-25T00:30:00.000Z'],
    ['2026-10-25T02:30:00+01:00', '2026-10-25T01:30:00.000Z'],
  ])('retains the absolute instant of existing offset-bearing inputs %s', (startsAt, expected) => {
    expect(requestedEventConfiguration({ event: { ...creationInput().event, startsAt } }).startsAt.toISOString()).toBe(expected);
  });

  test('uses half-point integer units and dense ranking by default', () => {
    expect(defaultScoringConfiguration).toEqual({ unitScale: 2, rankingMode: 'dense', started: false });
  });
});

describe('event lifecycle', () => {
  test('limits normal edits, cancellation, archive, and relock explicitly', () => {
    expect(canMutateEvent('scheduled')).toBe(true);
    expect(canMutateEvent('live')).toBe(false);
    expect(canCancelEvent('live')).toBe(true);
    expect(canCancelEvent('completed')).toBe(false);
    expect(canArchiveEvent('cancelled')).toBe(true);
    expect(canArchiveEvent('ready')).toBe(false);
  });
});

describe('public event projection', () => {
  test('contains only the explicit public allowlist', () => {
    const projection = buildPublicEventProjection({
      ...validConfiguration,
      description: 'Veřejný popis večera',
      lifecycleStatus: 'ready',
      startsAt: 'timestamp',
      registrationStatus: 'scheduled',
      registrationPublished: false,
      acceptedTeams: 0,
      acceptedPeople: 0,
      registrationOpensAt: null,
      registrationClosesAt: null,
      revision: 3,
      updatedAt: 'updated',
    });
    expect(projection).toEqual({
      title: 'Filmový večer', startsAt: 'timestamp', timeZone: 'Europe/Prague',
      pricing: { mode: 'per-team', amountCzk: 350 },
      description: 'Veřejný popis večera', lifecycleStatus: 'ready',
      venueName: 'Kulturní dům', publicLocation: 'Hlavní sál',
      registrationStatus: 'scheduled', registrationPublished: false, availability: 'scheduled',
      teamSize: { min: 2, max: 4 }, revision: 3, updatedAt: 'updated',
      capacity: { teams: { accepted: 0, maximum: 20 }, people: { accepted: 0, maximum: 120 } },
      registrationWindow: { opensAt: null, closesAt: null },
    });
    expect(projection).not.toHaveProperty('quizAssignment');
    expect(JSON.stringify(projection)).not.toMatch(/answer|email|organizer|contact/iu);
  });
});

describe('quiz snapshot and advisory preflight summary', () => {
  test('stores optional editorial findings without claiming the snapshot passed review', () => {
    expect(buildQuizSnapshotMetadata(quiz, { blockerCount: 2, warningCount: 3 }, 'admin', 'now')).toMatchObject({ status: 'ready', preflight: { status: 'BLOCKED', blockerCount: 2, warningCount: 3 } });
  });

  test('builds immutable snapshot metadata for the exact quiz revision', () => {
    const metadata = buildQuizSnapshotMetadata(quiz, { blockerCount: 0, warningCount: 0 }, 'admin-1', 'now');
    expect(metadata).toMatchObject({
      status: 'ready', quizId: 'quiz-1', quizRevision: 7, slideCount: 1,
      roundCount: 1, questionCount: 1, createdBy: 'admin-1', createdAt: 'now',
      preflight: { status: 'READY', blockerCount: 0, warningCount: 0 },
    });
  });

  test('accounts for root, event, and public writes in the transaction budget', () => {
    expect(snapshotWriteCount(315, 23)).toBe(342);
  });
});


test('editorial drafts, missing answers and incomplete media do not gate technical navigation', () => {
  expect(() => assertPlayableQuizSource(2, [
    { position: 2, kind: 'video', isQuestion: true, authoringStatus: 'draft', correctAnswer: '', mediaSource: '' },
    { position: 1, kind: 'intro' },
  ])).not.toThrow();
});

test.each([
  [0, []], [1, []], [2, [{ position: 1, kind: 'intro' }]],
  [1, [{ position: 2, kind: 'intro' }]],
  [2, [{ position: 1, kind: 'intro' }, { position: 1, kind: 'question' }]],
  [1, [{ position: '1', kind: 'intro' }]], [1, [{ position: 1, kind: '' }]],
  [1, [{ position: 1, kind: 'info', hidden: true }]],
])('rejects an empty, inconsistent, ambiguous or entirely hidden source (%j)', (count, slides) => {
  expect(() => assertPlayableQuizSource(count, slides as Record<string, unknown>[])).toThrow();
});

test('hidden flags cannot hide question slides from technical navigation', () => {
  expect(() => assertPlayableQuizSource(1, [{ position: 1, kind: 'free', isQuestion: true, hidden: true }])).not.toThrow();
});
