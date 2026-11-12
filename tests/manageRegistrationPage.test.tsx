// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ManageRegistrationPage } from '../apps/web/src/routes/events/ManageRegistrationPage';
import type { PublicEventRecord, RegistrationMutationResponse } from '../apps/web/src/features/events/types';

const api = vi.hoisted(() => ({ get: vi.fn(), event: vi.fn(), update: vi.fn(), cancel: vi.fn() }));
vi.mock('../apps/web/src/features/events/eventRepository', () => ({ getPublicEvent: api.event }));
vi.mock('../apps/web/src/features/events/registrationApi', () => ({ getManagedRegistration: api.get, updateManagedRegistration: api.update, cancelManagedRegistration: api.cancel, registrationActionError: (error: Error) => error.message }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const registration = (id: string, status: RegistrationMutationResponse['status'] = 'accepted'): RegistrationMutationResponse => ({ eventId: 'event', registrationId: id, teamName: `Team ${id}`, contactEmail: `${id}@example.test`, memberCount: 2, status });
const event: PublicEventRecord = { id: 'event', title: 'Synthetic event', startsAt: new Date('2026-11-10'), timeZone: 'Europe/Prague', venueName: 'Synthetic venue', publicLocation: '', registrationPublished: true, registrationStatus: 'open', teamSizeMin: 1, teamSizeMax: 4, teamCapacity: 10, peopleCapacity: 40, acceptedTeams: 2, acceptedPeople: 4, revision: 1 };
const url = (id = 'a', token = `token-${id}`, eventId = 'event') => `/events/${eventId}/registration/manage#registration=${id}&token=${token}`;
let host: HTMLDivElement;
let root: Root;
let router: ReturnType<typeof createMemoryRouter>;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  api.get.mockReset().mockImplementation((_eventId: string, id: string) => Promise.resolve(registration(id)));
  api.event.mockReset().mockResolvedValue(event);
  api.update.mockReset().mockResolvedValue(registration('a'));
  api.cancel.mockReset().mockResolvedValue(registration('a', 'cancelled'));
  vi.stubGlobal('confirm', vi.fn(() => true));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); router?.dispose(); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function render(initial = url()) {
  router = createMemoryRouter([{ path: '/events/:eventId/registration/manage', element: <ManageRegistrationPage /> }], { initialEntries: [initial] });
  await act(async () => root.render(<RouterProvider router={router} />));
}
async function navigate(next: string) { await act(async () => { await router.navigate(next); }); }
async function submit() { await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); }
async function cancel() { await act(async () => host.querySelector<HTMLButtonElement>('.danger-button')!.click()); }
const saveButton = () => host.querySelector<HTMLButtonElement>('button[type=submit]')!;
const email = () => host.querySelector<HTMLInputElement>('input[type=email]')?.value;

it.each(['/events/event/registration/manage', '/events/event/registration/manage#registration=a', '/events/event/registration/manage#token=token-a'])('clears previously loaded PII immediately for incomplete link %s without remounting the router', async invalid => {
  await render();
  expect(email()).toBe('a@example.test');
  await navigate(invalid);
  expect(host.querySelector('form')).toBeNull();
  expect(host.textContent).not.toContain('Team a');
  expect(host.innerHTML).not.toContain('a@example.test');
  expect(host.textContent).toContain('Bezpečný odkaz není platný.');
  expect(api.get).toHaveBeenCalledTimes(1);
});

it('ignores an old load completing after the link becomes invalid', async () => {
  const old = deferred<RegistrationMutationResponse>(); api.get.mockReturnValueOnce(old.promise);
  await render();
  await navigate('/events/event/registration/manage');
  await act(async () => old.resolve(registration('a')));
  expect(host.querySelector('form')).toBeNull();
  expect(host.textContent).not.toContain('Team a');
});

it('ignores stale load errors after another valid link has loaded', async () => {
  const old = deferred<RegistrationMutationResponse>(); api.get.mockReturnValueOnce(old.promise);
  await render(); await navigate(url('b'));
  await act(async () => old.reject(new Error('old load failure')));
  expect(email()).toBe('b@example.test');
  expect(host.textContent).not.toContain('old load failure');
});

