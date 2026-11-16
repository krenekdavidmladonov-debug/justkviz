// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EventPublicationButton } from '../apps/web/src/features/events/EventPublicationButton';
import { eventFormRecord } from './browser/events-form-ux.data';
import type { EventRecord } from '../apps/web/src/features/events/types';
const mocks = vi.hoisted(() => ({ allowed: true, publish: vi.fn(), callable: vi.fn(), invoke: vi.fn() }));
vi.mock('../apps/web/src/auth/AuthProvider', () => ({ useAuth: () => ({ can: () => mocks.allowed }) }));
vi.mock('../apps/web/src/features/events/registrationApi', () => ({ setEventPublication: mocks.publish }));
vi.mock('../apps/web/src/features/events/eventApi', () => ({ eventActionError: () => 'Změnu se nepodařilo uložit.' }));
vi.mock('../apps/web/src/services/firebase/client', () => ({ getFirebaseServices: () => ({ functions: 'synthetic-functions' }) }));
vi.mock('firebase/functions', async importOriginal => ({ ...await importOriginal<typeof import('firebase/functions')>(), httpsCallable: mocks.callable }));
let host: HTMLDivElement, root: Root;
beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(new Date('2030-10-01T10:00:00Z').getTime()); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); mocks.allowed = true; mocks.publish.mockReset().mockResolvedValue({ revision: 3, registrationPublished: true, registrationStatus: 'open', lifecycleStatus: 'draft', registrationOpensAt: '2030-10-01T10:30:00.000Z', registrationClosesAt: '2030-10-20T17:00:00.000Z' }); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const button = (text: string) => [...host.querySelectorAll('button')].find(item => item.textContent === text)!;
async function render(patch: Partial<EventRecord> = {}, changed = vi.fn()) { await act(async () => root.render(<MemoryRouter><EventPublicationButton event={{ ...eventFormRecord(), ...patch }} onChanged={changed} /></MemoryRouter>)); return changed; }
it('requires one confirmation without typing and makes no request on cancellation', async () => { await render(); await act(async () => button('Zveřejnit a otevřít registrace').click()); expect(host.querySelectorAll('dialog')).toHaveLength(1); expect(host.querySelector('dialog input')).toBeNull(); expect(host.textContent).toContain('Kvíz zatím není připravený'); await act(async () => button('Zrušit').click()); expect(mocks.publish).not.toHaveBeenCalled(); });
it('prevents duplicate clicks and immediately returns the canonical registration window and status', async () => {
  let resolve!: (value: unknown) => void; mocks.publish.mockImplementation(() => new Promise(done => { resolve = done; })); const changed = await render(); await act(async () => button('Zveřejnit a otevřít registrace').click()); await act(async () => { host.querySelector<HTMLButtonElement>('dialog .primary-button')!.click(); host.querySelector<HTMLButtonElement>('dialog .primary-button')!.click(); });
  expect(mocks.publish).toHaveBeenCalledTimes(1); expect(mocks.publish).toHaveBeenCalledWith('synthetic-event', 2, true); expect(button('Zrušit').disabled).toBe(true);
  await act(async () => resolve({ revision: 3, registrationPublished: true, registrationStatus: 'open', lifecycleStatus: 'draft', registrationOpensAt: '2030-10-01T10:30:00.000Z', registrationClosesAt: '2030-10-20T17:00:00.000Z' })); expect(changed).toHaveBeenCalledWith(expect.objectContaining({ registrationPublished: true, revision: 3, lifecycleStatus: 'draft', registrationStatus: 'open', registrationOpensAt: new Date('2030-10-01T10:30:00Z'), registrationClosesAt: new Date('2030-10-20T17:00:00Z') })); expect(host.querySelector('dialog')).toBeNull();
});
it('offers the public detail when visible, hides through the same operation, and retains a failed dialog for retry', async () => { mocks.publish.mockRejectedValueOnce(new Error('failure')); const changed = await render({ registrationPublished: true }); expect(host.querySelector('a')?.getAttribute('href')).toBe('/events/synthetic-event'); await act(async () => button('Skrýt z veřejného webu').click()); await act(async () => button('Skrýt akci').click()); expect(mocks.publish).toHaveBeenCalledWith('synthetic-event', 2, false); expect(host.querySelector('[role=alert]')).not.toBeNull(); expect(changed).not.toHaveBeenCalled(); });
it('disables publication without current permissions and for a completed event', async () => { mocks.allowed = false; await render(); expect(button('Zveřejnit a otevřít registrace').disabled).toBe(true); mocks.allowed = true; await render({ lifecycleStatus: 'completed' }); expect(button('Zveřejnit a otevřít registrace').disabled).toBe(true); });
it('allows hiding a published completed active event without enabling re-publication or archived changes', async () => {
  await render({ lifecycleStatus: 'completed', disposition: 'active', registrationPublished: true }); expect(button('Skrýt z veřejného webu').disabled).toBe(false);
  await act(async () => button('Skrýt z veřejného webu').click()); await act(async () => button('Skrýt akci').click()); expect(mocks.publish).toHaveBeenCalledWith('synthetic-event', 2, false);
  await render({ lifecycleStatus: 'completed', disposition: 'archived', registrationPublished: true }); expect(button('Skrýt z veřejného webu').disabled).toBe(true);
});
it('closes a stale confirmation on refreshed publication or revision and requires a new explicit intent', async () => {
  await render(); await act(async () => button('Zveřejnit a otevřít registrace').click());
  const originalConfirm = host.querySelector<HTMLButtonElement>('dialog .primary-button')!;
  await render({ revision: 3, registrationPublished: true });
  expect(host.querySelector('dialog')).toBeNull(); await act(async () => originalConfirm.click()); expect(mocks.publish).not.toHaveBeenCalled();
  await act(async () => button('Skrýt z veřejného webu').click()); await act(async () => button('Skrýt akci').click());
  expect(mocks.publish).toHaveBeenCalledWith('synthetic-event', 3, false);
  await render({ revision: 4, registrationPublished: false }); await act(async () => button('Zveřejnit a otevřít registrace').click());
  await render({ revision: 5, registrationPublished: false }); expect(host.querySelector('dialog')).toBeNull(); expect(mocks.publish).toHaveBeenCalledTimes(1);
});

