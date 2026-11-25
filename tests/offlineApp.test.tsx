// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OfflineApp } from '../apps/web/src/features/offline/OfflineApp';
import { checkOfflineShell, installOfflineShell, testOfflineShellBoot } from '../apps/web/src/features/offline/offlineShell';
import { listOfflineSessions } from '../apps/web/src/features/offline/offlineStore';
import { openOfflineRuntime, type OfflineRuntime } from '../apps/web/src/features/offline/offlineRuntime';
import { commitOfflineSynchronization } from '../apps/web/src/features/offline/offlineOnline';
import { initialOfflineState, reduceOfflineCommand, type OfflineCommand } from '../packages/quiz-domain/src/offline-event';
import { offlineManifest } from './offline-fixture';

const playback = vi.hoisted(() => ({ finishedGeneration: undefined as number | undefined }));

vi.mock('../apps/web/src/features/offline/offlineShell', () => ({
  checkOfflineShell: vi.fn(), installOfflineShell: vi.fn(), testOfflineShellBoot: vi.fn(), proveOfflineShellBoot: vi.fn(),
}));
vi.mock('../apps/web/src/features/offline/offlineStore', () => ({ listOfflineSessions: vi.fn(), verifyStoredOfflineStorage: vi.fn() }));
vi.mock('../apps/web/src/features/offline/offlinePreparation', () => ({ exportOfflineRecovery: vi.fn(), exportStoredOfflineEvent: vi.fn(), importOfflineEvent: vi.fn() }));
vi.mock('../apps/web/src/features/offline/offlineRuntime', () => ({ openOfflineRuntime: vi.fn() }));
vi.mock('../apps/web/src/features/offline/OfflinePreparationWizard', () => ({ OfflinePreparationWizard: () => null }));
vi.mock('../apps/web/src/features/offline/offlineOnline', () => ({ commitOfflineSynchronization: vi.fn() }));
vi.mock('../apps/web/src/features/presentation/MediaPlayer', () => ({ MediaPlayer: ({ generation, onFinished }: { generation: number; onFinished: (generation: number) => void }) =>
  <button onClick={() => onFinished(playback.finishedGeneration ?? generation)}>Dokončit syntetickou ukázku</button>,
}));

