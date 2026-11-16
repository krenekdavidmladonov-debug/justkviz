import { createHash } from 'node:crypto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Membership } from '../packages/quiz-domain/src/access';
import type { AuthIdentity } from '../functions/src/access/authorization';

type Data = Record<string, unknown>;
interface Ref { path: string; id: string; collection(name: string): Query }
interface Query { path: string; filters: readonly [string, string, unknown][]; maximum: number; doc(id: string): Ref; where(field: string, operator: string, value: unknown): Query; limit(count: number): Query; orderBy(field: string): Query }
const state = vi.hoisted((): { records: Record<string, Data>; reads: string[]; writes: string[]; original: string } => ({ records: {}, reads: [], writes: [], original: '' }));
const document = (path: string): Ref => ({ path, id: path.split('/').at(-1)!, collection: name => collection(`${path}/${name}`) });
function collection(path: string, filters: Query['filters'] = [], maximum = Infinity): Query {
  return { path, filters, maximum, doc: id => document(`${path}/${id}`),
    where: (field, operator, value) => collection(path, [...filters, [field, operator, value]], maximum),
    limit: count => collection(path, filters, count), orderBy: () => collection(path, filters, maximum) };
}
const nested = (data: Data, field: string): unknown => field.split('.').reduce<unknown>((value, key) => value && typeof value === 'object' ? (value as Data)[key] : undefined, data);
const snapshot = (ref: Ref) => ({ ...ref, exists: state.records[ref.path] !== undefined, data: () => structuredClone(state.records[ref.path]) });
const transaction = {
  get: (ref: Ref | Query) => {
    state.reads.push(ref.path);
    if (!('filters' in ref)) return Promise.resolve(snapshot(ref));
    const docs = Object.entries(state.records).filter(([path, data]) => path.startsWith(ref.path + '/') && path.slice(ref.path.length + 1).split('/').length === 1
      && ref.filters.every(([field, operator, value]) => operator === '==' ? nested(data, field) === value : operator === 'in' && Array.isArray(value) && value.includes(nested(data, field))))
      .slice(0, ref.maximum).map(([path]) => snapshot(document(path)));
    return Promise.resolve({ docs, size: docs.length, empty: !docs.length });
  },
  getAll: (...refs: Ref[]) => { state.reads.push(...refs.map(ref => ref.path)); return Promise.resolve(refs.map(snapshot)); },
  set: (ref: Ref) => { state.writes.push(ref.path); throw new Error('Unexpected write'); },
  update: (ref: Ref) => { state.writes.push(ref.path); throw new Error('Unexpected write'); },
  create: (ref: Ref) => { state.writes.push(ref.path); throw new Error('Unexpected write'); },
  delete: (ref: Ref) => { state.writes.push(ref.path); throw new Error('Unexpected write'); },
};
const database = { doc: document, collection, runTransaction: <T>(handler: (tx: typeof transaction) => Promise<T>) => handler(transaction) };
vi.mock('../functions/node_modules/firebase-admin/lib/esm/firestore/index.js', async () => ({
  getFirestore: () => database, Timestamp: (await import('firebase/firestore')).Timestamp, FieldPath: { documentId: () => '__name__' },
}));
vi.mock('../functions/node_modules/firebase-admin/lib/esm/auth/index.js', () => ({ getAuth: () => ({ getUser: () => Promise.resolve({ uid: 'moderator', disabled: false, emailVerified: true }) }) }));
vi.mock('../functions/node_modules/firebase-admin/lib/esm/app/index.js', () => ({ getApps: () => [{}], initializeApp: vi.fn() }));

const { readAccessData } = await import('../functions/src/access/reads');
const { authorizePrivateMedia } = await import('../functions/src/access/media');
const { loadSlide } = await import('../functions/src/live/callables');
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const auth: NonNullable<AuthIdentity> = { uid: 'moderator', token: { email_verified: true, auth_time: 1_800_000_000, role: 'moderator',
  aud: 'demo-snapshot-clips', iss: 'https://securetoken.google.com/demo-snapshot-clips', sub: 'moderator', uid: 'moderator',
  exp: 1_800_003_600, iat: 1_800_000_000, firebase: { identities: {}, sign_in_provider: 'password' } } };
