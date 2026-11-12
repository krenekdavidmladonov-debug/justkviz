import { beforeEach, expect, test, vi } from 'vitest';
import type { Membership } from '../packages/quiz-domain/src/index';

interface Store { records: Record<string, Record<string, unknown>>; writes: string[]; beforeTransaction: (() => void) | undefined }
const store = vi.hoisted((): Store => ({ records: {}, writes: [], beforeTransaction: undefined }));
type Ref = { path: string; filters: [string, unknown][]; maximum: number; collection: (name: string) => Ref; doc: (id: string) => Ref; where: (field: string, op: string, value: unknown) => Ref; limit: (n: number) => Ref; orderBy: (field: string) => Ref; get: () => ReturnType<typeof read> };
function ref(path: string, filters: [string, unknown][] = [], maximum = Infinity): Ref {
  return { path, filters, maximum, collection: name => ref(`${path}/${name}`), doc: id => ref(`${path}/${id}`),
    where: (field, _op, value) => ref(path, [...filters, [field, value]], maximum), limit: n => ref(path, filters, n), orderBy: () => ref(path, filters, maximum), get() { return read(this); } };
}
function snapshot(path: string) { return { id: path.split('/').at(-1), exists: !!store.records[path], data: () => store.records[path] }; }
function read(target: Ref) {
  if (target.path.split('/').length % 2 === 0) return Promise.resolve(snapshot(target.path));
  const docs = Object.keys(store.records).filter(path => path.startsWith(target.path + '/') && path.split('/').length === target.path.split('/').length + 1)
    .filter(path => target.filters.every(([field, value]) => field.split('.').reduce<unknown>((current, key) => (current as Record<string, unknown> | undefined)?.[key], store.records[path]) === value))
    .sort((a, b) => Number(store.records[a]?.position ?? 0) - Number(store.records[b]?.position ?? 0)).slice(0, target.maximum).map(snapshot);
  return Promise.resolve({ docs, size: docs.length });
}
const database = {
  doc: (path: string) => ref(path), collection: (path: string) => ref(path),
  async runTransaction<T>(run: (tx: unknown) => Promise<T>) {
    store.beforeTransaction?.();
    const writes: [string, Record<string, unknown>][] = [];
    const tx = { get: read, getAll: (...refs: Ref[]) => Promise.all(refs.map(read)), update: (target: Ref, patch: Record<string, unknown>) => writes.push([target.path, patch]) };
    const result = await run(tx);
    for (const [path, patch] of writes) { store.records[path] = { ...store.records[path], ...patch }; store.writes.push(path); }
    return result;
  },
};
vi.mock('../functions/node_modules/firebase-admin/lib/esm/firestore/index.js', async () => ({ ...await import('../functions/node_modules/firebase-admin/lib/firestore/index.js'), getFirestore: () => database }));
vi.mock('../functions/node_modules/firebase-admin/lib/esm/auth/index.js', () => ({ getAuth: () => ({ getUser: () => Promise.resolve({ uid: 'staff', emailVerified: true, disabled: false }) }) }));

const { trashQuiz, restoreQuiz } = await import('../functions/src/quizzes/management');
const { assertQuizActive, quizDisposition } = await import('../functions/src/quizzes/guards');
const { readAccessData } = await import('../functions/src/access/reads');
const { authorizeOperation } = await import('../functions/src/access/authorization');
const auth = { uid: 'staff', token: { email_verified: true, auth_time: 100, role: 'admin' } };
const request = (data: Record<string, unknown>) => ({ data, auth }) as unknown as Parameters<typeof trashQuiz.run>[0];
const invoke = (target: typeof trashQuiz, revision = 0) => target.run(request({ quizId: 'q', expectedRevision: revision }));
function member(patch: Partial<Membership> = {}) {
  const result: Membership = { uid: 'staff', status: 'active', role: 'manager', permissions: ['quiz.read', 'quiz.edit', 'quiz.delete', 'quiz.media.upload', 'quiz.export', 'quiz.answers.read', 'quiz.notes.read', 'event.live', 'event.read', 'event.manage'], version: 1,
    sessionValidAfter: 0, displayName: 'Synthetic staff', email: 'staff@example.test', quizzes: { mode: 'all', ids: [] }, events: { mode: 'all', ids: [] }, ...patch };
  store.records['memberships/staff'] = result as unknown as Record<string, unknown>;
}
beforeEach(() => {
  store.records = { 'quizzes/q': { title: 'Synthetic quiz', status: 'ready', createdBy: 'staff', slideCount: 1, roundCount: 0, questionCount: 1, privateExtension: { preserved: true } },
    'quizzes/q/slides/slide': { position: 1, kind: 'question', correctAnswer: 'private', mediaSource: 'quiz-asset://q/asset' },
    'quizzes/q/mediaAssets/asset': { generation: '123', status: 'ready' }, 'publicSessions/sentinel': { revision: 9 } };
  store.writes = []; store.beforeTransaction = undefined; member();
});

test('legacy root soft delete/restore advances revision and preserves source, media and public records', async () => {
  const original = structuredClone(store.records);
  await expect(invoke(trashQuiz)).resolves.toEqual({ quizId: 'q', revision: 1, disposition: 'trash' });
  expect(store.records['quizzes/q']).toMatchObject({ status: 'ready', disposition: 'trash', revision: 1, trashedBy: 'staff', privateExtension: { preserved: true } });
  expect(store.records['quizzes/q']?.trashedAt).toBeDefined();
  await expect(invoke(restoreQuiz, 1)).resolves.toEqual({ quizId: 'q', revision: 2, disposition: 'active' });
  for (const [path, value] of Object.entries(original)) if (path !== 'quizzes/q') expect(store.records[path]).toEqual(value);
  expect(store.writes).toEqual(['quizzes/q', 'quizzes/q']);
});

