import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parsePoints, pointsText, scoreLabel } from '../apps/web/src/features/scoring/model';
import { parseScoreRequest, parseRoundScoreRequest } from '../functions/src/scoring/validation';
import { commitRoundScores } from '../functions/src/scoring/core';

const fake = vi.hoisted(() => ({ documents: new Map<string, unknown>(), writes: [] as { path: string; data: unknown }[] }));
vi.mock('../functions/src/access/authorization.js', () => ({ runAccessTransaction: (_db: unknown, handler: (tx: unknown) => unknown) => handler({
  get: (ref: { path: string }) => Promise.resolve({ exists: fake.documents.has(ref.path), data: () => fake.documents.get(ref.path) }),
  getAll: (...refs: { path: string }[]) => Promise.resolve(refs.map(ref => ({ exists: fake.documents.has(ref.path), data: () => fake.documents.get(ref.path) }))),
  set: (ref: { path: string }, data: unknown) => fake.writes.push({ path: ref.path, data }),
  create: (ref: { path: string }, data: unknown) => fake.writes.push({ path: ref.path, data }),
  update: (ref: { path: string }, data: unknown) => fake.writes.push({ path: ref.path, data }),
}) }));
vi.mock('../functions/node_modules/firebase-admin/lib/esm/firestore/index.js', async () => {
  const original = await import('../functions/node_modules/firebase-admin/lib/firestore/index.js');
  const ref = (path: string): object => ({ path, collection: (name: string) => ({ doc: (id: string) => ref(path + '/' + name + '/' + id) }) });
  return { ...original, getFirestore: () => ({ collection: (name: string) => ({ doc: (id: string) => ref(name + '/' + id) }) }) };
});

describe('event scoring values', () => {
  it('parses exact half-points with either decimal separator, without rounding', () => {
    for (const [text, units] of [['0', 0], ['0,5', 1], ['2.5', 5], ['2,50', 5], [' 12 ', 24], ['4503599627370495.5', Number.MAX_SAFE_INTEGER]] as const) {
      expect(parsePoints(text)).toBe(units);
      expect(parsePoints(pointsText(units))).toBe(units);
    }
    expect(scoreLabel(null)).toBe('Nezadáno');
    expect(scoreLabel(0)).toBe('0 bodů');
    for (const value of ['', ' ', '-1', '-0', '0.25', '1,75', 'NaN', 'Infinity', '1e2', '1.50000000000000001', '4503599627370496', '4503599627370495.75', '1 000']) {
      expect(() => parsePoints(value)).toThrow();
    }
  });
  it('validates the strict server contract and safe numeric ranges', () => {
    const input = { eventId: 'e', snapshotId: 's', teamId: 't', roundId: 'r', requestId: 'id', expectedRevision: 0, halfPoints: 0, reason: '' };
    expect(parseScoreRequest(input).halfPoints).toBe(0);
    expect(parseScoreRequest({ ...input, halfPoints: null, reason: ' Oprava ' }).reason).toBe('Oprava');
    for (const halfPoints of [-1, .5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '2', undefined]) expect(() => parseScoreRequest({ ...input, halfPoints })).toThrow();
    for (const expectedRevision of [-1, .5, Number.MAX_SAFE_INTEGER, Infinity]) expect(() => parseScoreRequest({ ...input, expectedRevision })).toThrow();
    for (const patch of [{ actorUid: 'spoof' }, { managementToken: 'token' }, { reason: 'x'.repeat(301) }, { reason: '\n' }, { teamId: '../other' }, { requestId: '..' }]) {
      expect(() => parseScoreRequest({ ...input, ...patch })).toThrow();
    }
  });
});