const source = { type: 'youtube', kind: 'audio', videoId: 'abcdefghijk', startSeconds: 10, endSeconds: 23 };
const jobId = 'b'.repeat(64), assetId = hash(['drive-asset-v1', jobId]);
const reference = `quiz-asset:quiz/${assetId}`;
const frozenPath = 'quizSnapshots/frozen/slides/question';
const readSlides = () => readAccessData.run({ auth, data: { operation: 'snapshotSlides', snapshotId: 'frozen' } } as unknown as Parameters<typeof readAccessData.run>[0]);
function member(patch: Partial<Membership> = {}) {
  const value: Membership = { uid: 'moderator', role: 'moderator', status: 'active', version: 4, sessionValidAfter: 0,
    permissions: ['event.read', 'event.live'], quizzes: { mode: 'none', ids: [] }, events: { mode: 'selected', ids: ['event'] },
    displayName: 'Synthetic moderator', email: 'moderator@example.test', ...patch };
  state.records['memberships/moderator'] = value as unknown as Data;
}
function installClip(quizId = 'quiz', descriptor = source, importJobId = jobId) {
  const id = hash(['drive-asset-v1', importJobId]), sha256 = 'c'.repeat(64), md5Checksum = 'd'.repeat(32);
  const output = { contentType: 'audio/mpeg', size: 512, sha256, md5Checksum, durationSeconds: 12.8 };
  const fingerprint = hash(descriptor);
  state.records[`quizzes/${quizId}/mediaAssets/${id}`] = { quizId, assetId: id, kind: 'audio', status: 'ready', storageBackend: 'drive',
    createdBy: 'owner', createdAt: 2, readyAt: 3, generation: `drive:${sha256}`, sha256, importJobId, contentType: output.contentType, size: output.size,
    privateProvenance: { field: 'mediaSource', source: descriptor, sourceFingerprint: fingerprint, sourceQuizRevision: 182 },
    drive: { ownerUid: 'owner', connectionGeneration: 1, accountPermissionId: 'private_account', file: { id: 'private_file', folderId: 'private_folder', mimeType: output.contentType, size: output.size, sha256, md5Checksum } } };
  state.records[`driveMediaJobs/${importJobId}`] = { schemaVersion: 1, status: 'ready', jobId: importJobId, assetId: id, quizId, slideId: 'question', field: 'mediaSource',
    ownerUid: 'owner', source: descriptor, sourceFingerprint: fingerprint, sourceQuizRevision: 182, fileId: 'private_file', folderId: 'private_folder', accountPermissionId: 'private_account', connectionGeneration: 1, output };
  return `quiz-asset:${quizId}/${id}`;
}
beforeEach(() => {
  state.reads = []; state.writes = [];
  state.records = {
    'events/event': { lifecycleStatus: 'live', scoring: { started: true }, quizAssignment: { quizId: 'quiz', snapshotId: 'frozen', quizRevision: 32 }, liveSessionId: 'live' },
    'quizSnapshots/frozen': { status: 'ready', quizId: 'quiz', quizRevision: 32 },
    [frozenPath]: { kind: 'audio', position: 1, isQuestion: true, roundId: 'round', title: 'Frozen title', text: 'Frozen prompt', options: ['A', 'B'],
      correctAnswer: 'PRIVATE_ANSWER', moderatorNote: 'PRIVATE_NOTE', answerImage: `quiz-asset:quiz/${'e'.repeat(64)}`,
      mediaSource: 'https://www.youtube.com/watch?v=abcdefghijk', clipStartSeconds: 10, clipEndSeconds: 23 },
    'quizSnapshots/frozen/rounds/round': { position: 1, title: 'Frozen round' },
    'events/event/scores/score': { value: 7 },
  };
  member(); installClip(); state.original = JSON.stringify(state.records);
});
afterEach(() => { expect(state.writes).toEqual([]); expect(JSON.stringify(state.records)).toBe(state.original); });
const acknowledgeFixtureChange = () => { state.original = JSON.stringify(state.records); };

test('event-only moderator reads and authorizes the exact derived clip without source quiz access or private metadata', async () => {
  const slides = await readSlides() as Data[];
  expect(slides).toHaveLength(1);
  expect(slides[0]).toMatchObject({ id: 'question', title: 'Frozen title', text: 'Frozen prompt', options: ['A', 'B'], mediaSource: reference, clipStartSeconds: 0, clipEndSeconds: 12.8, correctAnswer: '', moderatorNote: '', answerImage: '' });
  expect(JSON.stringify(slides)).not.toMatch(/PRIVATE_|private_account|private_file|private_folder|sourceFingerprint|driveImportProvenance|privateProvenance|originalMediaSource|importJobId/u);
  await expect(authorizePrivateMedia(auth, reference, 'frozen')).resolves.toBe(4);
  expect(state.reads).not.toContain('quizzes/quiz');
  expect(state.reads.some(path => path.startsWith('quizzes/quiz/slides'))).toBe(false);
  await expect(authorizePrivateMedia(auth, reference)).rejects.toMatchObject({ code: 'permission-denied' });
});

test('trusted live loader resolves the same clip while retaining the frozen question, answer, and original-video choice', async () => {
  const slide = await loadSlide(transaction as unknown as Parameters<typeof loadSlide>[0], 'quiz', 1, 'frozen');
  expect(slide).toMatchObject({ id: 'question', text: 'Frozen prompt', options: ['A', 'B'], correctAnswer: 'PRIVATE_ANSWER', mediaSource: reference,
    originalMediaSource: 'https://www.youtube.com/watch?v=abcdefghijk', clipStartSeconds: 0, clipEndSeconds: 12.8 });
  expect(state.reads).not.toContain('quizzes/quiz');
  await expect(loadSlide(transaction as unknown as Parameters<typeof loadSlide>[0], 'other-quiz', 1, 'frozen')).rejects.toThrow('Snapshot source does not match');
});

