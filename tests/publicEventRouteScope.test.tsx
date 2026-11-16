// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PublicEventPage } from '../apps/web/src/routes/events/PublicEventPage';
import type { PublicEventRecord, RegistrationMutationResponse } from '../apps/web/src/features/events/types';

const api = vi.hoisted(() => ({ event: vi.fn(), create: vi.fn() }));
vi.mock('../apps/web/src/features/events/eventRepository', () => ({ getPublicEvent: api.event }));
vi.mock('../apps/web/src/features/events/registrationApi', () => ({
  newRegistrationRetryKey: () => crypto.randomUUID(),
  createEventRegistration: api.create,
  registrationActionError: (error: Error) => error.message,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const event = (id: string): PublicEventRecord => ({
  id, title: `Event ${id}`, startsAt: new Date('2099-11-10'), timeZone: 'Europe/Prague',
  venueName: 'Synthetic venue', publicLocation: '', registrationPublished: true, registrationStatus: 'open',
  registrationOpensAt: new Date('2020-01-01'), registrationClosesAt: new Date('2099-11-10'),
  teamSizeMin: id === 'b' ? 2 : 1, teamSizeMax: 4, teamCapacity: 10, peopleCapacity: 40,
  acceptedTeams: 2, acceptedPeople: 4, revision: 1,
});
const registration = (id: string): RegistrationMutationResponse => ({ eventId: id, registrationId: `registration-${id}`, teamName: `Team ${id}`, contactEmail: `${id}@example.test`, memberCount: 2, status: 'accepted', managementToken: `token-${id}` });
let host: HTMLDivElement;
let root: Root;
let router: ReturnType<typeof createMemoryRouter>;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  api.event.mockReset().mockImplementation((id: string) => Promise.resolve(event(id)));
  api.create.mockReset().mockImplementation((id: string) => Promise.resolve(registration(id)));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); router?.dispose(); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function render() {
  router = createMemoryRouter([{ path: '/events/:eventId', element: <PublicEventPage /> }], { initialEntries: ['/events/a'] });
  await act(async () => root.render(<RouterProvider router={router} />));
}
async function navigate(id: string) { await act(async () => { await router.navigate(`/events/${id}`); }); }
async function input(selector: string, value: string) {
  const field = host.querySelector<HTMLInputElement>(selector)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function fill(id: string) { await input('input:not([type])', `Team ${id}`); await input('input[type=email]', `${id}@example.test`); }
async function submit() { await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); }
const button = () => host.querySelector<HTMLButtonElement>('button[type=submit]')!;
const email = () => host.querySelector<HTMLInputElement>('input[type=email]')?.value;

it('clears the draft on A → B navigation and initializes B with its own minimum', async () => {
  await render(); await fill('a'); await input('input[type=number]', '4');
  expect(email()).toBe('a@example.test');
  await navigate('b');
  expect(email()).toBe('');
  expect(host.querySelector<HTMLInputElement>('input:not([type])')?.value).toBe('');
  expect(host.querySelector<HTMLInputElement>('input[type=number]')?.value).toBe('2');
  await fill('b'); await submit();
  expect(api.create).toHaveBeenCalledWith('b', { teamName: 'Team b', contactEmail: 'b@example.test', memberCount: 2 }, expect.any(String));
});

for (const outcome of ['resolve', 'reject'] as const) {
  it(`leaves B available while A is pending and ignores A's late ${outcome}`, async () => {
    const old = deferred<RegistrationMutationResponse>(); api.create.mockReturnValueOnce(old.promise);
    await render(); await fill('a'); await submit(); expect(button().disabled).toBe(true);
    await navigate('b');
    expect(button().disabled).toBe(false);
    await fill('b');
    await act(async () => { if (outcome === 'resolve') old.resolve(registration('a')); else old.reject(new Error('old A failure')); });
    expect(email()).toBe('b@example.test'); expect(button().disabled).toBe(false);
    expect(host.textContent).not.toContain('old A failure');
    expect(host.querySelector('.registration-success')).toBeNull();
    expect(api.event.mock.calls.filter(call => call[0] === 'a')).toHaveLength(1);
    await submit(); expect(api.create.mock.calls[1]?.[0]).toBe('b');
    expect(host.textContent).toContain('Děkujeme, tým byl přihlášen.');
    expect(host.querySelector<HTMLAnchorElement>('a[href*="registration/manage"]')?.getAttribute('href')).toContain('/events/b/registration/manage#registration=registration-b&token=token-b');
  });

  it(`keeps B's pending/retry request isolated when A's finally runs after ${outcome}`, async () => {
    const old = deferred<RegistrationMutationResponse>(); const current = deferred<RegistrationMutationResponse>();
    api.create.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    await render(); await fill('a'); await submit(); const aKey: unknown = api.create.mock.calls[0]![2];
    await navigate('b');
    expect(button().disabled).toBe(false);
    await fill('b'); await submit();
    expect(api.create).toHaveBeenCalledTimes(2);
    const bKey: unknown = api.create.mock.calls[1]![2]; expect(bKey).not.toBe(aKey);
    await act(async () => { if (outcome === 'resolve') old.resolve(registration('a')); else old.reject(new Error('old A failure')); });
    expect(button().disabled).toBe(true); expect(email()).toBe('b@example.test');
    expect(host.textContent).not.toContain('old A failure'); expect(host.querySelector('.registration-success')).toBeNull();
    await submit(); expect(api.create).toHaveBeenCalledTimes(2);
    await act(async () => current.reject(new Error('B retryable failure')));
    expect(button().disabled).toBe(false); expect(host.textContent).toContain('B retryable failure');
    api.create.mockResolvedValue(registration('b')); await submit();
    expect(api.create.mock.calls[2]![2]).toBe(bKey);
    expect(host.textContent).toContain('Děkujeme, tým byl přihlášen.');
  });

  it(`isolates a new A generation after A → B → A from the earlier A ${outcome}`, async () => {
    const old = deferred<RegistrationMutationResponse>(); const current = deferred<RegistrationMutationResponse>();
    api.create.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    await render(); await fill('old'); await submit(); const oldKey: unknown = api.create.mock.calls[0]![2];
    await navigate('b'); await navigate('a'); expect(button().disabled).toBe(false); expect(email()).toBe('');
    await fill('new'); await submit(); const newKey: unknown = api.create.mock.calls[1]![2]; expect(newKey).not.toBe(oldKey);
    await act(async () => { if (outcome === 'resolve') old.resolve(registration('a')); else old.reject(new Error('old generation failure')); });
    expect(button().disabled).toBe(true); expect(email()).toBe('new@example.test');
    expect(host.textContent).not.toContain('old generation failure'); expect(host.querySelector('.registration-success')).toBeNull();
    await submit(); expect(api.create).toHaveBeenCalledTimes(2);
    await act(async () => current.resolve({ ...registration('a'), teamName: 'Team new' }));
    expect(host.querySelector('.registration-success')?.textContent).toContain('Team new');
  });
}

it('preserves the in-flight guard and retry key for the same event through query/fragment navigation', async () => {
  const current = deferred<RegistrationMutationResponse>(); api.create.mockReturnValueOnce(current.promise);
  await render(); await fill('a'); await submit(); const key: unknown = api.create.mock.calls[0]![2];
  await navigate('a?view=details#prihlaseni');
  expect(email()).toBe('a@example.test'); expect(button().disabled).toBe(true);
  await submit(); expect(api.create).toHaveBeenCalledTimes(1);
  await act(async () => current.reject(new Error('retryable failure')));
  expect(button().disabled).toBe(false); expect(host.textContent).toContain('retryable failure');
  api.create.mockResolvedValue(registration('a')); await submit();
  expect(api.create.mock.calls[1]![2]).toBe(key);
  expect(api.event.mock.calls.filter(call => call[0] === 'a')).toHaveLength(2);
});

it('gives B a distinct retry key after a completed failed A request', async () => {
  api.create.mockRejectedValueOnce(new Error('A retryable failure'));
  await render(); await fill('a'); await submit(); const key: unknown = api.create.mock.calls[0]![2];
  expect(button().disabled).toBe(false);
  await navigate('b'); await fill('b'); await submit();
  expect(api.create.mock.calls[1]![0]).toBe('b');
  expect(api.create.mock.calls[1]![2]).not.toBe(key);
});

for (const outcome of ['resolve', 'reject'] as const) {
  it(`ignores A's post-create refresh ${outcome} after navigating to B`, async () => {
    const refresh = deferred<PublicEventRecord>();
    api.event.mockResolvedValueOnce(event('a')).mockReturnValueOnce(refresh.promise);
    await render(); await fill('a'); await submit();
    expect(host.querySelector('.registration-success')).not.toBeNull();
    expect(api.event).toHaveBeenCalledTimes(2);
    await navigate('b'); await fill('b');
    await act(async () => { if (outcome === 'resolve') refresh.resolve({ ...event('a'), title: 'Stale refresh A' }); else refresh.reject(new Error('old refresh failure')); });
    expect(host.querySelector('h1')?.textContent).toBe('Event b'); expect(email()).toBe('b@example.test');
    expect(button().disabled).toBe(false); expect(host.querySelector('.registration-success')).toBeNull();
    expect(host.querySelector('[role=alert]')).toBeNull();
    await submit(); expect(api.create.mock.calls[1]![0]).toBe('b');
  });
}

for (const outcome of ['resolve', 'reject'] as const) {
  it(`ignores an old event load ${outcome} after B has loaded`, async () => {
    const old = deferred<PublicEventRecord>(); api.event.mockReturnValueOnce(old.promise);
    await render(); await navigate('b'); await fill('b');
    await act(async () => { if (outcome === 'resolve') old.resolve(event('a')); else old.reject(new Error('old load failure')); });
    expect(host.querySelector('h1')?.textContent).toBe('Event b'); expect(email()).toBe('b@example.test');
    expect(host.querySelector('[role=alert]')).toBeNull(); expect(button().disabled).toBe(false);
  });
}