const proof = { type: 'offline-shell-proof' as const, version: 'synthetic', ready: true };
const installLabel = 'Uložit aplikaci pro offline spuštění';
const verifyLabel = 'Ověřit spuštění bez internetu';
let root: Root;
let host: HTMLDivElement;
const button = (label: string) => [...host.querySelectorAll('button')].find(item => item.textContent === label)!;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
async function render() {
  await act(async () => root.render(<React.StrictMode><OfflineApp /></React.StrictMode>));
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  window.history.replaceState(null, '', '/offline.html');
  vi.mocked(checkOfflineShell).mockReset().mockResolvedValue(proof);
  vi.mocked(installOfflineShell).mockReset().mockResolvedValue(proof);
  vi.mocked(testOfflineShellBoot).mockReset().mockResolvedValue(undefined);
  vi.mocked(listOfflineSessions).mockReset().mockResolvedValue([]);
  vi.mocked(openOfflineRuntime).mockReset();
  vi.mocked(commitOfflineSynchronization).mockReset();
  playback.finishedGeneration = undefined;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it('admits one installation when the button is clicked twice in the same batch', async () => {
  const installation = deferred<typeof proof>();
  vi.mocked(installOfflineShell).mockReturnValue(installation.promise);
  await render();
  await act(async () => { button(installLabel).click(); button(installLabel).click(); });
  expect(installOfflineShell).toHaveBeenCalledTimes(1);
  expect(button(installLabel).disabled).toBe(true);
  await act(async () => installation.resolve(proof));
  expect(button(installLabel).disabled).toBe(false);
});

it('keeps installation busy and error-free when verification is also clicked in the same batch', async () => {
  const installation = deferred<typeof proof>(), verification = deferred<void>();
  vi.mocked(installOfflineShell).mockReturnValue(installation.promise);
  vi.mocked(testOfflineShellBoot).mockReturnValue(verification.promise);
  await render();
  expect(button(verifyLabel).disabled).toBe(false);
  await act(async () => { button(installLabel).click(); button(verifyLabel).click(); });
  // A verification admitted during the installation could settle before it.
  if (vi.mocked(testOfflineShellBoot).mock.calls.length) {
    await act(async () => verification.reject(new Error('Souběžné ověření selhalo')));
  }
  expect(host.querySelector('[data-offline-error]')).toBeNull();
  expect(button(installLabel).disabled).toBe(true);
  expect(testOfflineShellBoot).not.toHaveBeenCalled();
  await act(async () => { verification.resolve(); installation.resolve(proof); });
  expect(testOfflineShellBoot).toHaveBeenCalledTimes(1);
  expect(button(installLabel).disabled).toBe(false);
});

it('allows retry after a genuine installation failure', async () => {
  vi.mocked(installOfflineShell).mockRejectedValueOnce(new Error('Testovací chyba instalace'));
  await render();
  await act(async () => button(installLabel).click());
  expect(host.querySelector('[data-offline-error]')?.textContent).toBe('Testovací chyba instalace');
  expect(button(installLabel).disabled).toBe(false);
  await act(async () => button(installLabel).click());
  expect(installOfflineShell).toHaveBeenCalledTimes(2);
  expect(host.querySelector('[data-offline-error]')).toBeNull();
  expect(host.querySelector('[data-offline-status]')?.textContent).toContain('úspěšně spustila');
});

it('keeps a new route task active when the previous route task rejects', async () => {
  const previous = deferred<typeof proof>(), current = deferred<typeof proof>();
  vi.mocked(installOfflineShell).mockReturnValueOnce(previous.promise).mockReturnValueOnce(current.promise);
  await render();
  await act(async () => button(installLabel).click());
  await act(async () => {
    window.history.replaceState(null, '', '/offline.html#/import?eventId=synthetic-event');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  expect(host.textContent).toContain('Otevřít offline kvíz této akce');
  expect(button(installLabel).disabled).toBe(false);
  await act(async () => button(installLabel).click());
  await act(async () => previous.reject(new Error('Chyba předchozí stránky')));
  expect(host.querySelector('[data-offline-error]')).toBeNull();
  expect(button(installLabel).disabled).toBe(true);
  await act(async () => current.resolve(proof));
  expect(button(installLabel).disabled).toBe(false);
});

it('retries the persisted synchronization from the actual reopened operator without changing its request', async () => {
  const manifest = offlineManifest();
  const state = { ...initialOfflineState(manifest), status: 'ended' as const };
  const intent = { previewDigest: 'd'.repeat(64), resolutions: [{ teamId: 'team-1', roundId: 'round-1', choice: 'online' as const, reason: 'Původní volba' }], completeRecovery: true };
  const marker = { ...intent, headHash: state.headHash, operationCount: 0 };
  const receipt = { exportId: manifest.exportId, sessionId: manifest.sessionId, receiptId: 'synthetic-receipt', replayed: true, headHash: state.headHash, operationCount: 0, rows: [] };
  const synchronize = vi.fn<OfflineRuntime['synchronize']>().mockImplementation(async (request, submit) => {
    expect(request).toEqual(intent);
    expect(Object.keys(request).sort()).toEqual(['completeRecovery', 'previewDigest', 'resolutions']);
    return submit([], request);
  });
  const runtime = { manifest, state, operations: [], pendingSynchronization: marker, syncedReceipt: undefined,
    playBlock: 'Čeká na potvrzení synchronizace.', synchronize, close: vi.fn(),
  } as unknown as OfflineRuntime;
  vi.mocked(listOfflineSessions).mockResolvedValue([{ sessionId: manifest.sessionId, title: manifest.event.title, sequence: 0 } as Awaited<ReturnType<typeof listOfflineSessions>>[number]]);
  vi.mocked(openOfflineRuntime).mockResolvedValue(runtime);
  vi.mocked(commitOfflineSynchronization).mockResolvedValue(receipt);
  await render();
  const password = host.querySelector<HTMLInputElement>('input[type=password]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(password, 'synthetic-offline-password');
    password.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => button('Odemknout a pokračovat').click());
  expect(host.querySelector('[data-offline-sync-pending]')).not.toBeNull();
  await act(async () => button('Znovu ověřit synchronizaci').click());
  expect(synchronize).toHaveBeenCalledTimes(1);
  expect(commitOfflineSynchronization).toHaveBeenCalledWith(manifest.event.id, manifest.exportId, [], intent.previewDigest, intent.resolutions, true);
  expect(host.querySelector('[data-offline-error]')).toBeNull();
});

it.each(['saved', 'failed', 'stale'] as const)('forwards local audio completion while the real score-save task is busy (%s completion)', async outcome => {
  const source = offlineManifest();
  const manifest = { ...source, slides: source.slides.map(slide => slide.position === 2 ? { ...slide, kind: 'audio' as const, mediaSource: 'quiz-asset:synthetic-offline-quiz/' + 'a'.repeat(64) } : slide) };
  const state = { ...initialOfflineState(manifest), status: 'active' as const, slidePosition: 2, mediaGeneration: 7, mediaCommand: 'play' as const };
  const saving = deferred<void>();
  const append = vi.fn<OfflineRuntime['append']>().mockReturnValue(saving.promise);
  const reportMediaFinished = vi.fn<(generation: number) => Promise<void>>().mockResolvedValue(undefined);
  const runtime = { manifest, state, operations: [], playBlock: null, append, reportMediaFinished, close: vi.fn() } as unknown as OfflineRuntime;
  let refreshRuntime!: () => void;
  vi.mocked(listOfflineSessions).mockResolvedValue([{ sessionId: manifest.sessionId, title: manifest.event.title, sequence: 0 } as Awaited<ReturnType<typeof listOfflineSessions>>[number]]);
  vi.mocked(openOfflineRuntime).mockImplementation((_session, _password, changed) => { refreshRuntime = changed; return Promise.resolve(runtime); });
  await render();
  const password = host.querySelector<HTMLInputElement>('input[type=password]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(password, 'synthetic-offline-password');
    password.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => button('Odemknout a pokračovat').click());
  const score = host.querySelector<HTMLInputElement>('input[aria-label="Body — QA01"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(score, '2');
    score.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => button('Uložit body kola').click());
  expect(append).toHaveBeenCalledTimes(1);
  expect(button('Uložit body kola').disabled).toBe(true);
  if (outcome === 'failed') reportMediaFinished.mockRejectedValueOnce(new Error('Synthetic completion disk failure'));
  if (outcome === 'stale') playback.finishedGeneration = 6;
  await act(async () => button('Dokončit syntetickou ukázku').click());
  expect(reportMediaFinished).toHaveBeenCalledExactlyOnceWith(outcome === 'stale' ? 6 : 7);
  expect(append).toHaveBeenCalledTimes(1);
  expect(Boolean(host.querySelector('[data-offline-media-completion-error]'))).toBe(outcome === 'failed');
  expect(button('Uložit body kola').disabled).toBe(true);
  await act(async () => saving.resolve());
  expect(host.querySelector('[data-offline-error]')).toBeNull();
  if (outcome === 'failed') {
    Object.defineProperty(runtime, 'syncedReceipt', { value: { receiptId: 'synthetic-receipt' } });
    await act(async () => refreshRuntime());
    expect(host.querySelector('[data-offline-media-completion-error]')).toBeNull();
    expect(host.querySelector('[data-offline-sync-receipt]')).not.toBeNull();
  }
});

it.each(['complete', 'missing', 'changed'] as const)('keeps offline standings private until confirmation (%s scores)', async outcome => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  const manifest = offlineManifest();
  const initial = initialOfflineState(manifest);
  const state = { ...initial, status: 'active' as const,
    scores: initial.scores.map(score => ({ ...score, halfPoints: outcome === 'missing' ? null : 2 })) };
  const append = vi.fn<OfflineRuntime['append']>().mockResolvedValue(undefined);
  const runtime = { manifest, state, operations: [], playBlock: null, append, close: vi.fn() } as unknown as OfflineRuntime;
  vi.mocked(listOfflineSessions).mockResolvedValue([{ sessionId: manifest.sessionId, title: manifest.event.title, sequence: 0 } as Awaited<ReturnType<typeof listOfflineSessions>>[number]]);
  vi.mocked(openOfflineRuntime).mockResolvedValue(runtime);
  await render();
  const password = host.querySelector<HTMLInputElement>('input[type=password]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(password, 'synthetic-offline-password');
    password.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => button('Odemknout a pokračovat').click());
  await act(async () => button('Průběžné výsledky · strana 1').click());
  expect(host.querySelector('dialog[open]')).not.toBeNull(); expect(append).not.toHaveBeenCalled();
  if (outcome === 'missing') {
    expect(host.querySelector('dialog [role="alert"]')?.textContent).toContain('QA01');
    expect(button('Ukázat sálu').disabled).toBe(true);
    await act(async () => button('Zavřít náhled').click());
    expect(append).not.toHaveBeenCalled();
    return;
  }
  if (outcome === 'changed') Object.assign(state, { headHash: 'changed-after-preview' });
  await act(async () => button('Ukázat sálu').click());
  if (outcome === 'changed') expect(append).not.toHaveBeenCalled();
  else expect(append).toHaveBeenCalledExactlyOnceWith({ type: 'results', payload: { throughRoundId: manifest.rounds[0]!.id, final: false, page: 0 } });
});

it.each([false, true])('chooses round/question identity and clears stale recap selection after navigation (legacy=%s)', async legacy => {
  const original = offlineManifest();
  const manifest = legacy ? { ...original, slides: original.slides.map(slide => {
    const { roundId, questionNumber, ...old } = slide; void roundId; void questionNumber;
    return { ...old, title: '' };
  }) } : original;
  const started = reduceOfflineCommand(manifest, initialOfflineState(manifest), { type: 'start', payload: {} });
  let notifyRuntimeChange = () => {};
  const mutable = {
    manifest, state: reduceOfflineCommand(manifest, started, { type: 'navigate', payload: { position: 3 } }),
    operations: [], playBlock: null, close: vi.fn(), append: vi.fn(),
  };
  mutable.append.mockImplementation(async (command: OfflineCommand) => {
    mutable.state = { ...reduceOfflineCommand(manifest, mutable.state, command), sequence: mutable.state.sequence + 1 };
    notifyRuntimeChange();
  });
  const runtime = mutable as unknown as OfflineRuntime;
  vi.mocked(openOfflineRuntime).mockImplementation(async (_id, _password, onChange) => { notifyRuntimeChange = onChange; return runtime; });
  vi.mocked(listOfflineSessions).mockResolvedValue([{ sessionId: manifest.sessionId, title: manifest.event.title, sequence: 0 } as Awaited<ReturnType<typeof listOfflineSessions>>[number]]);

  await render();
  const password = host.querySelector<HTMLInputElement>('input[type=password]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(password, 'synthetic-offline-password');
    password.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => button('Odemknout a pokračovat').click());
  const picker = () => [...host.querySelectorAll('label')].find(label => label.textContent?.startsWith('Otázka pro rekapitulaci'))!.querySelector('select')!;
  const navigate = [...host.querySelectorAll('label')].find(label => label.textContent?.startsWith('Snímek'))!.querySelector('select')!;
  const first = picker().options[1]!.value;
  expect(first).toBe(JSON.stringify([legacy ? 'legacy:slide-3' : 'round-1', 'slide-2']));
  await act(async () => { picker().value = first; picker().dispatchEvent(new Event('change', { bubbles: true })); });
  expect(button('Odhalit vybranou rekapitulaci').disabled).toBe(false);
  await act(async () => { navigate.value = '5'; navigate.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(picker().value).toBe('');
  expect(button('Odhalit vybranou rekapitulaci').disabled).toBe(true);
  expect([...picker().options].slice(1).map(option => option.textContent)).toEqual(['2.1 Druhá syntetická otázka']);
  const second = picker().options[1]!.value;
  expect(second).toBe(JSON.stringify([legacy ? 'legacy:slide-5' : 'round-2', 'slide-4']));
  await act(async () => { picker().value = second; picker().dispatchEvent(new Event('change', { bubbles: true })); });
  await act(async () => button('Odhalit vybranou rekapitulaci').click());
  expect(mutable.append).toHaveBeenLastCalledWith({ type: 'recap', payload: { position: 4 } });
  expect(host.querySelector('.offline-preview')?.textContent).toContain('PRIVATE_OFFLINE_ANSWER_TWO');
  expect(host.querySelector('.offline-preview')?.textContent).not.toContain('PRIVATE_OFFLINE_ANSWER_ONE');
});