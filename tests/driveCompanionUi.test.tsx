// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { accessCall } from '../apps/web/src/features/access/api';
import { configureDriveMediaCompanion } from '../apps/web/src/features/drive/api';
import { DriveConnectionCard } from '../apps/web/src/features/drive/DriveConnectionCard';
import { DriveMediaImportStatus } from '../apps/web/src/features/drive/DriveMediaImportStatus';
import { useDriveMediaImports } from '../apps/web/src/features/drive/useDriveMediaImports';
import { readDriveMediaImport } from '../apps/web/src/features/drive/importsApi';
import type { EditorSlide } from '../apps/web/src/features/editor/types';

vi.mock('../apps/web/src/features/access/api', () => ({ accessCall: vi.fn() }));
const auth = vi.hoisted(() => ({ denied: [] as string[] }));
vi.mock('../apps/web/src/auth/AuthProvider', () => ({ useAuth: () => ({
  currentUser: { uid: 'owner' }, membership: { role: 'owner', version: 1 }, can: (permission: string) => !auth.denied.includes(permission), loading: false,
}) }));
let root: Root, host: HTMLDivElement;
const connected = { configured: true, mediaImportEnabled: true, mediaImportMode: 'local', status: 'connected',
  folder: { id: 'folder', name: 'Média', url: '' } };
const slide = { id: 's', kind: 'video', mediaSource: 'https://www.youtube.com/watch?v=abcdefghijk',
  questionImage: '', answerImage: '', backgroundImage: '', clipStartSeconds: 5, clipEndSeconds: 15 } as EditorSlide;
let imports: ReturnType<typeof useDriveMediaImports>;
function ImportHarness() {
  imports = useDriveMediaImports('owner:1', 'quiz', true, vi.fn());
  return <DriveMediaImportStatus slide={slide} entries={imports.entries} dirty={false} onRetry={field => imports.retry(slide, field)} />;
}
async function render(view: React.ReactNode = <MemoryRouter><DriveConnectionCard /></MemoryRouter>) {
  await act(async () => root.render(view));
}
async function click(label: string) {
  const button = [...host.querySelectorAll('button')].find(item => item.textContent === label);
  expect(button?.disabled).toBe(false); await act(async () => button!.click());
}
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); vi.stubGlobal('React', React); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  auth.denied = [];
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  vi.mocked(accessCall).mockImplementation(name => Promise.resolve(name === 'readDriveConnection' ? connected : { enabled: true, paired: false }));
  localStorage.clear(); sessionStorage.clear();
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

it.each([undefined, 'cloud'])('does not call the companion endpoint before local mode is enabled (%s)', async mode => {
  vi.mocked(accessCall).mockResolvedValue({ ...connected, mediaImportMode: mode });
  await render();
  expect(accessCall).toHaveBeenCalledExactlyOnceWith('readDriveConnection');
  expect(host.textContent).not.toContain('Počítač pro přípravu');
});

it('does not call the companion endpoint for an owner missing concrete preparation permissions', async () => {
  auth.denied = ['quiz.media.attach']; await render();
  expect(accessCall).toHaveBeenCalledExactlyOnceWith('readDriveConnection');
  expect(host.textContent).not.toContain('Počítač pro přípravu');
});

it('pairs once with an in-memory selectable code, supports copying and discards it after pairing', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined); vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({ writeText } as unknown as Clipboard);
  await render();
  expect(accessCall).toHaveBeenCalledWith('configureDriveMediaCompanion', { action: 'status' });
  vi.mocked(accessCall).mockResolvedValueOnce({ enabled: true, paired: false, pairingCode: 'synthetic-code', pairingExpiresAt: Date.now() + 300_000 });
  await click('Spárovat počítač');
  const code = host.querySelector<HTMLInputElement>('input')!;
  expect(code.value).toBe('synthetic-code'); expect(code.readOnly).toBe(true);
  expect(host.textContent).toContain('jednorázový kód'); await click('Kopírovat kód'); expect(writeText).toHaveBeenCalledWith('synthetic-code');
  expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0);
  vi.mocked(accessCall).mockResolvedValueOnce({ enabled: true, paired: true, lastSeen: Date.now(), expiresAt: Date.now() + 86_400_000 });
  await click('Obnovit stav počítače');
  expect(host.querySelector('input')).toBeNull(); expect(host.textContent).toContain('Počítač je připravený');
});

it('allows manual copying after clipboard failure and expires the code without persisting it', async () => {
  vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({ writeText: vi.fn().mockRejectedValue(new Error('blocked')) } as unknown as Clipboard);
  await render();
  vi.mocked(accessCall).mockResolvedValueOnce({ enabled: true, paired: false, pairingCode: 'synthetic-code', pairingExpiresAt: Date.now() + 300_000 });
  await click('Spárovat počítač'); await click('Kopírovat kód');
  expect(host.textContent).toContain('zkopírujte ručně'); expect(host.querySelector('input')).not.toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(300_000));
  expect(host.querySelector('input')).toBeNull(); expect(host.textContent).toContain('Platnost párovacího kódu vypršela');
});

