import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOfflineArchive } from '../apps/web/src/features/offline/offlineFile';
import { createStoredOfflineSession, openOfflineRuntime, replayOfflineOperations } from '../apps/web/src/features/offline/offlineRuntime';
import type { StoredOfflineSession } from '../apps/web/src/features/offline/offlineStore';
import { calculateOfflineResults, type OfflineCommand } from '../packages/quiz-domain/src/offline-event';
import { signedOfflineFixture } from './offline-fixture';

const storage = vi.hoisted(() => ({ acquire: vi.fn(), release: vi.fn(), read: vi.fn(), record: vi.fn(), trusts: vi.fn(), commit: vi.fn() }));
vi.mock('../apps/web/src/features/offline/offlineStore', () => ({
  acquireOfflineWriter: storage.acquire, readStoredOfflineSession: storage.read, readStoredOfflineRecord: storage.record,
  readOfflineTrusts: storage.trusts, commitOfflineSession: storage.commit,
}));

const password = 'synthetic-offline-passphrase';
let fixture: Awaited<ReturnType<typeof signedOfflineFixture>>;
let initial: StoredOfflineSession, persisted: StoredOfflineSession;
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

beforeAll(async () => {
  fixture = await signedOfflineFixture();
  const metadata = { manifest: fixture.manifest, grant: fixture.grant, operations: [] };
  const { header, key } = await createOfflineArchive(metadata, password, () => Promise.reject(new Error('No declared assets')),
    (index, record) => { records[index] = record; return Promise.resolve(); });
  initial = await createStoredOfflineSession(metadata, header, key);
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
