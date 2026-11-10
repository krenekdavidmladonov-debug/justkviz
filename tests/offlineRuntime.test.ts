import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOfflineArchive } from '../apps/web/src/features/offline/offlineFile';
import { createStoredOfflineSession, openOfflineRuntime, replayOfflineOperations } from '../apps/web/src/features/offline/offlineRuntime';
import type { StoredOfflineSession } from '../apps/web/src/features/offline/offlineStore';
import { calculateOfflineResults, type OfflineCommand } from '../packages/quiz-domain/src/offline-event';
import { signedOfflineFixture } from './offline-fixture';
import { decryptOfflineValue, encryptOfflineValue } from '../apps/web/src/features/offline/offlineCrypto';
import type { OfflineSynchronizationRequest } from '../apps/web/src/features/offline/offlineRuntime';

const storage = vi.hoisted(() => ({ acquire: vi.fn(), release: vi.fn(), read: vi.fn(), record: vi.fn(), trusts: vi.fn(), commit: vi.fn() }));
vi.mock('../apps/web/src/features/offline/offlineStore', () => ({
  acquireOfflineWriter: storage.acquire, readStoredOfflineSession: storage.read, readStoredOfflineRecord: storage.record,
  readOfflineTrusts: storage.trusts, commitOfflineSession: storage.commit,
}));

const password = 'synthetic-offline-passphrase';
let fixture: Awaited<ReturnType<typeof signedOfflineFixture>>;
let initial: StoredOfflineSession, persisted: StoredOfflineSession;
let archiveKey: CryptoKey;
const records: Blob[] = [];
const runtimes: Awaited<ReturnType<typeof openOfflineRuntime>>[] = [];
const open = async (changed = vi.fn()) => {
  const runtime = await openOfflineRuntime(fixture.manifest.sessionId, password, changed);
  runtimes.push(runtime); return runtime;
};
const receiptFor = (runtime: Awaited<ReturnType<typeof open>>) => ({
  exportId: fixture.manifest.exportId, sessionId: fixture.manifest.sessionId,
  headHash: runtime.state.headHash, operationCount: runtime.operations.length,
  receiptId: 'synthetic-committed-receipt', replayed: false, rows: [],
});
const syncRequest: OfflineSynchronizationRequest = { previewDigest: 'a'.repeat(64), completeRecovery: true,
  resolutions: [{ teamId: 'team-1', roundId: 'round-1', choice: 'offline', reason: 'Testovací oprava' }] };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const persistedProgress = () => decryptOfflineValue(archiveKey, persisted.encrypted, `offline-state:${persisted.sessionId}:${persisted.sequence}:${persisted.headHash}`);

beforeAll(async () => {
  fixture = await signedOfflineFixture();
  const metadata = { manifest: fixture.manifest, grant: fixture.grant, operations: [] };
  const { header, key } = await createOfflineArchive(metadata, password, () => Promise.reject(new Error('No declared assets')),
    (index, record) => { records[index] = record; return Promise.resolve(); });
  initial = await createStoredOfflineSession(metadata, header, key);
  archiveKey = key;
});
beforeEach(() => {
  vi.clearAllMocks(); persisted = structuredClone(initial);
  storage.acquire.mockResolvedValue(storage.release); storage.read.mockImplementation(() => Promise.resolve(persisted));
  storage.record.mockImplementation((_session: string, index: number) => Promise.resolve(records[index]));
  storage.trusts.mockResolvedValue([fixture.trust]);
  storage.commit.mockImplementation((value: StoredOfflineSession) => { persisted = value; return Promise.resolve(); });
});
afterEach(() => { for (const runtime of runtimes.splice(0)) runtime.close(); vi.restoreAllMocks(); });

