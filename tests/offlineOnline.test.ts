import { beforeEach, expect, it, vi } from 'vitest';
import type { OfflineOperation, OfflineSyncResolution } from '../packages/quiz-domain/src/index';
import { commitOfflineSynchronization, previewOfflineSynchronization } from '../apps/web/src/features/offline/offlineOnline';

const sdk = vi.hoisted(() => ({ ready: vi.fn<() => Promise<void>>(), invoke: vi.fn<(name: string, input: unknown) => Promise<{ data: unknown }>>() }));
vi.mock('firebase/functions', () => ({ httpsCallable: (_service: unknown, name: string) => (input: unknown) => sdk.invoke(name, structuredClone(input)) }));
vi.mock('../apps/web/src/services/firebase/client', () => ({ getFirebaseServices: () => ({ functions: {} }) }));
vi.mock('../apps/web/src/services/firebase/auth', () => ({ getFirebaseAuth: () => ({ authStateReady: sdk.ready, currentUser: { uid: 'synthetic-actor' } }) }));
vi.mock('../apps/web/src/features/offline/offlineAvailability', () => ({ currentOfflineMode: () => 'demo' }));

const operation = (sequence: number): OfflineOperation => ({
  type: 'start', payload: {}, operationId: `synthetic-operation-${sequence}`, sequence,
  previousHash: '0'.repeat(64), observedAtMs: 1, hash: String(sequence).repeat(64),
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => { sdk.ready.mockReset().mockResolvedValue(undefined); sdk.invoke.mockReset(); });

it.each(['preview', 'commit'] as const)('captures %s journal and decisions before asynchronous authentication', async kind => {
  const ready = deferred<void>();
  sdk.ready.mockReturnValueOnce(ready.promise);
  const operations = [operation(1)];
  const resolutions: OfflineSyncResolution[] = [{ teamId: 'team-1', roundId: 'round-1', choice: 'offline', reason: 'Původní rozhodnutí' }];
  sdk.invoke.mockResolvedValue({ data: { exportId: 'export', sessionId: 'session', receiptId: 'receipt', replayed: false, operationCount: 1, headHash: operations[0]!.hash } });
  const pending = kind === 'commit'
    ? commitOfflineSynchronization('event', 'export', operations, 'preview', resolutions, true)
    : previewOfflineSynchronization('event', 'export', operations, resolutions, true);
  operations.push(operation(2));
  resolutions[0] = { ...resolutions[0]!, choice: 'online', reason: 'Pozdější rozhodnutí' };
  ready.resolve();
  await pending;
  expect(sdk.invoke).toHaveBeenCalledWith(kind === 'commit' ? 'commitOfflineSync' : 'previewOfflineSync', expect.objectContaining({
    operations: [operation(1)],
    resolutions: [{ teamId: 'team-1', roundId: 'round-1', choice: 'offline', reason: 'Původní rozhodnutí' }],
    completeRecovery: true,
  }));
});

it('validates a delayed receipt against the journal actually sent to the server', async () => {
  const response = deferred<{ data: unknown }>();
  sdk.invoke.mockReturnValue(response.promise);
  const operations = [operation(1)];
  const pending = commitOfflineSynchronization('event', 'export', operations, 'preview');
  const verified = expect(pending).resolves.toMatchObject({ receiptId: 'receipt', headHash: operation(1).hash });
  await vi.waitFor(() => expect(sdk.invoke).toHaveBeenCalledOnce());
  operations.push(operation(2));
  response.resolve({ data: { exportId: 'export', sessionId: 'session', receiptId: 'receipt', replayed: true, operationCount: 1, headHash: operation(1).hash } });
  await verified;
});
