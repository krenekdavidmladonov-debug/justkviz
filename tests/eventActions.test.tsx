// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EventActions } from '../apps/web/src/features/events/EventActions';
import { eventFormRecord } from './browser/events-form-ux.data';
import type { EventRecord } from '../apps/web/src/features/events/types';

const mocks = vi.hoisted(() => ({ allowed: true, denied: [] as string[], invoke: vi.fn<(name: string, data: unknown) => Promise<{ data: unknown }>>(), inventory: vi.fn(), reauthenticate: vi.fn() }));
vi.mock('../apps/web/src/auth/AuthProvider', () => ({ useAuth: () => ({ can: (permission: string) => mocks.allowed && !mocks.denied.includes(permission), currentUser: { email: 'test@example.invalid' } }) }));
vi.mock('../apps/web/src/services/firebase/client', () => ({ getFirebaseServices: () => ({ functions: {} }) }));
vi.mock('../apps/web/src/features/access/api', () => ({ privateRead: mocks.inventory }));
vi.mock('../apps/web/src/features/events/eventRepository', () => ({ getEvent: vi.fn() }));
vi.mock('../apps/web/src/features/events/eventApi', () => ({ eventActionError: () => 'Změnu se nepodařilo uložit. Zkuste to znovu.' }));
vi.mock('firebase/functions', () => ({ httpsCallable: (_functions: unknown, name: string) => (data: unknown) => mocks.invoke(name, data) }));
vi.mock('firebase/auth', () => ({ EmailAuthProvider: { credential: vi.fn() }, reauthenticateWithCredential: mocks.reauthenticate }));
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); mocks.allowed = true; mocks.denied = []; mocks.invoke.mockReset(); mocks.inventory.mockReset(); mocks.reauthenticate.mockReset();
  mocks.invoke.mockResolvedValue({ data: { revision: 2, lifecycleStatus: 'scheduled', disposition: 'trash', registrationStatus: 'closed' } });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const button = (text: string) => [...host.querySelectorAll('button')].find(item => item.textContent === text)!;
async function render(patch: Partial<EventRecord> = {}) {
  const changed = vi.fn().mockResolvedValue(undefined);
  await act(async () => root.render(<MemoryRouter><EventActions event={{ ...eventFormRecord(), title: 'Filmový večer', ...patch }} onChanged={changed} /></MemoryRouter>));
  return changed;
}
it('opens a single soft-delete dialog with real title, no inventory wait or typed confirmation; cancel makes no request', async () => {
  const changed = await render(); await act(async () => button('Smazat').click());
  expect(host.querySelectorAll('dialog')).toHaveLength(1); expect(host.querySelector('dialog')?.textContent).toContain('Filmový večer');
  expect(host.querySelector('dialog input')).toBeNull(); expect(button('Smazat akci').disabled).toBe(false);
  expect(mocks.inventory).not.toHaveBeenCalled();
  await act(async () => button('Zrušit').click()); expect(host.querySelector('dialog')).toBeNull(); expect(mocks.invoke).not.toHaveBeenCalled(); expect(changed).not.toHaveBeenCalled();
});
it('submits only once, uses existing trash callable and returns the authoritative disposition for immediate list update', async () => {
  let resolve!: (value: { data: unknown }) => void; mocks.invoke.mockImplementation(() => new Promise(done => { resolve = done; }));
  const changed = await render(); await act(async () => button('Smazat').click());
  await act(async () => { button('Smazat akci').click(); button('Smazat akci').click(); });
  expect(mocks.invoke).toHaveBeenCalledTimes(1); expect(mocks.invoke.mock.calls[0]?.[0]).toBe('trashEvent'); expect(mocks.invoke.mock.calls[0]?.[1]).not.toHaveProperty('confirmTitle');
  expect(button('Zrušit').disabled).toBe(true); expect(mocks.reauthenticate).not.toHaveBeenCalled();
  await act(async () => resolve({ data: { revision: 2, lifecycleStatus: 'scheduled', disposition: 'trash', registrationStatus: 'closed' } }));
  expect(changed).toHaveBeenCalledWith(expect.any(String), false, expect.objectContaining({ disposition: 'trash', revision: 2, registrationStatus: 'closed' }));
  expect(host.querySelector('dialog')).toBeNull();
});
it('retains the dialog and record after server failure and permits retry', async () => {
  mocks.invoke.mockRejectedValueOnce(new Error('server')); const changed = await render(); await act(async () => button('Smazat').click());
  await act(async () => button('Smazat akci').click()); expect(changed).not.toHaveBeenCalled(); expect(host.querySelector('[role=alert]')?.textContent).toContain('Zkuste to znovu'); expect(button('Smazat akci').disabled).toBe(false);
});
it('disables removal without manage permission and during a live session with a reason', async () => {
  mocks.allowed = false; await render(); expect(button('Smazat').disabled).toBe(true); expect(host.textContent).toContain('právo správy');
  mocks.allowed = true; await render({ liveSessionId: 'running', lifecycleStatus: 'live' }); expect(button('Smazat').disabled).toBe(true); expect(host.textContent).toContain('ukončete živý běh');
});
it('restores through the existing callable and preserves irreversible deletion safeguards in the separate menu', async () => {
  mocks.invoke.mockResolvedValue({ data: { revision: 4, lifecycleStatus: 'scheduled', disposition: 'active', registrationStatus: 'closed' } });
  const changed = await render({ disposition: 'trash' }); await act(async () => button('Obnovit').click());
  const confirm = host.querySelector('dialog .primary-button') as HTMLButtonElement; await act(async () => confirm.click());
  expect(mocks.invoke).toHaveBeenCalledWith('restoreEvent', expect.objectContaining({ action: 'restore' })); expect(changed).toHaveBeenCalledWith(expect.any(String), false, expect.objectContaining({ disposition: 'active' }));
  mocks.inventory.mockResolvedValue({ counts: {}, sessions: 0, ownedSnapshots: 0 }); await act(async () => button('Trvale smazat').click());
  expect(host.querySelector('input[type=password]')).not.toBeNull(); expect(host.textContent).toContain('Opište název akce'); expect(host.querySelector<HTMLButtonElement>('dialog .danger-button')?.disabled).toBe(true);
});

