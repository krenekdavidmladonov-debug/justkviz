import { beforeEach, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

interface Fixture { records: Record<string, Record<string, unknown>>; writes: string[];
  user: { uid: string; emailVerified: boolean; disabled: boolean }; beforeTransaction?: () => void }
const state = vi.hoisted((): Fixture => ({ records: {}, writes: [], user: { uid: 'moderator', emailVerified: true, disabled: false } }));
type Ref = { path: string; get: () => Promise<ReturnType<typeof snapshot>>; collection: (name: string) => Query };
type Query = { path: string; doc: (id: string) => Ref; where: (key: string, op: string, value: unknown) => Query; limit: (count: number) => Query;
  read: () => { docs: ReturnType<typeof snapshot>[]; size: number } };
function snapshot(path: string) { return { id: path.split('/').at(-1)!, exists: !!state.records[path], data: () => state.records[path] }; }
function document(path: string): Ref { return { path, get: () => Promise.resolve(snapshot(path)), collection: name => collection(path + '/' + name) }; }
function collection(path: string, predicates: [string, unknown][] = [], limit = Infinity): Query {
  return { path, doc: id => document(path + '/' + id), where: (key, _op, value) => collection(path, [...predicates, [key, value]], limit),
    limit: count => collection(path, predicates, count), read: () => {
      const docs = Object.keys(state.records).filter(key => key.startsWith(path + '/') && !key.slice(path.length + 1).includes('/'))
        .filter(key => predicates.every(([field, value]) => state.records[key]![field] === value)).slice(0, limit).map(snapshot);
      return { docs, size: docs.length };
    } };
}
const database = { doc: document, collection,
  async runTransaction<T>(run: (tx: unknown) => Promise<T>): Promise<T> {
    state.beforeTransaction?.();
    const pending: [string, Record<string, unknown>][] = [];
    const get = (ref: Ref | Query) => Promise.resolve('read' in ref ? ref.read() : snapshot(ref.path));
    const write = (ref: Ref, value: Record<string, unknown>) => { pending.push([ref.path, value]); };
    const result = await run({ get, getAll: (...refs: Ref[]) => Promise.resolve(refs.map(ref => snapshot(ref.path))), set: write, create: write,
      update: (ref: Ref, value: Record<string, unknown>) => write(ref, { ...state.records[ref.path], ...value }) });
    for (const [path, value] of pending) { state.records[path] = value; state.writes.push(path); }
    return result;
  } };
vi.mock('../functions/node_modules/firebase-admin/lib/esm/firestore/index.js', async () => ({
  Timestamp: (await import('firebase/firestore')).Timestamp, getFirestore: () => database,
}));
vi.mock('../functions/node_modules/firebase-admin/lib/esm/auth/index.js', () => ({ getAuth: () => ({ getUser: () => Promise.resolve(state.user) }) }));
const { controlInterimResults } = await import('../functions/src/leaderboard/callables');
const auth = { uid: 'moderator', token: { email_verified: true, auth_time: 100, role: 'moderator' } };
const command = (action = 'current', extra: Record<string, unknown> = {}) => ({ eventId: 'event', sessionId: 'session', requestId: randomUUID(),
  expectedRevision: state.records['sessions/session']!.revision, action, ...extra });
const call = (data: Record<string, unknown>, identity: typeof auth | null = auth) => controlInterimResults.run({ auth: identity ?? undefined, data } as unknown as Parameters<typeof controlInterimResults.run>[0]);
const session = () => state.records['sessions/session']!;
const publicState = () => state.records['publicSessions/session']!;
beforeEach(() => {
  state.writes = []; state.beforeTransaction = undefined; state.user.disabled = false;
  state.records = {
    'memberships/moderator': { uid: 'moderator', status: 'active', role: 'moderator', version: 1, sessionValidAfter: 0,
      permissions: ['event.read', 'event.live', 'event.answers.read'], quizzes: { mode: 'all', ids: [] }, events: { mode: 'all', ids: [] } },
    'events/event': { lifecycleStatus: 'live', liveSessionId: 'session', quizAssignment: { snapshotId: 'snapshot' } },
    'quizSnapshots/snapshot': { quizId: 'quiz', slideCount: 1 },
    'quizSnapshots/snapshot/rounds/r1': { title: 'First', position: 1 },
    'quizSnapshots/snapshot/rounds/r2': { title: 'Final', position: 2 },
    'quizSnapshots/snapshot/slides/q1': { position: 1, kind: 'classic', isQuestion: true, roundId: 'r1', title: 'Public prompt',
      text: 'Public text', correctAnswer: 'PRIVATE_ANSWER', answerImage: 'https://example.test/private-answer.png', moderatorNote: 'PRIVATE_NOTE' },
    'sessions/session': { quizId: 'quiz', quizTitle: 'Quiz', eventId: 'event', snapshotId: 'snapshot', slideCount: 1, currentSlidePosition: 1,
      currentSlideId: 'q1', status: 'active', revision: 7, answerRevealed: true, presentationMode: 'slide', mediaCommand: 'idle', mediaPlaybackState: 'idle',
      mediaGeneration: 3, introGeneration: 0, createdBy: 'moderator', updatedBy: 'moderator', createdAt: 1, updatedAt: 1, startedAt: 1, endedAt: null },
    'publicSessions/session': { status: 'active', revision: 7, revealedAnswer: 'PRIVATE_ANSWER' },
  };
  for (let i = 0; i < 8; i++) state.records[`events/event/registrations/t${i}`] = { teamName: `Team ${i}`, status: 'accepted', revision: 1,
    contactEmail: 'PRIVATE_CONTACT', managementTokenHash: 'PRIVATE_CAPABILITY' };
  state.records['events/event/registrations/cancelled'] = { teamName: 'Cancelled', status: 'cancelled' };
  state.records['events/event/scores/a'] = { snapshotId: 'snapshot', teamId: 't0', roundId: 'r1', halfPoints: 7, revision: 1 };
  state.records['events/event/scores/b'] = { snapshotId: 'snapshot', teamId: 't0', roundId: 'r2', halfPoints: 5, revision: 1 };
  state.records['events/event/scores/zero'] = { snapshotId: 'snapshot', teamId: 't1', roundId: 'r2', halfPoints: 0, revision: 1 };
  state.records['events/event/scores/null'] = { snapshotId: 'snapshot', teamId: 't2', roundId: 'r1', halfPoints: null, revision: 1 };
  state.records['events/event/scores/foreign'] = { snapshotId: 'foreign', teamId: 't3', roundId: 'r2', halfPoints: 999, revision: 1 };
  state.records['events/event/scores/cancelled'] = { snapshotId: 'snapshot', teamId: 'cancelled', roundId: 'r2', halfPoints: 999, revision: 1 };
});

test('current command atomically publishes saved totals, immutable incomplete evidence and six safe rows', async () => {
  const scoresBefore = Object.entries(state.records).filter(([path]) => path.startsWith('events/event/scores/'));
  await call(command());
  const raw = publicState(), result = raw.interimResults as { rows: { halfPoints: number }[]; versionId: string; pageCount: number; pageSize: number; presentationStyle: string };
  expect(result).toMatchObject({ presentationStyle: 'show', pageSize: 6, pageCount: 2 });
  expect(result.rows).toHaveLength(6); expect(result.rows.map(row => row.halfPoints)).toEqual([12, 0, 0, 0, 0, 0]);
  expect(raw.interimBackdrop).toMatchObject({ title: 'Public prompt' });
  const wire = JSON.stringify(raw);
  for (const forbidden of ['PRIVATE_', 'snapshotId', 'sourceFingerprint', 'actorUid', 'teamId', 'presentScoreCount', 'answerImage', 'revealedAnswer']) expect(wire).not.toContain(forbidden);
  const saved = state.records['sessions/session/interimVersions/' + result.versionId]!;
  expect(saved).toMatchObject({ scope: 'current', complete: false, expectedScoreCount: 16, presentScoreCount: 3, missingScoreCount: 13, snapshotId: 'snapshot' });
  expect(saved.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/u);
  expect(Object.entries(state.records).filter(([path]) => path.startsWith('events/event/scores/'))).toEqual(scoresBefore);
  expect(state.writes).toHaveLength(4);
  expect(session().interimReturn).toMatchObject({ answerRevealed: true });
});

test('current versions stay frozen through score edits and pages; hide restores trusted answer, replay cannot republish', async () => {
  const request = command(); await call(request);
  const version = structuredClone(publicState().interimResults);
  state.records['events/event/scores/a'] = { ...state.records['events/event/scores/a'], halfPoints: 999, revision: 2 };
  await call(command('page', { page: 1 }));
  expect((publicState().interimResults as { rows: unknown[] }).rows).toHaveLength(2);
  await call(command('hide'));
  expect(publicState().revealedAnswer).toBe('PRIVATE_ANSWER'); expect(publicState().interimResults).toBeUndefined();
  const writesBeforeReplay = state.writes.length;
  expect(await call(request)).toMatchObject({ replayed: true });
  expect(state.writes).toHaveLength(writesBeforeReplay); expect(publicState().interimResults).toBeUndefined();
  await call(command());
  expect((publicState().interimResults as { rows: { halfPoints: number }[] }).rows[0]!.halfPoints).toBe(1004);
  expect(publicState().interimResults).not.toEqual(version);
});

test('current requires fresh revision and rejects client totals, round selections, preview fingerprints and style overrides', async () => {
  for (const extra of [{ expectedRevision: 6 }, { throughRoundId: 'r1' }, { sourceFingerprint: 'forged' }, { rows: [] }, { presentationStyle: 'classic' }, { motion: 'static' }]) {
    await expect(call(command('current', extra))).rejects.toMatchObject({ code: 'expectedRevision' in extra ? 'aborted' : 'invalid-argument' });
    expect(state.writes).toEqual([]);
  }
  session().snapshotId = 'foreign';
  await expect(call(command())).rejects.toMatchObject({ code: 'failed-precondition' });
  expect(state.writes).toEqual([]);
});

test('current rejects no entered score and does not write missing cells as zero', async () => {
  for (const path of Object.keys(state.records).filter(path => path.startsWith('events/event/scores/'))) delete state.records[path];
  await expect(call(command())).rejects.toMatchObject({ code: 'failed-precondition' }); expect(state.writes).toEqual([]);
});

test('current and receipt replay recheck active scoped membership and fresh Auth', async () => {
  const request = command(); await call(request);
  const writesBefore = state.writes.length;
  const member = state.records['memberships/moderator']!;
  member.permissions = ['event.read'];
  await expect(call(request)).rejects.toMatchObject({ code: 'permission-denied' });
  member.permissions = ['event.read', 'event.live']; member.events = { mode: 'selected', ids: ['foreign'] };
  await expect(call(request)).rejects.toMatchObject({ code: 'permission-denied' });
  member.events = { mode: 'all', ids: [] }; state.user.disabled = true;
  await expect(call(request)).rejects.toMatchObject({ code: 'permission-denied' }); state.user.disabled = false;
  await expect(call(request, null)).rejects.toMatchObject({ code: 'unauthenticated' });
  state.beforeTransaction = () => { member.status = 'suspended'; };
  await expect(call(command())).rejects.toMatchObject({ code: 'permission-denied' });
  expect(state.writes).toHaveLength(writesBefore);
});
