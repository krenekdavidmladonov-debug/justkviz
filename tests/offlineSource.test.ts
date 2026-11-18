import { beforeEach, expect, it, vi } from 'vitest';
import { Timestamp, type Transaction } from '../functions/node_modules/firebase-admin/lib/firestore/index.js';
import { readOfflineSource } from '../functions/src/offline/source';

const sdk = vi.hoisted(() => ({ firestore: vi.fn() }));
vi.mock('../functions/node_modules/firebase-admin/lib/esm/firestore/index.js', async () => ({
  ...await import('../functions/node_modules/firebase-admin/lib/firestore/index.js'), getFirestore: sdk.firestore,
}));
vi.mock('../functions/src/access/authorization', () => ({ authorize: vi.fn(() => Promise.resolve({ uid: 'synthetic-staff', version: 1 })) }));

const eventId = 'synthetic-event', snapshotId = 'synthetic-snapshot';
const identity = { uid: 'synthetic-staff', token: {} } as Parameters<typeof readOfflineSource>[2];
let registrations: { id: string; data: Record<string, unknown> }[];
function reference(path: string) {
  return { path, id: path.split('/').at(-1), collection: (name: string) => reference(path + '/' + name), doc: (id: string) => reference(path + '/' + id),
    orderBy: () => reference(path), limit: () => reference(path), where: () => reference(path) };
}
const row = (id: string, data: Record<string, unknown>) => ({ id, data: () => data });
function snapshotFor(path: string) {
  if (path === 'events/' + eventId) return { data: () => ({ title: 'Syntetická akce', revision: 1, startsAt: Timestamp.fromMillis(1_900_000_000_000),
    lifecycleStatus: 'ready', scoring: { unitScale: 2, rankingMode: 'dense' }, quizAssignment: { snapshotId, quizId: 'synthetic-quiz', quizRevision: 1 } }) };
  if (path === 'quizSnapshots/' + snapshotId) return { data: () => ({ status: 'ready', eventId, quizId: 'synthetic-quiz', quizRevision: 1, slideCount: 1, roundCount: 1 }) };
  const docs = path.endsWith('/slides') ? [row('slide-1', { position: 1, kind: 'free', isQuestion: true, title: 'Syntetická otázka', text: 'Otázka', correctAnswer: 'Odpověď', roundId: 'round-1' })]
    : path.endsWith('/rounds') ? [row('round-1', { position: 1, title: 'Kolo 1' })]
    : path.endsWith('/registrations') ? registrations.map(item => row(item.id, item.data)) : [];
  return { docs, size: docs.length, empty: docs.length === 0 };
}
const transaction = { get: ({ path }: { path: string }) => Promise.resolve(snapshotFor(path)), getAll: () => Promise.resolve([]) } as unknown as Transaction;

beforeEach(() => {
  sdk.firestore.mockReturnValue({ doc: reference, collection: reference });
  registrations = [{ id: 'team-1', data: { eventId, teamName: 'Syntetický tým', status: 'accepted' } }];
});

it('exports legacy accepted registrations without a revision as revision zero', async () => {
  const source = await readOfflineSource(transaction, eventId, identity);
  expect(source.teams).toEqual([{ id: 'team-1', name: 'Syntetický tým', revision: 0 }]);
  expect(source.baseScores).toEqual([{ teamId: 'team-1', roundId: 'round-1', revision: 0, halfPoints: null }]);
});

it.each([0, 1, 8])('preserves an explicit valid registration revision %s', async revision => {
  registrations[0]!.data.revision = revision;
  expect((await readOfflineSource(transaction, eventId, identity)).teams[0]?.revision).toBe(revision);
});

it.each([null, '1', -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects an explicit malformed registration revision %s', async revision => {
  registrations[0]!.data.revision = revision;
  await expect(readOfflineSource(transaction, eventId, identity)).rejects.toMatchObject({ code: 'failed-precondition' });
});
