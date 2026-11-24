import { EventEmitter } from 'node:events';
import { beforeEach, expect, test, vi } from 'vitest';
import { isCallableWarmup, isWarmupPing } from '../functions/src/warmup/ping';

const io = vi.hoisted(() => vi.fn(() => { throw new Error('Unexpected Auth/database IO'); }));
vi.mock('../functions/node_modules/firebase-admin/lib/esm/firestore/index.js', async () => ({
  Timestamp: (await import('firebase/firestore')).Timestamp,
  getFirestore: () => ({ doc: io, collection: io, runTransaction: io }),
}));
vi.mock('../functions/node_modules/firebase-admin/lib/esm/auth/index.js', () => ({ getAuth: io }));

const leaderboard = await import('../functions/src/leaderboard/callables');
const live = await import('../functions/src/live/callables');
const scoring = await import('../functions/src/scoring/callables');
const referee = await import('../functions/src/referee/callables');
const { securedOnCall } = await import('../functions/src/access/authorization');
const { generatePrintArtifact } = await import('../functions/src/print/endpoint');
const targets = [leaderboard.createEventLiveSession, leaderboard.previewInterimResults, live.revealAnswer, scoring.saveEventScore, referee.readRefereeEvent];
beforeEach(() => { io.mockClear(); });

test('all five real callable handlers return only the constant ping without identity or data IO', async () => {
  for (const target of targets) {
    await expect(target.run({ data: { warmup: true } } as Parameters<typeof target.run>[0])).resolves.toEqual({ warmup: true });
    expect(target.__endpoint.minInstances).not.toBeTypeOf('number');
  }
  expect(io).not.toHaveBeenCalled();
});

test.each([null, undefined, [], true, 'warmup', {}, { warmup: false }, { warmup: 'true' }, { warmup: 1 },
  { warmup: true, eventId: 'synthetic' }, Object.create({ warmup: true }) as unknown,
  Object.setPrototypeOf({ warmup: true }, { eventId: 'inherited' }) as unknown, { warmup: true, action: 'reveal' }, { warmup: true, scores: [] }])('malformed or mixed ping %j never bypasses ordinary handlers', async data => {
  expect(isWarmupPing(data)).toBe(false);
  for (const target of targets) {
    await expect(target.run({ data } as Parameters<typeof target.run>[0])).rejects.toBeDefined();
  }
  expect(io).not.toHaveBeenCalled();
});

test('the shared wrapper exposes a ping only for its four explicit operation names', async () => {
  const handler = vi.fn();
  const other = securedOnCall('deleteEvent', { region: 'europe-west1' }, handler);
  await expect(other.run({ data: { warmup: true } } as Parameters<typeof other.run>[0])).rejects.toMatchObject({ code: 'unauthenticated' });
  expect(isCallableWarmup('readRefereeEvent', { warmup: true })).toBe(false);
  expect(isCallableWarmup('generatePrintArtifact', { warmup: true })).toBe(false);
  expect(handler).not.toHaveBeenCalled(); expect(io).not.toHaveBeenCalled();
});

async function printRequest(body: unknown, method = 'POST', contentType = 'application/json') {
  const response = new EventEmitter() as EventEmitter & {
    setHeader: ReturnType<typeof vi.fn>; getHeader: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>; status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn>;
  };
  response.setHeader = vi.fn(); response.getHeader = vi.fn();
  response.set = vi.fn(() => response); response.status = vi.fn(() => response);
  response.json = vi.fn(() => { response.emit('finish'); return response; });
  response.end = vi.fn(() => { response.emit('finish'); return response; });
  const request = { method, headers: {}, body, rawBody: Buffer.from(JSON.stringify(body)), is: () => contentType === 'application/json' };
  await generatePrintArtifact(request as unknown as Parameters<typeof generatePrintArtifact>[0], response as unknown as Parameters<typeof generatePrintArtifact>[1]);
  return response;
}
test('real print handler returns a noncached JSON ping before identity, event, roster or PDF IO', async () => {
  const response = await printRequest({ warmup: true });
  expect(response.status).toHaveBeenCalledWith(200);
  expect(response.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
  expect(response.json).toHaveBeenCalledWith({ warmup: true });
  expect(io).not.toHaveBeenCalled();
  expect(generatePrintArtifact.__endpoint.minInstances).not.toBeTypeOf('number');
});
test('print ping retains POST, JSON and exact-body requirements', async () => {
  expect((await printRequest({ warmup: true }, 'GET')).status).toHaveBeenCalledWith(405);
  expect((await printRequest({ warmup: true }, 'POST', 'text/plain')).status).toHaveBeenCalledWith(415);
  expect((await printRequest({ warmup: true, options: {} })).status).toHaveBeenCalledWith(400);
  expect(io).not.toHaveBeenCalled();
});