it('sends the open-now flag only when publishing and keeps explicit window configuration compatible', async () => {
  mocks.invoke.mockResolvedValue({ data: {} }); mocks.callable.mockReturnValue(mocks.invoke);
  const api = await vi.importActual<typeof import('../apps/web/src/features/events/registrationApi')>('../apps/web/src/features/events/registrationApi');
  await api.setEventPublication('synthetic-event', 2, true);
  expect(mocks.callable).toHaveBeenLastCalledWith('synthetic-functions', 'configureEventRegistration');
  expect(mocks.invoke).toHaveBeenLastCalledWith({ eventId: 'synthetic-event', expectedRevision: 2, published: true, openRegistrationsNow: true });
  await api.setEventPublication('synthetic-event', 3, false);
  expect(mocks.invoke).toHaveBeenLastCalledWith({ eventId: 'synthetic-event', expectedRevision: 3, published: false });
  await api.configureEventRegistration('synthetic-event', 4, '2030-10-02T12:30', '2030-10-20T19:00', undefined);
  expect(mocks.invoke).toHaveBeenLastCalledWith({ eventId: 'synthetic-event', expectedRevision: 4, registrationOpensAt: '2030-10-02T10:30:00.000Z', registrationClosesAt: '2030-10-20T17:00:00.000Z' });
});

it.each(['closed', 'scheduled'] as const)('offers explicit reopen for a published future %s event with no stored window', async registrationStatus => {
  const changed = await render({ registrationPublished: true, lifecycleStatus: 'ready', registrationStatus });
  expect(mocks.publish).not.toHaveBeenCalled(); expect(button('Skrýt z veřejného webu')).toBeDefined();
  await act(async () => button('Otevřít registrace').click());
  expect(host.textContent).toContain('Přihlášky otevřeme ihned a uzavřeme při začátku akce');
  await act(async () => host.querySelector<HTMLButtonElement>('dialog .primary-button')!.click());
  expect(mocks.publish).toHaveBeenCalledWith('synthetic-event', 2, true);
  expect(changed).toHaveBeenCalledWith(expect.objectContaining({ registrationStatus: 'open', registrationOpensAt: new Date('2030-10-01T10:30:00Z'), registrationClosesAt: new Date('2030-10-20T17:00:00Z') }));
});

it('requires confirmation before replacing a scheduled window and offers no reopen for an open window', async () => {
  await render({ registrationPublished: true, registrationOpensAt: new Date('2030-10-10T10:00:00Z'), registrationClosesAt: new Date('2030-10-20T17:00:00Z') });
  await act(async () => button('Otevřít registrace').click()); expect(host.textContent).toContain('Nahradí se tím případné dosavadní nastavení');
  await act(async () => button('Zrušit').click());
  await render({ registrationPublished: true, registrationOpensAt: new Date('2030-09-01T10:00:00Z'), registrationClosesAt: new Date('2030-10-20T17:00:00Z') });
  expect(button('Otevřít registrace')).toBeUndefined(); expect(mocks.publish).not.toHaveBeenCalled();
});

