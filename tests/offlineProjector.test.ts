// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openOfflineProjector, type OfflineProjectorConnection } from '../apps/web/src/features/offline/offlineProjector';
import type { OfflineRuntime } from '../apps/web/src/features/offline/offlineRuntime';
import { buildOfflineProjection } from '../apps/web/src/features/offline/offlineProjection';
import { initialOfflineState } from '../packages/quiz-domain/src/offline-event';
import { offlineManifest } from './offline-fixture';

let connection: OfflineProjectorConnection;
let report: ReturnType<typeof vi.fn<(generation: number) => Promise<void>>>;
let port: MessagePort;
let runtime: OfflineRuntime;
const failed = vi.fn<(generation: number) => void>();
const manifest = offlineManifest();
const state = { ...initialOfflineState(manifest), status: 'active' as const, slidePosition: 2, mediaGeneration: 7, mediaCommand: 'play' as const };
const projection = buildOfflineProjection(manifest, state);

beforeEach(() => {
  const popup = { focus: vi.fn() } as unknown as Window;
  vi.spyOn(window, 'open').mockReturnValue(popup);
  report = vi.fn<(generation: number) => Promise<void>>().mockResolvedValue(undefined);
  failed.mockReset();
  runtime = { manifest, playBlock: null, reportMediaFinished: report, append: vi.fn().mockResolvedValue(undefined) } as unknown as OfflineRuntime;
  port = { postMessage: vi.fn(), close: vi.fn(), start: vi.fn(), onmessage: null } as unknown as MessagePort;
  connection = openOfflineProjector(runtime, () => projection, failed);
  window.dispatchEvent(new MessageEvent('message', { origin: location.origin, source: popup, data: { type: 'justkviz-offline-projector-hello-v1', sessionId: manifest.sessionId }, ports: [port] }));
});
afterEach(() => { connection.close(); vi.restoreAllMocks(); });
function finish(generation: number) {
  port.onmessage?.call(port, new MessageEvent('message', { data: { type: 'finished', mediaGeneration: generation } }));
}

it('forwards the projector completion generation to the runtime scheduler', async () => {
  finish(7);
  await Promise.resolve();
  expect(report).toHaveBeenCalledExactlyOnceWith(7);
});

it('ignores an obsolete generation and reports nothing after closing the connection', () => {
  finish(6);
  connection.close();
  finish(7);
  expect(report).not.toHaveBeenCalled();
});

it('exposes a current completion persistence failure to the operator', async () => {
  report.mockRejectedValue(new Error('Synthetic disk failure'));
  finish(7);
  await Promise.resolve();
  expect(failed).toHaveBeenCalledExactlyOnceWith(7);
});

it('does not publish a late completion error after its connection closes', async () => {
  let reject!: (error: Error) => void;
  report.mockReturnValue(new Promise((_done, fail) => { reject = fail; }));
  finish(7);
  connection.close();
  reject(new Error('Old disk failure'));
  await Promise.resolve();
  expect(failed).not.toHaveBeenCalled();
});

it('does not publish a late completion error after a sync receipt is saved', async () => {
  let reject!: (error: Error) => void;
  report.mockReturnValue(new Promise((_done, fail) => { reject = fail; }));
  finish(7);
  Object.defineProperty(runtime, 'syncedReceipt', { value: { receiptId: 'synthetic-receipt' } });
  reject(new Error('Old disk failure'));
  await Promise.resolve();
  expect(failed).not.toHaveBeenCalled();
});
