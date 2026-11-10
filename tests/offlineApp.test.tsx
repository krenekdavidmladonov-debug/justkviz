// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OfflineApp } from '../apps/web/src/features/offline/OfflineApp';
import { checkOfflineShell, installOfflineShell, testOfflineShellBoot } from '../apps/web/src/features/offline/offlineShell';

vi.mock('../apps/web/src/features/offline/offlineShell', () => ({
  checkOfflineShell: vi.fn(), installOfflineShell: vi.fn(), testOfflineShellBoot: vi.fn(), proveOfflineShellBoot: vi.fn(),
}));
vi.mock('../apps/web/src/features/offline/offlineStore', () => ({ listOfflineSessions: async () => [], verifyStoredOfflineStorage: vi.fn() }));
vi.mock('../apps/web/src/features/offline/offlinePreparation', () => ({ exportOfflineRecovery: vi.fn(), exportStoredOfflineEvent: vi.fn(), importOfflineEvent: vi.fn() }));
vi.mock('../apps/web/src/features/offline/offlineRuntime', () => ({ openOfflineRuntime: vi.fn() }));
vi.mock('../apps/web/src/features/offline/OfflinePreparationWizard', () => ({ OfflinePreparationWizard: () => null }));

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
