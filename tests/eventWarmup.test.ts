import { afterEach, beforeEach, expect, test, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ invoke: vi.fn<(name: string, data: unknown, options: unknown) => Promise<{ data: unknown }>>(), fetch: vi.fn<typeof fetch>() }));
vi.mock('firebase/functions', () => ({ httpsCallable: (_functions: unknown, name: string, options: unknown) => (data: unknown) => fixture.invoke(name, data, options) }));
vi.mock('../apps/web/src/services/firebase/client', () => ({ getFirebaseServices: () => ({ functions: {} }) }));
vi.mock('../apps/web/src/services/firebase/app', () => ({ getFirebaseAppContext: () => ({ config: { useEmulators: true, options: { projectId: 'demo-justkviz-warmup' } } }) }));
beforeEach(() => {
  vi.resetModules();
  fixture.invoke.mockReset().mockResolvedValue({ data: { warmup: true } });
  fixture.fetch.mockReset().mockImplementation(() => Promise.resolve(new Response('{"warmup":true}', { status: 200 })));
  vi.stubGlobal('fetch', fixture.fetch);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
test('warms exactly six services with no event, revision, answer or referee capability', async () => {
  vi.stubEnv('VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT', '5301');
  const { warmEventFunctions } = await import('../apps/web/src/features/events/eventWarmup');
  const result = await warmEventFunctions();
  expect(result.ready).toHaveLength(6); expect(result.failed).toEqual([]);
  expect(fixture.invoke.mock.calls.map(call => call[0])).toEqual(['createEventLiveSession', 'previewInterimResults', 'readRefereeEvent', 'revealAnswer', 'saveEventScore']);
  for (const call of fixture.invoke.mock.calls) expect(call.slice(1)).toEqual([{ warmup: true }, { timeout: 15000 }]);
  expect(fixture.fetch.mock.calls[0]?.[0]).toBe('http://127.0.0.1:5301/demo-justkviz-warmup/europe-west1/generatePrintArtifact');
  expect(fixture.fetch.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', body: '{"warmup":true}', cache: 'no-store', headers: { 'Content-Type': 'application/json' } });
  expect(fixture.fetch.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
});
test('partial failures settle without blocking another service or pretending everything is ready', async () => {
  fixture.invoke.mockImplementation((name: string) => {
    if (name === 'saveEventScore') return Promise.reject(new Error('Synthetic network failure'));
    return Promise.resolve({ data: name === 'revealAnswer' ? { warmup: true, private: 'must reject unexpected payload' } : { warmup: true } });
  });
  fixture.fetch.mockImplementation(() => Promise.resolve(new Response('', { status: 503 })));
  const { warmEventFunctions } = await import('../apps/web/src/features/events/eventWarmup');
  const result = await warmEventFunctions();
  expect(result.failed).toEqual(['revealAnswer', 'saveEventScore', 'generatePrintArtifact']);
  expect(result.ready).toEqual(['createEventLiveSession', 'previewInterimResults', 'readRefereeEvent']);
});
test('automatic moderation warmup is once per page lifetime while the button can explicitly retry', async () => {
  const { warmEventFunctions, warmEventFunctionsOnce } = await import('../apps/web/src/features/events/eventWarmup');
  const first = warmEventFunctionsOnce(), second = warmEventFunctionsOnce();
  expect(first).toBe(second);
  await first; await warmEventFunctionsOnce();
  expect(fixture.invoke).toHaveBeenCalledTimes(5); expect(fixture.fetch).toHaveBeenCalledTimes(1);
  await warmEventFunctions();
  expect(fixture.invoke).toHaveBeenCalledTimes(10); expect(fixture.fetch).toHaveBeenCalledTimes(2);
});