describe('atomic round scoring', () => {
  const request = () => parseRoundScoreRequest({ eventId: 'e', snapshotId: 's', roundId: 'r', requestId: 'request', scores: [
    { teamId: 'a', expectedRevision: 0, halfPoints: 0, reason: '' },
    { teamId: 'b', expectedRevision: 0, halfPoints: 5, reason: '' },
  ] });
  const authorize = vi.fn(() => Promise.resolve({ key: 'actor', audit: { actorUid: 'actor' } }));
  beforeEach(() => {
    fake.documents.clear(); fake.writes.length = 0; authorize.mockClear();
    fake.documents.set('events/e', { lifecycleStatus: 'ready', revision: 1, quizAssignment: { snapshotId: 's' }, scoring: { unitScale: 2, started: false } });
    fake.documents.set('quizSnapshots/s', {}); fake.documents.set('quizSnapshots/s/rounds/r', {});
    for (const teamId of ['a', 'b']) fake.documents.set('events/e/registrations/' + teamId, { eventId: 'e', status: 'accepted' });
  });
  it('strictly bounds and normalizes the batch while rejecting duplicate teams and forged fields', () => {
    const input = request();
    expect(parseRoundScoreRequest({ ...input, scores: [...input.scores].reverse() })).toEqual(input);
    for (const patch of [{ scores: [] }, { scores: [input.scores[0], input.scores[0]] }, { scores: Array.from({ length: 201 }, (_, i) => ({ ...input.scores[0], teamId: String(i) })) }, { scores: [{ ...input.scores[0], actorUid: 'forged' }] }, { actorUid: 'forged' }, { scores: [{ ...input.scores[0], halfPoints: .5 }] }]) expect(() => parseRoundScoreRequest({ ...input, ...patch })).toThrow();
  });
  it('commits both scores, their independent history, one receipt and scoring-start marker together', async () => {
    const response = await commitRoundScores(request(), authorize);
    expect(response.scores.map(score => [score.teamId, score.halfPoints, score.revision])).toEqual([['a', 0, 1], ['b', 5, 1]]);
    expect(fake.writes).toHaveLength(6);
    expect(fake.writes.filter(write => write.path.endsWith('/history/1'))).toHaveLength(2);
    expect(fake.writes.find(write => write.path.includes('/scoreOperations/'))?.data).toMatchObject({ response, actorUid: 'actor' });
    expect(fake.writes.find(write => write.path === 'events/e')?.data).toMatchObject({ 'scoring.started': true, revision: 2 });
  });
  it('writes nothing when any one team conflicts or is no longer accepted', async () => {
    const first = await commitRoundScores(request(), authorize);
    const written = fake.writes.find(write => write.path.endsWith('/' + first.scores[1]!.scoreId))!;
    fake.documents.set(written.path, written.data); fake.writes.length = 0;
    await expect(commitRoundScores(request(), authorize)).rejects.toMatchObject({ code: 'aborted', details: { scores: [{ teamId: 'b', revision: 1, halfPoints: 5 }] } });
    expect(fake.writes).toHaveLength(0);
    fake.documents.delete(written.path); fake.documents.set('events/e/registrations/b', { eventId: 'e', status: 'cancelled' });
    await expect(commitRoundScores(request(), authorize)).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(fake.writes).toHaveLength(0);
  });
  it('rechecks authority before receipt replay and binds the receipt to unchanged content', async () => {
    const response = await commitRoundScores(request(), authorize);
    const receipt = fake.writes.find(write => write.path.includes('/scoreOperations/'))!;
    fake.documents.set(receipt.path, receipt.data); fake.writes.length = 0;
    expect(await commitRoundScores(request(), authorize)).toEqual(response);
    expect(authorize).toHaveBeenCalledTimes(2); expect(fake.writes).toHaveLength(0);
    await expect(commitRoundScores({ ...request(), scores: [{ teamId: 'a', expectedRevision: 0, halfPoints: 8, reason: '' }] }, authorize)).rejects.toMatchObject({ code: 'already-exists' });
    await expect(commitRoundScores(request(), () => Promise.reject(new Error('revoked')))).rejects.toThrow('revoked');
  });
});