test('frozen image originals are used by snapshot reads and live loader while answer URLs stay redacted', async () => {
  const questionUrl = 'https://images.example.test/frozen-question.png', answerUrl = 'https://images.example.test/PRIVATE_ANSWER.png';
  const receipts: Data = {};
  for (const [field, url, importJobId] of [['questionImage', questionUrl, 'a'.repeat(64)], ['answerImage', answerUrl, 'f'.repeat(64)]]) {
    const descriptor = { type: 'https-image', kind: 'image', url };
    state.records[frozenPath]![field!] = `quiz-asset:quiz/${hash(['drive-asset-v1', importJobId])}`;
    receipts[field!] = { field, source: descriptor, sourceFingerprint: hash(descriptor), sourceQuizRevision: 32, importJobId };
  }
  state.records[frozenPath]!.driveImportProvenance = receipts;
  acknowledgeFixtureChange();
  const visible = await readSlides() as Data[];
  expect(visible[0]).toMatchObject({ questionImage: questionUrl, answerImage: '', mediaSource: reference });
  expect(JSON.stringify(visible)).not.toContain(answerUrl);
  const live = await loadSlide(transaction as unknown as Parameters<typeof loadSlide>[0], 'quiz', 1, 'frozen');
  expect(live).toMatchObject({ questionImage: questionUrl, answerImage: answerUrl, mediaSource: reference });
  const questionReference = state.records[frozenPath]!.questionImage as string;
  const answerReference = state.records[frozenPath]!.answerImage as string;
  await expect(authorizePrivateMedia(auth, questionReference, 'frozen')).resolves.toBe(4);
  await expect(authorizePrivateMedia(auth, answerReference, 'frozen')).rejects.toMatchObject({ code: 'permission-denied' });
  member({ permissions: ['event.read', 'event.live', 'event.answers.read'] });
  acknowledgeFixtureChange();
  await expect(authorizePrivateMedia(auth, answerReference, 'frozen')).resolves.toBe(4);
  state.records['events/event']!.quizAssignment = { quizId: 'quiz', snapshotId: 'new-snapshot', quizRevision: 32 };
  acknowledgeFixtureChange();
  await expect(authorizePrivateMedia(auth, questionReference, 'frozen')).rejects.toMatchObject({ code: 'permission-denied' });
  expect(state.reads.some(path => path.startsWith('quizzes/quiz/slides'))).toBe(false);
  expect(state.reads).not.toContain('quizzes/quiz');
});

test('another quiz asset and a different interval never become authorized by event scope', async () => {
  const otherQuiz = installClip('other-quiz');
  const otherInterval = installClip('quiz', { ...source, endSeconds: 24 }, 'f'.repeat(64));
  acknowledgeFixtureChange();
  await expect(authorizePrivateMedia(auth, otherQuiz, 'frozen')).rejects.toMatchObject({ code: 'permission-denied' });
  await expect(authorizePrivateMedia(auth, otherInterval, 'frozen')).rejects.toMatchObject({ code: 'permission-denied' });
  await expect(authorizePrivateMedia(auth, `quiz-asset:quiz/${'e'.repeat(64)}`, 'frozen')).rejects.toMatchObject({ code: 'permission-denied' });
});

test('a mismatched import receipt leaves the frozen YouTube source and grants no derived reference', async () => {
  (state.records[`driveMediaJobs/${jobId}`]!.source as Data).endSeconds = 24;
  acknowledgeFixtureChange();
  expect((await readSlides() as Data[])[0]).toMatchObject({ mediaSource: 'https://www.youtube.com/watch?v=abcdefghijk', clipStartSeconds: 10, clipEndSeconds: 23 });
  await expect(authorizePrivateMedia(auth, reference, 'frozen')).rejects.toMatchObject({ code: 'permission-denied' });
});

test.each(['suspended', 'scope', 'permission', 'assignment', 'trash'] as const)('%s revocation denies both snapshot views and derived clip reads', async change => {
  if (change === 'suspended') member({ status: 'suspended' });
  if (change === 'scope') member({ events: { mode: 'none', ids: [] } });
  if (change === 'permission') member({ permissions: ['event.live'] });
  if (change === 'assignment') state.records['events/event']!.quizAssignment = { snapshotId: 'replacement', quizId: 'quiz' };
  if (change === 'trash') state.records['events/event']!.disposition = 'trash';
  acknowledgeFixtureChange();
  await expect(readSlides()).rejects.toMatchObject({ code: 'permission-denied' });
  await expect(authorizePrivateMedia(auth, reference, 'frozen')).rejects.toMatchObject({ code: 'permission-denied' });
  expect(state.reads.some(path => path.includes('/mediaAssets'))).toBe(false);
});