it('explains offline preparation, confirms revocation and clears the pairing state', async () => {
  vi.mocked(accessCall).mockImplementation(name => Promise.resolve(name === 'readDriveConnection' ? connected
    : { enabled: true, paired: true, lastSeen: Date.now() - 300_000, expiresAt: Date.now() + 86_400_000 }));
  await render(); expect(host.textContent).toContain('spusťte Windows pomocníka');
  expect(host.textContent).toContain('Hotové ukázky pak přehrajete na libovolném zařízení');
  await click('Odpojit počítač');
  expect(vi.mocked(accessCall).mock.calls.some(call => call[1]?.action === 'revoke')).toBe(false);
  vi.mocked(accessCall).mockResolvedValueOnce({ enabled: true, paired: false }); await click('Potvrdit odpojení počítače');
  expect(accessCall).toHaveBeenLastCalledWith('configureDriveMediaCompanion', { action: 'revoke' });
  expect(host.textContent).toContain('Počítač byl odpojen'); expect(host.textContent).toContain('Hotová média zůstávají dostupná');
});

it('shows a leased preparation as busy even while its last heartbeat is older than 90 seconds', async () => {
  vi.mocked(accessCall).mockImplementation(name => Promise.resolve(name === 'readDriveConnection' ? connected
    : { enabled: true, paired: true, processing: true, lastSeen: Date.now() - 300_000, expiresAt: Date.now() + 86_400_000 }));
  await render(); expect(host.textContent).toContain('Počítač připravuje ukázku.');
  expect(host.textContent).not.toContain('nedávno neohlásil');
});

it('recovers from a sanitized status error without displaying provider details', async () => {
  vi.mocked(accessCall).mockImplementation(name => name === 'readDriveConnection' ? Promise.resolve(connected) : Promise.reject(new Error('private-provider-detail')));
  await render(); expect(host.querySelector('[role="alert"]')?.textContent).toContain('Stav počítače');
  expect(host.textContent).not.toContain('private-provider-detail');
  vi.mocked(accessCall).mockResolvedValueOnce({ enabled: true, paired: false }); await click('Obnovit stav počítače');
  expect(host.querySelector('[role="alert"]')).toBeNull(); expect(host.textContent).toContain('Spárovat počítač');
});

it('keeps pairing pending until the response and never sends the code in another callable', async () => {
  await render();
  let complete!: (value: unknown) => void;
  vi.mocked(accessCall).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  await click('Spárovat počítač');
  expect([...host.querySelectorAll('button')].find(button => button.textContent === 'Spárovat počítač')?.disabled).toBe(true);
  await act(async () => complete({ enabled: true, paired: false, pairingCode: 'synthetic-code', pairingExpiresAt: Date.now() + 300_000 }));
  expect(host.querySelector<HTMLInputElement>('input')?.value).toBe('synthetic-code');
  expect(vi.mocked(accessCall).mock.calls.filter(call => call[0] === 'configureDriveMediaCompanion').map(call => call[1])).toEqual([{ action: 'status' }, { action: 'pair' }]);
});

it('retains a local queued job at the polling limit and refreshes its exact ID without requesting a duplicate', async () => {
  vi.mocked(accessCall).mockImplementation(name => Promise.resolve(name === 'readDriveConnection' ? connected
    : { jobId: 'job-1', status: 'queued', execution: 'local' }));
  await render(<ImportHarness />); await act(async () => imports.queueSavedSlides([slide]));
  expect(host.textContent).toContain('Čeká na počítač');
  await act(async () => vi.advanceTimersByTimeAsync(902_500));
  expect(imports.entries[0]).toMatchObject({ status: 'queued', execution: 'local', pollingPaused: true });
  expect(host.textContent).not.toContain('Nepodařilo'); expect(vi.getTimerCount()).toBe(0);
  vi.mocked(accessCall).mockResolvedValueOnce({ jobId: 'job-1', status: 'processing', execution: 'local' });
  await click('Obnovit stav');
  expect(accessCall).toHaveBeenLastCalledWith('readDriveMediaImport', { quizId: 'quiz', slideId: 's', field: 'mediaSource', jobId: 'job-1' });
  expect(vi.mocked(accessCall).mock.calls.filter(call => call[0] === 'requestDriveMediaImport')).toHaveLength(1);
  expect(host.textContent).toContain('Připravuje se na počítači');
});

it('pauses on a local polling network failure without claiming the preparation job failed', async () => {
  vi.mocked(accessCall).mockImplementation(name => name === 'readDriveConnection' ? Promise.resolve(connected)
    : name === 'requestDriveMediaImport' ? Promise.resolve({ jobId: 'job-1', status: 'queued', execution: 'local' }) : Promise.reject(new Error('offline')));
  await render(<ImportHarness />); await act(async () => imports.queueSavedSlides([slide]));
  await act(async () => vi.advanceTimersByTimeAsync(2500));
  expect(imports.entries[0]).toMatchObject({ status: 'queued', pollingPaused: true }); expect(host.textContent).toContain('Obnovit stav');
  expect(host.textContent).not.toContain('Nepodařilo');
});

it('validates companion and import response fields instead of passing secret-shaped responses through', async () => {
  vi.mocked(accessCall).mockResolvedValue({ enabled: true, paired: false, pairingCode: 'https://private.test/?token=x' });
  await expect(configureDriveMediaCompanion('pair')).rejects.toThrow('Neplatný stav');
  vi.mocked(accessCall).mockResolvedValue({ jobId: 'job-1', status: 'queued', execution: 'untrusted' });
  await expect(readDriveMediaImport({ quizId: 'quiz', slideId: 's', field: 'mediaSource' }, 'job-1')).rejects.toThrow('Neplatný stav');
});