it('explains full capacity without promising immediate registration and retains the server full status', async () => {
  mocks.publish.mockResolvedValue({ revision: 3, registrationPublished: true, registrationStatus: 'full', lifecycleStatus: 'draft', registrationOpensAt: '2030-10-01T10:30:00Z', registrationClosesAt: '2030-10-20T17:00:00Z' });
  const changed = await render({ acceptedTeams: 20 });
  await act(async () => button('Zveřejnit a otevřít registrace').click());
  expect(host.textContent).toContain('Kapacita je nyní naplněná'); expect(host.textContent).not.toContain('Přihlášky otevřeme ihned');
  await act(async () => host.querySelector<HTMLButtonElement>('dialog .primary-button')!.click());
  expect(changed).toHaveBeenCalledWith(expect.objectContaining({ registrationStatus: 'full' }));
});

it('offers registration when a legacy people limit is exhausted but team places remain', async () => {
  await render({ acceptedTeams: 2, acceptedPeople: 8, peopleCapacity: 8 });
  await act(async () => button('Zveřejnit a otevřít registrace').click());
  expect(host.textContent).toContain('Přihlášky otevřeme ihned');
  expect(host.textContent).not.toContain('Kapacita je nyní naplněná');
  expect(mocks.publish).not.toHaveBeenCalled();
});

it('retains acknowledged existing windows when hiding and handles canonical null dates', async () => {
  const windows = { registrationOpensAt: '2030-10-01T09:00:00Z', registrationClosesAt: '2030-10-20T17:00:00Z' };
  mocks.publish.mockResolvedValue({ ...windows, revision: 3, registrationPublished: false, registrationStatus: 'closed', lifecycleStatus: 'draft' });
  const changed = await render({ registrationPublished: true, registrationOpensAt: new Date(windows.registrationOpensAt), registrationClosesAt: new Date(windows.registrationClosesAt) });
  await act(async () => button('Skrýt z veřejného webu').click()); await act(async () => button('Skrýt akci').click());
  expect(changed).toHaveBeenCalledWith(expect.objectContaining({ registrationPublished: false, registrationOpensAt: new Date(windows.registrationOpensAt), registrationClosesAt: new Date(windows.registrationClosesAt) }));
  mocks.publish.mockResolvedValue({ revision: 3, registrationPublished: false, registrationStatus: 'closed', lifecycleStatus: 'draft', registrationOpensAt: null, registrationClosesAt: null });
  const changedAgain = await render({ registrationPublished: true });
  await act(async () => button('Skrýt z veřejného webu').click()); await act(async () => button('Skrýt akci').click());
  expect(changedAgain).toHaveBeenCalledWith(expect.objectContaining({ registrationOpensAt: undefined, registrationClosesAt: undefined }));
});

it('blocks publication and reopening for past or cancelled events and rechecks time at confirmation', async () => {
  await render({ startsAt: new Date(Date.now() - 1) }); expect(button('Zveřejnit a otevřít registrace').disabled).toBe(true);
  expect(host.textContent).toContain('pouze před začátkem akce');
  await render({ registrationPublished: true, startsAt: new Date(Date.now()) }); expect(button('Otevřít registrace')).toBeUndefined();
  await render({ lifecycleStatus: 'cancelled' }); expect(button('Zveřejnit a otevřít registrace').disabled).toBe(true);
  await render({ lifecycleStatus: 'cancelled', registrationPublished: true }); expect(button('Otevřít registrace')).toBeUndefined();
  await render({ startsAt: new Date(Date.now() + 1000) }); await act(async () => button('Zveřejnit a otevřít registrace').click());
  vi.spyOn(Date, 'now').mockReturnValue(new Date('2030-10-01T10:00:02Z').getTime());
  await act(async () => host.querySelector<HTMLButtonElement>('dialog .primary-button')!.click()); expect(mocks.publish).not.toHaveBeenCalled();
});

it('closes stale reopening intent and ignores an in-flight response after a newer revision refresh', async () => {
  await render({ registrationPublished: true }); await act(async () => button('Otevřít registrace').click());
  await render({ registrationPublished: true, revision: 3 }); expect(host.querySelector('dialog')).toBeNull(); expect(mocks.publish).not.toHaveBeenCalled();
  let resolve!: (value: unknown) => void;
  mocks.publish.mockImplementation(() => new Promise(done => { resolve = done; }));
  const changed = await render(); await act(async () => button('Zveřejnit a otevřít registrace').click());
  await act(async () => host.querySelector<HTMLButtonElement>('dialog .primary-button')!.click());
  await act(async () => { host.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true })); });
  expect(host.querySelector('dialog')).not.toBeNull();
  await render({ registrationPublished: true, revision: 4 }, changed);
  await act(async () => resolve({ revision: 3, registrationPublished: true, registrationStatus: 'open', lifecycleStatus: 'draft', registrationOpensAt: '2030-10-01T10:30:00Z', registrationClosesAt: '2030-10-20T17:00:00Z' }));
  expect(changed).not.toHaveBeenCalled();
});
