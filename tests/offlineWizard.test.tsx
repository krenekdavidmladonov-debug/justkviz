// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { OfflinePreparationWizard } from '../apps/web/src/features/offline/OfflinePreparationWizard';
import { checkOnlineOfflineEvent, observeOfflineIdentity } from '../apps/web/src/features/offline/offlineOnline';
import { listOfflineSessions } from '../apps/web/src/features/offline/offlineStore';

vi.mock('../apps/web/src/features/offline/offlineOnline', () => ({
  checkOnlineOfflineEvent: vi.fn(), observeOfflineIdentity: vi.fn(() => () => {}),
}));
vi.mock('../apps/web/src/features/offline/offlineStore', () => ({ listOfflineSessions: vi.fn() }));
vi.mock('../apps/web/src/features/offline/OfflineNotebookStep', () => ({
  OfflineNotebookStep: () => null, offlineTransferHref: () => '#transfer', useOfflineInstallPrompt: () => ({ prompt: null, clear: vi.fn() }),
}));

let root: Root;
let container: HTMLDivElement;
let expiresAtMs: number;
const result = { snapshotId: 'hidden-snapshot-id', teamCount: 3, mediaCount: 6, mediaCounts: { image: 3, audio: 2, video: 1 }, mediaBytes: 128, expiresAtMs: 0, issues: [] };
const button = (text: string) => [...container.querySelectorAll('button')].find(element => element.textContent === text);
async function render() {
  await act(async () => root.render(<OfflinePreparationWizard eventId="event-test" transferTarget={false} />));
  await act(async () => { await vi.dynamicImportSettled(); });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('navigator', { onLine: true, locks: {}, serviceWorker: {}, storage: { persist: vi.fn(), estimate: async () => ({ quota: 128 * 1024 * 1024 }) } });
  expiresAtMs = Date.now() + 60_000;
  vi.mocked(checkOnlineOfflineEvent).mockResolvedValue({ ...result, expiresAtMs });
  vi.mocked(listOfflineSessions).mockResolvedValue([]);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

test('auto-checks the event and progressively exposes password setup', async () => {
  await render();
  expect(checkOnlineOfflineEvent).toHaveBeenCalledWith('event-test');
  expect(container.textContent).toContain('Kvíz lze připravit');
  expect([...container.querySelectorAll('[aria-label="Média ke stažení"] dd')].map(value => value.textContent)).toEqual(['3', '2', '1']);
  expect(container.querySelector('time')?.dateTime).toBe(new Date(expiresAtMs).toISOString());
  expect(container.textContent).not.toContain(result.snapshotId);
  expect(container.querySelectorAll('input[type=password]')).toHaveLength(0);
  await act(async () => button('Pokračovat k balíčku')?.click());
  expect(container.querySelector('[aria-current="step"]')?.textContent).toContain('Vytvořit offline balíček');
  expect(container.querySelectorAll('input[type=password]')).toHaveLength(2);
  await act(async () => button('Zobrazit heslo')?.click());
  expect(container.querySelectorAll('input[type=text]')).toHaveLength(2);
  expect(container.querySelectorAll('.offline-wizard-primary')).toHaveLength(1);
});

test('reports actionable media errors without exposing diagnostic fields', async () => {
  vi.mocked(checkOnlineOfflineEvent).mockResolvedValue({ ...result, expiresAtMs: Date.now() + 60_000,
    issues: [{ slidePosition: 14, field: 'private.mediaSource', message: 'Ukázku z YouTube nelze uložit offline. Nahrajte vlastní soubor MP4.' }] });
  await render();
  expect(container.querySelector('[role=alert]')?.textContent).toContain('Snímek 14');
  expect(container.textContent).toContain('Nahrajte vlastní soubor MP4');
  expect(container.textContent).not.toContain('private.mediaSource');
  expect(button('Pokračovat k balíčku')).toBeUndefined();
});

test('removes an approved preflight when the current account changes', async () => {
  await render();
  await act(async () => button('Pokračovat k balíčku')?.click());
  expect(container.querySelectorAll('input[type=password]')).toHaveLength(2);
  await act(async () => vi.mocked(observeOfflineIdentity).mock.calls[0]![0]());
  expect(container.querySelector('[role=alert]')?.textContent).toContain('Přihlášení se změnilo');
  expect(container.querySelectorAll('input[type=password]')).toHaveLength(0);
  expect(button('Pokračovat k balíčku')).toBeUndefined();
});