test('stale revision, malformed input and invalid state never write', async () => {
  await expect(invoke(trashQuiz, 1)).rejects.toMatchObject({ code: 'aborted' });
  await expect(invoke(restoreQuiz)).rejects.toMatchObject({ code: 'failed-precondition' });
  await expect(trashQuiz.run(request({ quizId: 'q', expectedRevision: 0, deleteMedia: true }))).rejects.toMatchObject({ code: 'invalid-argument' });
  for (const revision of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) await expect(invoke(trashQuiz, revision)).rejects.toMatchObject({ code: 'invalid-argument' });
  store.records['quizzes/q']!.revision = null;
  await expect(invoke(trashQuiz)).rejects.toMatchObject({ code: 'failed-precondition' });
  expect(store.writes).toEqual([]);
});

test('permission, current membership and quiz scope are required despite legacy admin claim', async () => {
  for (const patch of [{ permissions: ['quiz.read', 'quiz.edit'] }, { status: 'suspended' }, { quizzes: { mode: 'selected', ids: ['other'] } }, { quizzes: { mode: 'own', ids: [] } }]) {
    member(patch as Partial<Membership>);
    if (patch.quizzes?.mode === 'own') store.records['quizzes/q']!.createdBy = 'other';
    await expect(invoke(trashQuiz)).rejects.toMatchObject({ code: 'permission-denied' });
  }
  store.records['quizzes/q']!.createdBy = 'staff'; member();
  store.beforeTransaction = () => member({ permissions: ['quiz.read'] });
  await expect(invoke(trashQuiz)).rejects.toMatchObject({ code: 'permission-denied' });
  expect(store.writes).toEqual([]);
});

test('source sessions and missing/incomplete event snapshots block without exposing their identity', async () => {
  store.records['sessions/private-session'] = { quizId: 'q', status: 'waiting' };
  await expect(invoke(trashQuiz)).rejects.toMatchObject({ code: 'failed-precondition', details: undefined });
  store.records['sessions/private-session'].status = 'ended';
  store.records['events/private-event'] = { quizAssignment: { quizId: 'q', snapshotId: 'snap', quizRevision: 0, roundCount: 0, questionCount: 1 } };
  await expect(invoke(trashQuiz)).rejects.toMatchObject({ code: 'failed-precondition' });
  store.records['quizSnapshots/snap'] = { quizId: 'q', eventId: 'private-event', quizRevision: 0, status: 'ready', slideCount: 1, roundCount: 0, questionCount: 1 };
  await expect(invoke(trashQuiz)).rejects.toMatchObject({ code: 'failed-precondition' });
  store.records['quizSnapshots/snap/slides/slide'] = { position: 2 };
  await expect(invoke(trashQuiz)).rejects.toMatchObject({ code: 'failed-precondition' });
  store.records['quizSnapshots/snap/slides/slide'] = { position: 1, correctAnswer: 'private snapshot answer' };
  store.records['sessions/event-session'] = { quizId: 'q', eventId: 'private-event', snapshotId: 'snap', status: 'active' };
  const immutable = structuredClone(store.records['quizSnapshots/snap/slides/slide']);
  await expect(invoke(trashQuiz)).resolves.toMatchObject({ disposition: 'trash' });
  expect(store.records['quizSnapshots/snap/slides/slide']).toEqual(immutable);
  expect(store.writes).toEqual(['quizzes/q']);
});

test('list defaults to active, trash requires deletion permission and still respects scope', async () => {
  store.records['quizzes/trash'] = { title: 'Trashed', disposition: 'trash', revision: 4, createdBy: 'other' };
  const list = (includeTrash?: unknown) => readAccessData.run(request({ operation: 'quizzes', ...(includeTrash === undefined ? {} : { includeTrash }) }));
  const rows = await list() as { id: string; data: Record<string, unknown> }[];
  expect(rows.map(row => row.id)).toEqual(['q']);
  expect(rows[0]?.data).toMatchObject({ disposition: 'active', revision: 0 });
  await expect(list(true)).resolves.toHaveLength(2);
  member({ permissions: ['quiz.read'] });
  await expect(list(true)).rejects.toMatchObject({ code: 'permission-denied' });
  await expect(list('yes')).rejects.toMatchObject({ code: 'invalid-argument' });
  member({ quizzes: { mode: 'selected', ids: ['trash'] } });
  await expect(list(true)).resolves.toEqual([expect.objectContaining({ id: 'trash' })]);
});

test('trashed sources reject editing, new live use, locking and uploads while snapshot session controls remain authorized', async () => {
  store.records['quizzes/q']!.disposition = 'trash';
  expect(quizDisposition({ status: 'archived' })).toBe('active');
  expect(() => assertQuizActive(store.records['quizzes/q'])).toThrow();
  for (const name of ['updateQuizMetadata', 'deleteQuizSlide', 'repairQuizPreflightIssue', 'beginQuizMediaUpload', 'finalizeQuizMediaUpload', 'createLiveSession', 'lockEventQuiz']) {
    await expect(authorizeOperation(name, request({ quizId: 'q', eventId: 'e' }))).rejects.toMatchObject({ code: 'failed-precondition' });
  }
  store.records['events/e'] = { disposition: 'active', lifecycleStatus: 'ready' };
  store.records['sessions/live'] = { quizId: 'q', eventId: 'e', snapshotId: 'snap' };
  await expect(authorizeOperation('nextSlide', request({ sessionId: 'live' }))).resolves.toMatchObject({ uid: 'staff' });
});