describe('offline runtime commit boundary (storage adapter isolated; real browser durability tested separately)', () => {
  it('fences journal mutations from dispatch until the server receipt is saved', async () => {
    const runtime = await open(); await runtime.append({ type: 'start', payload: {} });
    const receipt = receiptFor(runtime);
    let respond!: (value: typeof receipt) => void;
    const send = vi.fn(() => new Promise<typeof receipt>(resolve => { respond = resolve; }));
    const synchronization = runtime.synchronize(syncRequest, send);
    const outcome = synchronization.catch((error: unknown) => error);
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    try {
      await expect(runtime.append({ type: 'navigate', payload: { position: 2 } })).rejects.toThrow();
      expect(await persistedProgress()).toMatchObject({ pendingSynchronization: { ...syncRequest, headHash: receipt.headHash, operationCount: 1 } });
      expect(runtime.playBlock).toContain('Synchronizace');
      await expect(runtime.synchronize(syncRequest, send)).rejects.toThrow();
      expect(send).toHaveBeenCalledTimes(1);
    } finally { respond(receipt); await outcome; }
    expect(runtime.syncedReceipt).toEqual(receipt);
    expect(runtime.pendingSynchronization).toBeUndefined();
  });

  it('acknowledges the new state only after durable adapter confirmation and rejects overlapping commands', async () => {
    const changed = vi.fn(), runtime = await open(changed);
    let release!: () => void;
    storage.commit.mockImplementation((value: StoredOfflineSession) => new Promise<void>(resolve => {
      release = () => { persisted = value; resolve(); };
    }));
    const pending = runtime.append({ type: 'start', payload: {} });
    await vi.waitFor(() => expect(storage.commit).toHaveBeenCalledOnce());
    expect(runtime.state.sequence).toBe(0); expect(runtime.operations).toHaveLength(0); expect(changed).not.toHaveBeenCalled();
    await expect(runtime.append({ type: 'start', payload: {} })).rejects.toThrow();
    release(); await pending;
    expect(runtime.state).toMatchObject({ sequence: 1, status: 'active' });
    expect(runtime.operations).toHaveLength(1); expect(changed).toHaveBeenCalledOnce();
    expect(storage.commit.mock.calls[0]![1]).toBe(0);
  });

  it('does not dispatch synchronization unless the marker is durably saved', async () => {
    const runtime = await open(); await runtime.append({ type: 'start', payload: {} });
    const submit = vi.fn().mockResolvedValue(receiptFor(runtime));
    storage.commit.mockRejectedValueOnce(new Error('Marker disk failure'));
    await expect(runtime.synchronize(syncRequest, submit)).rejects.toThrow('Marker disk failure');
    expect(submit).not.toHaveBeenCalled();
    expect(runtime.pendingSynchronization).toBeUndefined();
    expect(await persistedProgress()).not.toHaveProperty('pendingSynchronization');
    await runtime.append({ type: 'navigate', payload: { position: 2 } });
  });

  it('reopens a lost-response marker and retries only the exact copied request and journal', async () => {
    const runtime = await open(); await runtime.append({ type: 'start', payload: {} });
    const journal = structuredClone(runtime.operations), receipt = receiptFor(runtime);
    const request = structuredClone(syncRequest);
    await expect(runtime.synchronize(request, vi.fn().mockRejectedValue(new Error('Lost response')))).rejects.toThrow('Lost response');
    (request.resolutions![0] as { reason: string }).reason = 'Changed caller request';
    const exposed = runtime.pendingSynchronization!;
    (exposed as { previewDigest: string }).previewDigest = 'b'.repeat(64);
    (exposed.resolutions![0] as { reason: string }).reason = 'Changed exposed decision';
    expect(runtime.pendingSynchronization).toMatchObject(syncRequest);
    runtime.close(); const restored = await open();
    expect(restored.pendingSynchronization).toMatchObject(syncRequest);
    await expect(restored.append({ type: 'navigate', payload: { position: 2 } })).rejects.toThrow();
    const retry = vi.fn().mockResolvedValue({ ...receipt, replayed: true });
    await expect(restored.synchronize({ ...syncRequest, previewDigest: 'b'.repeat(64) }, retry)).rejects.toThrow('přesně');
    expect(retry).not.toHaveBeenCalled();
    await expect(restored.synchronize(syncRequest, retry)).resolves.toMatchObject({ replayed: true });
    expect(retry).toHaveBeenCalledExactlyOnceWith(journal, syncRequest);
    expect(await persistedProgress()).not.toHaveProperty('pendingSynchronization');
    restored.close(); expect((await open()).syncedReceipt).toMatchObject({ replayed: true });
  });

  it('retains the fence after local receipt storage fails and recovers with the replayed receipt', async () => {
    const runtime = await open(); await runtime.append({ type: 'start', payload: {} });
    const receipt = receiptFor(runtime);
    storage.commit.mockImplementationOnce((value: StoredOfflineSession) => { persisted = value; return Promise.resolve(); })
      .mockRejectedValueOnce(Object.assign(new Error('Receipt disk failure'), { code: 'functions/aborted' }));
    await expect(runtime.synchronize(syncRequest, vi.fn().mockResolvedValue(receipt))).rejects.toThrow('Receipt disk failure');
    expect(runtime.syncedReceipt).toBeUndefined();
    expect(await persistedProgress()).toHaveProperty('pendingSynchronization');
    await expect(runtime.append({ type: 'navigate', payload: { position: 2 } })).rejects.toThrow();
    runtime.close(); const restored = await open();
    await restored.synchronize(syncRequest, vi.fn().mockResolvedValue({ ...receipt, replayed: true }));
    expect(restored.pendingSynchronization).toBeUndefined();
    expect(restored.syncedReceipt).toMatchObject({ replayed: true });
  });

  it('retries optional undefined UI fields after their encrypted JSON roundtrip omits them', async () => {
    const runtime = await open(); await runtime.append({ type: 'start', payload: {} });
    const request = { previewDigest: syncRequest.previewDigest, resolutions: undefined, completeRecovery: undefined };
    await expect(runtime.synchronize(request, vi.fn().mockRejectedValue(new Error('Lost response')))).rejects.toThrow('Lost response');
    runtime.close(); const restored = await open();
    expect(restored.pendingSynchronization).not.toHaveProperty('resolutions');
    expect(restored.pendingSynchronization).not.toHaveProperty('completeRecovery');
    await restored.synchronize(request, vi.fn().mockResolvedValue({ ...receiptFor(restored), replayed: true }));
    expect(restored.syncedReceipt).toMatchObject({ replayed: true });
  });

  it('keeps writer ownership and saves a valid receipt when closed during submission', async () => {
    const changed = vi.fn(), runtime = await open(changed); await runtime.append({ type: 'start', payload: {} });
    const receipt = receiptFor(runtime), response = deferred<typeof receipt>();
    const submit = vi.fn(() => response.promise);
    const pending = runtime.synchronize(syncRequest, submit);
    await vi.waitFor(() => expect(submit).toHaveBeenCalledOnce());
    const notifications = changed.mock.calls.length;
    runtime.close();
    expect(storage.release).not.toHaveBeenCalled();
    await expect(runtime.append({ type: 'navigate', payload: { position: 2 } })).rejects.toThrow();
    response.resolve(receipt); await pending;
    expect(storage.release).toHaveBeenCalledOnce();
    expect(changed).toHaveBeenCalledTimes(notifications);
    expect((await open()).syncedReceipt).toEqual(receipt);
  });

  it('does not dispatch after close while saving the initial marker, and retains it for retry', async () => {
    const runtime = await open(); await runtime.append({ type: 'start', payload: {} });
    const saved = deferred<void>();
    storage.commit.mockImplementationOnce(async (value: StoredOfflineSession) => { await saved.promise; persisted = value; });
    const submit = vi.fn().mockResolvedValue(receiptFor(runtime));
    const pending = runtime.synchronize(syncRequest, submit);
    const outcome = expect(pending).rejects.toThrow('zamčená');
    await vi.waitFor(() => expect(storage.commit).toHaveBeenCalledTimes(2));
    runtime.close(); expect(storage.release).not.toHaveBeenCalled();
    saved.resolve(); await outcome;
    expect(submit).not.toHaveBeenCalled(); expect(storage.release).toHaveBeenCalledOnce();
    expect((await open()).pendingSynchronization).toMatchObject(syncRequest);
  });

  it('keeps the marker on an invalid server receipt and refuses legacy receipt bypass', async () => {
    const runtime = await open(); await runtime.append({ type: 'start', payload: {} });
    await expect(runtime.synchronize(syncRequest, vi.fn().mockResolvedValue({ ...receiptFor(runtime), headHash: 'f'.repeat(64) }))).rejects.toThrow('potvrzení');
    expect(runtime.pendingSynchronization).toMatchObject(syncRequest);
    await expect(runtime.markSynced(receiptFor(runtime))).rejects.toThrow();
    expect(await persistedProgress()).toHaveProperty('pendingSynchronization');
  });

  it('clears a first-attempt aborted marker durably so a fresh comparison can succeed', async () => {
    const runtime = await open(); await runtime.append({ type: 'start', payload: {} });
    const aborted = Object.assign(new Error('Stale preview'), { code: 'functions/aborted' });
    await expect(runtime.synchronize(syncRequest, vi.fn().mockRejectedValue(aborted))).rejects.toBe(aborted);
    expect(runtime.pendingSynchronization).toBeUndefined();
    expect(await persistedProgress()).not.toHaveProperty('pendingSynchronization');
    await runtime.append({ type: 'navigate', payload: { position: 2 } });
    await runtime.synchronize({ previewDigest: 'b'.repeat(64) }, vi.fn().mockResolvedValue(receiptFor(runtime)));
    expect(runtime.syncedReceipt).toBeDefined();
  });

  it('stays fenced when clearing a first-attempt aborted marker cannot be durably confirmed', async () => {
    const runtime = await open(); await runtime.append({ type: 'start', payload: {} });
    storage.commit.mockImplementationOnce((value: StoredOfflineSession) => { persisted = value; return Promise.resolve(); })
      .mockRejectedValueOnce(new Error('Marker clear disk failure'));
    await expect(runtime.synchronize(syncRequest, vi.fn().mockRejectedValue({ code: 'functions/aborted' }))).rejects.toThrow('Marker clear disk failure');
    expect(runtime.pendingSynchronization).toMatchObject(syncRequest);
    expect(await persistedProgress()).toHaveProperty('pendingSynchronization');
  });

  it('retains an ambiguous prior attempt even when its retry is aborted before a new commit', async () => {
    const runtime = await open(); await runtime.append({ type: 'start', payload: {} });
    await expect(runtime.synchronize(syncRequest, vi.fn().mockRejectedValue(new Error('Timeout')))).rejects.toThrow('Timeout');
    runtime.close(); const restored = await open();
    const commits = storage.commit.mock.calls.length;
    await expect(restored.synchronize(syncRequest, vi.fn().mockRejectedValue({ code: 'functions/aborted' }))).rejects.toMatchObject({ code: 'functions/aborted' });
    expect(restored.pendingSynchronization).toMatchObject(syncRequest);
    expect(storage.commit).toHaveBeenCalledTimes(commits);
  });

  it.each([
    { previewDigest: 'invalid' }, { headHash: 'f'.repeat(64) }, { operationCount: 99 },
    { completeRecovery: 'true' }, { unexpected: true }, { resolutions: [{ teamId: 'team-1' }] },
    { resolutions: [{ teamId: 'team-1', roundId: 'round-1', choice: ['online'], reason: '' }] },
  ])('rejects malformed encrypted synchronization marker %j on reopen', async patch => {
    const runtime = await open(); await runtime.append({ type: 'start', payload: {} }); runtime.close();
    storage.release.mockClear();
    const progress = await persistedProgress() as Record<string, unknown>;
    const marker = { ...syncRequest, headHash: persisted.headHash, operationCount: persisted.sequence, ...patch };
    persisted = { ...persisted, encrypted: await encryptOfflineValue(archiveKey, { ...progress, pendingSynchronization: marker }, `offline-state:${persisted.sessionId}:${persisted.sequence}:${persisted.headHash}`) };
    await expect(open()).rejects.toThrow();
    expect(storage.release).toHaveBeenCalledOnce();
  });

  it('keeps accepted state and journal unchanged after a failed quota/disk transaction', async () => {
    const changed = vi.fn(), runtime = await open(changed), before = structuredClone(runtime.state);
    storage.commit.mockRejectedValue(new DOMException('Synthetic quota exhausted', 'QuotaExceededError'));
    await expect(runtime.append({ type: 'start', payload: {} })).rejects.toThrow();
    expect(runtime.state).toEqual(before); expect(runtime.operations).toEqual([]); expect(changed).not.toHaveBeenCalled();
    expect(persisted.sequence).toBe(0);
    runtime.close(); const restored = await open();
    expect(restored.state).toEqual(before); expect(restored.operations).toEqual([]);
  });

  it('reopens exact encrypted progress and hash chain, then completes ten shared winners without duplicate cells', async () => {
    const runtime = await open(); await runtime.append({ type: 'start', payload: {} });
    const round = (number: number): OfflineCommand => ({ type: 'round-scores', payload: {
      roundId: `round-${number}`, changes: fixture.manifest.teams.map((team, index) => ({
        teamId: team.id, expectedRevision: 0, halfPoints: 2 * (number === 1 ? index + 1 : 10 - index), reason: '',
      })),
    } });
    await runtime.append(round(1)); await runtime.append({ type: 'navigate', payload: { position: 2 } });
    await runtime.append({ type: 'reveal', payload: { position: 2 } });
    const checkpoint = structuredClone(runtime.state), journal = structuredClone(runtime.operations);
    runtime.close(); const restored = await open();
    expect(restored.state).toEqual(checkpoint); expect(restored.operations).toEqual(journal);
    await restored.append(round(2));
    const result = calculateOfflineResults(restored.manifest, restored.state.scores, 'round-2');
    expect(result.complete).toBe(true); expect(result.rows).toHaveLength(10);
    expect(result.rows.every(row => row.rank === 1 && row.halfPoints === 22)).toBe(true);
    expect(restored.state.scores).toHaveLength(20);
    expect(await replayOfflineOperations(restored.manifest, restored.operations)).toEqual(restored.state);
  });

  it('rejects corrupted encrypted progress and releases writer ownership on failed open', async () => {
    const bytes = new Uint8Array(persisted.encrypted.bytes.slice(0)); bytes[0] = bytes[0]! ^ 1;
    persisted = { ...persisted, encrypted: { ...persisted.encrypted, bytes: bytes.buffer } };
    await expect(open()).rejects.toThrow(); expect(storage.release).toHaveBeenCalledOnce();
  });

  it('rejects an altered journal payload even when its outer operation remains well-shaped', async () => {
    const runtime = await open(); await runtime.append({ type: 'start', payload: {} });
    await runtime.append({ type: 'navigate', payload: { position: 2 } });
    const tampered = runtime.operations.map((op, index) => index === 1 ? { ...op, payload: { position: 4 } } : op);
    await expect(replayOfflineOperations(runtime.manifest, tampered)).rejects.toThrow();
    await expect(replayOfflineOperations(runtime.manifest, [...runtime.operations].reverse())).rejects.toThrow();
  });

  it('preserves recovery reads while refusing expired grants and persisted-clock rollback mutations', async () => {
    const runtime = await open();
    vi.spyOn(Date, 'now').mockReturnValue(fixture.manifest.issuedAtMs + 10 * 60 * 1000);
    await runtime.append({ type: 'start', payload: {} }); runtime.close();
    vi.mocked(Date.now).mockReturnValue(fixture.manifest.issuedAtMs + 60 * 1000);
    const rollback = await open(); const before = structuredClone(rollback.state);
    await expect(rollback.append({ type: 'navigate', payload: { position: 2 } })).rejects.toThrow();
    expect(rollback.state).toEqual(before);
    vi.mocked(Date.now).mockReturnValue(fixture.manifest.expiresAtMs + 1);
    await expect(rollback.append({ type: 'navigate', payload: { position: 2 } })).rejects.toThrow();
  });

  it('retains one sync receipt across reopen and blocks further journal mutations', async () => {
    const runtime = await open(); await runtime.append({ type: 'start', payload: {} });
    const receipt = receiptFor(runtime);
    await runtime.markSynced(receipt); runtime.close(); const restored = await open();
    expect(restored.syncedReceipt).toEqual(receipt);
    const count = storage.commit.mock.calls.length;
    await expect(restored.append({ type: 'navigate', payload: { position: 2 } })).rejects.toThrow();
    expect(storage.commit).toHaveBeenCalledTimes(count);
  });

  it('fences journal writes while the sync receipt is awaiting durable confirmation', async () => {
    const runtime = await open(); await runtime.append({ type: 'start', payload: {} });
    let release!: () => void;
    storage.commit.mockClear().mockImplementation((value: StoredOfflineSession) => { persisted = value; return Promise.resolve(); })
      .mockImplementationOnce((value: StoredOfflineSession) => new Promise<void>(resolve => {
      release = () => { persisted = value; resolve(); };
    }));
    const pending = runtime.markSynced(receiptFor(runtime));
    await vi.waitFor(() => expect(storage.commit).toHaveBeenCalledOnce());
    try {
      await expect(runtime.append({ type: 'navigate', payload: { position: 2 } })).rejects.toThrow();
      expect(storage.commit).toHaveBeenCalledOnce();
    } finally { release(); await pending; }
  });

  it('rejects a receipt bound to a different journal head or export before any durable mutation', async () => {
    const runtime = await open(); await runtime.append({ type: 'start', payload: {} });
    const count = storage.commit.mock.calls.length;
    for (const patch of [{ headHash: 'f'.repeat(64) }, { exportId: 'foreign-export' }, { operationCount: runtime.operations.length + 1 }]) {
      await expect(runtime.markSynced({ ...receiptFor(runtime), ...patch })).rejects.toThrow();
    }
    expect(runtime.syncedReceipt).toBeUndefined(); expect(storage.commit).toHaveBeenCalledTimes(count);
  });

  it('does not acknowledge an unreplayable operation after reopening expired data and a small clock rollback', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(fixture.manifest.expiresAtMs + 30_000);
    const changed = vi.fn(), runtime = await open(changed), before = structuredClone(runtime.state);
    vi.mocked(Date.now).mockReturnValue(fixture.manifest.expiresAtMs - 30_000);
    await expect(runtime.append({ type: 'start', payload: {} })).rejects.toThrow();
    expect(runtime.state).toEqual(before); expect(runtime.operations).toEqual([]);
    expect(storage.commit).not.toHaveBeenCalled(); expect(changed).not.toHaveBeenCalled();
  });

  it('retains the captured operation time when the clock rolls back during the actual awaited SHA digest', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(fixture.manifest.issuedAtMs + 60_000);
    const runtime = await open();
    const captured = fixture.manifest.issuedAtMs + 6 * 60_000;
    vi.mocked(Date.now).mockReturnValue(captured);
    const actualDigest = crypto.subtle.digest.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(async (algorithm, bytes) => {
      const result = await actualDigest(algorithm, bytes);
      vi.mocked(Date.now).mockReturnValue(captured - 30_000);
      return result;
    });
    await runtime.append({ type: 'start', payload: {} });
    expect(runtime.operations[0]!.observedAtMs).toBe(captured);
    const accepted = structuredClone(runtime.state), operations = structuredClone(runtime.operations);
    runtime.close();
    const restored = await open();
    expect(restored.state).toEqual(accepted); expect(restored.operations).toEqual(operations);
    expect(restored.state.headHash).toBe(accepted.headHash);
  });
});