it('completes an active event after an explicit confirmation and optional live stop, using its current revision', async () => {
  mocks.invoke.mockResolvedValue({ data: { revision: 6, lifecycleStatus: 'completed', disposition: 'active', registrationStatus: 'closed' } });
  const changed = await render({ lifecycleStatus: 'live', liveSessionId: 'live', revision: 5 });
  await act(async () => button('Ukončit akci').click());
  expect(host.querySelector('dialog')?.textContent).toContain('Týmy, konečné výsledky a historie zůstanou zachované');
  expect(host.querySelector('dialog input[type=password]')).toBeNull();
  const checkbox = host.querySelector<HTMLInputElement>('dialog input[type=checkbox]')!;
  expect(checkbox.checked).toBe(false);
  await act(async () => checkbox.click());
  await act(async () => host.querySelector('dialog form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('completeEvent', expect.objectContaining({ expectedRevision: 5, action: 'complete', endLive: true }));
  expect(changed).toHaveBeenCalledWith(expect.stringContaining('dokončena'), false, expect.objectContaining({ revision: 6, lifecycleStatus: 'completed', disposition: 'active', registrationStatus: 'closed' }));
  expect(host.querySelector('dialog')).toBeNull(); expect(mocks.reauthenticate).not.toHaveBeenCalled(); expect(mocks.inventory).not.toHaveBeenCalled();
});

it('keeps live stop authority separate from event management in the completion dialog', async () => {
  mocks.denied = ['event.live']; await render({ lifecycleStatus: 'ready' });
  await act(async () => button('Ukončit akci').click());
  expect(host.querySelector('dialog input[type=checkbox]')).toBeNull();
  expect(host.querySelector('dialog')?.textContent).toContain('moderátor ukončit');
  await act(async () => host.querySelector('dialog form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(mocks.invoke).toHaveBeenCalledWith('completeEvent', expect.objectContaining({ endLive: false }));
});

it('retains the event completion dialog after rejection and lets the owner retry', async () => {
  mocks.invoke.mockRejectedValueOnce(new Error('active session')); const changed = await render({ lifecycleStatus: 'ready' });
  await act(async () => button('Ukončit akci').click());
  await act(async () => host.querySelector('dialog form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(changed).not.toHaveBeenCalled(); expect(host.querySelector('[role=alert]')).not.toBeNull();
  expect(host.querySelector<HTMLButtonElement>('dialog .danger-button')?.disabled).toBe(false);
});
