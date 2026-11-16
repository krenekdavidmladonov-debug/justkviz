import { beforeEach, expect, it, vi } from 'vitest';
import { initialOfflineState } from '../packages/quiz-domain/src/offline-event';
import { importOfflineEvent } from '../apps/web/src/features/offline/offlinePreparation';
import { offlineManifest } from './offline-fixture';

// Isolate the verified-file and durable-storage boundaries. Real encryption and
// replay are covered by offlineFile/offlineRuntime tests; this tests replacement.
const adapter = vi.hoisted(() => ({ existing: vi.fn(), saved: vi.fn(), commit: vi.fn(), unlock: vi.fn(), replay: vi.fn(), create: vi.fn() }));
vi.mock('../apps/web/src/features/offline/offlineStore', () => ({
  withOfflineWriter: (_session: string, work: () => Promise<unknown>) => work(),
  readStoredOfflineSession: adapter.existing, commitOfflineSession: adapter.commit,
  readOfflineTrusts: () => Promise.resolve([]), prepareOfflineStorage: async () => {},
  storeOfflineRecord: async () => {}, deleteOfflineRecords: async () => {},
}));
vi.mock('../apps/web/src/features/offline/offlineFile', () => ({
  readOfflineArchiveHeader: () => Promise.resolve({ header: { salt: '', iterations: 100000, recordSizes: [] }, readRecord: () => Promise.resolve(new Blob()) }),
  unlockOfflineMetadata: adapter.unlock,
}));
vi.mock('../apps/web/src/features/offline/offlineCrypto', () => ({
  decodeBase64: () => new Uint8Array(16), deriveOfflineKey: () => Promise.resolve({}), decryptOfflineValue: adapter.saved,
}));
vi.mock('../apps/web/src/features/offline/offlineRuntime', () => ({
  replayOfflineOperations: adapter.replay, createStoredOfflineSession: adapter.create, verifyStoredOfflineMedia: async () => {},
}));
vi.mock('../apps/web/src/features/offline/offlineShell', () => ({ testOfflineShellBoot: async () => {} }));

const manifest = offlineManifest();
const state = initialOfflineState(manifest);
const saved = () => ({ state, operations: [], maxSeenMs: manifest.issuedAtMs });
beforeEach(() => {
  vi.clearAllMocks();
  adapter.unlock.mockResolvedValue({ metadata: { manifest, grant: {}, operations: [] }, key: {} });
  adapter.existing.mockResolvedValue({ sessionId: manifest.sessionId, exportId: manifest.exportId, sequence: 0, headHash: state.headHash, header: { salt: '', iterations: 100000 }, encrypted: {} });
  adapter.saved.mockResolvedValue(saved());
  adapter.replay.mockResolvedValue(state);
  adapter.create.mockResolvedValue({ sessionId: manifest.sessionId, sequence: 0 });
  adapter.commit.mockResolvedValue(undefined);
});

it('refuses restoration over a stored session awaiting synchronization confirmation', async () => {
  adapter.saved.mockResolvedValue({ ...saved(), pendingSynchronization: { headHash: state.headHash, operationCount: 0, previewDigest: 'd'.repeat(64) } });
  await expect(importOfflineEvent(new File([], 'synthetic.justkvizoffline'), 'synthetic-password', vi.fn(), true)).rejects.toThrow('synchronizace čeká na potvrzení');
  expect(adapter.create).not.toHaveBeenCalled();
  expect(adapter.commit).not.toHaveBeenCalled();
});

it('retains restoration of the same verified history when no synchronization was attempted', async () => {
  await expect(importOfflineEvent(new File([], 'synthetic.justkvizoffline'), 'synthetic-password', vi.fn(), true)).resolves.toMatchObject({ sessionId: manifest.sessionId });
  expect(adapter.commit).toHaveBeenCalledTimes(1);
});