for (const action of ['save', 'cancel'] as const) {
  for (const outcome of ['resolve', 'reject'] as const) {
    it(`keeps B's pending mutation/retry request ID when A's ${action} later ${outcome}s`, async () => {
      const old = deferred<RegistrationMutationResponse>();
      const current = deferred<RegistrationMutationResponse>();
      api.update.mockImplementation((_eventId: string, id: string) => id === 'a' ? old.promise : current.promise);
      api.cancel.mockReturnValue(old.promise);
      await render();
      if (action === 'save') await submit(); else await cancel();
      await navigate(url('b'));
      expect(email()).toBe('b@example.test');
      expect(saveButton().disabled).toBe(false);
      await submit();
      const bCalls = () => api.update.mock.calls.filter(call => call[1] === 'b');
      expect(bCalls()).toHaveLength(1);
      const requestId: unknown = bCalls()[0]![4];
      await act(async () => { if (outcome === 'resolve') old.resolve(registration('a', action === 'cancel' ? 'cancelled' : 'accepted')); else old.reject(new Error('old mutation failure')); });
      expect(email()).toBe('b@example.test');
      expect(host.querySelector('h2')?.textContent).toBe('Team b');
      expect(saveButton().disabled).toBe(true);
      expect(host.textContent).not.toContain('old mutation failure');
      expect(host.textContent).not.toContain('Registrace byla upravena.');
      expect(host.textContent).not.toContain('Registrace byla zrušena.');
      await submit(); expect(bCalls()).toHaveLength(1);
      await act(async () => current.reject(new Error('current retryable failure')));
      expect(saveButton().disabled).toBe(false);
      expect(host.textContent).toContain('current retryable failure');
      api.update.mockResolvedValue(registration('b'));
      await submit();
      expect(bCalls()).toHaveLength(2);
      expect(bCalls()[1]![4]).toBe(requestId);
      expect(host.textContent).toContain('Registrace byla upravena.');
    });
  }
}

it('does not reuse an earlier credential scope request ID after token-only navigation', async () => {
  api.update.mockRejectedValue(new Error('retryable'));
  await render(); await submit();
  const oldId: unknown = api.update.mock.calls[0]![4];
  await navigate(url('a', 'replacement-token'));
  expect(host.textContent).not.toContain('retryable');
  await submit();
  expect(api.update.mock.calls[1]![2]).toBe('replacement-token');
  expect(api.update.mock.calls[1]![4]).not.toBe(oldId);
});

it('clears successful messages on credential changes and preserves current cancellation', async () => {
  await render(); await submit();
  expect(host.textContent).toContain('Registrace byla upravena.');
  await navigate(url('b'));
  expect(host.textContent).not.toContain('Registrace byla upravena.');
  api.cancel.mockResolvedValue(registration('b', 'cancelled'));
  await cancel();
  expect(api.cancel).toHaveBeenCalledWith('event', 'b', 'token-b');
  expect(host.textContent).toContain('Registrace je zrušená');
  expect(host.textContent).toContain('Registrace byla zrušena.');
});

for (const action of ['save', 'cancel'] as const) {
  for (const outcome of ['resolve', 'reject'] as const) {
    it(`keeps an invalid link free of old PII/status after an earlier ${action} ${outcome}s`, async () => {
      const old = deferred<RegistrationMutationResponse>();
      api.update.mockReturnValue(old.promise); api.cancel.mockReturnValue(old.promise);
      await render();
      if (action === 'save') await submit(); else await cancel();
      await navigate('/events/event/registration/manage#registration=a');
      await act(async () => { if (outcome === 'resolve') old.resolve(registration('a', action === 'cancel' ? 'cancelled' : 'accepted')); else old.reject(new Error('old failure')); });
      expect(host.querySelector('form')).toBeNull();
      expect(host.textContent).not.toContain('Team a');
      expect(host.textContent).not.toContain('old failure');
      expect(host.querySelector('[role=status]')).toBeNull();
      expect(host.querySelector('[role=alert]')?.textContent).toBe('Bezpečný odkaz není platný.');
    });
  }
}

it('preserves an in-flight operation when only unrelated fragment fields change', async () => {
  const current = deferred<RegistrationMutationResponse>(); api.update.mockReturnValue(current.promise);
  await render(); await submit();
  await navigate(url() + '&view=details');
  expect(saveButton().disabled).toBe(true);
  expect(api.get).toHaveBeenCalledTimes(1);
  await submit(); expect(api.update).toHaveBeenCalledTimes(1);
  await act(async () => current.resolve(registration('a')));
  expect(host.textContent).toContain('Registrace byla upravena.');
});

it('starts a new request scope when only the event route parameter changes', async () => {
  api.update.mockRejectedValue(new Error('retryable'));
  await render(); await submit();
  const oldId: unknown = api.update.mock.calls[0]![4];
  await navigate(url('a', 'token-a', 'other-event'));
  expect(host.textContent).not.toContain('retryable');
  await submit();
  expect(api.update.mock.calls[1]![0]).toBe('other-event');
  expect(api.update.mock.calls[1]![4]).not.toBe(oldId);
});
