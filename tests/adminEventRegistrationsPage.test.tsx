// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getEvent, listEventRegistrations } from '../apps/web/src/features/events/eventRepository';
import { adminCancelRegistration, configureEventRegistration, reissueRegistrationLink } from '../apps/web/src/features/events/registrationApi';
import type { EventRecord, RegistrationRecord } from '../apps/web/src/features/events/types';
import { AdminEventRegistrationsPage } from '../apps/web/src/routes/admin/AdminEventRegistrationsPage';
import { eventFormRecord } from './browser/events-form-ux.data';

vi.mock('../apps/web/src/auth/AuthProvider', () => ({ useAuth: () => ({ can: () => true }) }));
vi.mock('../apps/web/src/features/events/ManualTeamDialog', () => ({ ManualTeamDialog: () => null }));
vi.mock('../apps/web/src/features/events/RegistrationSharePanel', () => ({ RegistrationSharePanel: () => null }));
vi.mock('../apps/web/src/features/events/eventRepository', () => ({
  getEvent: vi.fn(),
  listEventRegistrations: vi.fn(),
}));
vi.mock('../apps/web/src/features/events/registrationApi', () => ({
  adminCancelRegistration: vi.fn(),
  configureEventRegistration: vi.fn(),
  reissueRegistrationLink: vi.fn(),
}));

const event = (id: string): EventRecord => ({ ...eventFormRecord(), id, title: `Akce ${id}` });
const team = (id: string): RegistrationRecord => ({
  id: `team-${id}`, eventId: id, teamName: `Tým ${id}`, memberCount: 4,
  contactEmail: `synthetic-${id}@example.invalid`, source: 'online', status: 'accepted',
  createdAt: event(id).startsAt, updatedAt: event(id).startsAt,
});
const route = (id: string) => `/admin/events/${id}/registrations`;

let host: HTMLDivElement, root: Root;
let router: ReturnType<typeof createMemoryRouter>;

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(getEvent).mockImplementation(async id => event(id));
  vi.mocked(listEventRegistrations).mockImplementation(async id => [team(id)]);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  router.dispose();
  host.remove();
  vi.unstubAllGlobals();
});

async function openRegistrations(id: string) {
  router = createMemoryRouter([
    { path: '/admin/events/:eventId/registrations', element: <AdminEventRegistrationsPage /> },
  ], { initialEntries: [route(id)] });
  await act(async () => root.render(<RouterProvider router={router} />));
}

it('shows only the target event retry when its registrations fail to load', async () => {
  await openRegistrations('a');
  expect(host.querySelector('h1')?.textContent).toBe('Akce a');
  expect(host.textContent).toContain('synthetic-a@example.invalid');
  expect(host.textContent).toContain('Vydat nový odkaz');

  vi.mocked(listEventRegistrations).mockRejectedValueOnce(new Error('permission-denied'));
  await act(async () => router.navigate(route('b')));
  expect(router.state.location.pathname).toBe(route('b'));
  expect(vi.mocked(listEventRegistrations)).toHaveBeenLastCalledWith('b');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Registrace se nepodařilo načíst.');
  expect(host.textContent).not.toContain('Akce a');
  expect(host.textContent).not.toContain('synthetic-a@example.invalid');
  expect(host.textContent).not.toContain('Vydat nový odkaz');

  const retry = host.querySelector<HTMLButtonElement>('[role="alert"] button')!;
  expect(retry.textContent?.trim()).toBe('Zkusit znovu');
  await act(async () => retry.click());
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.querySelector('h1')?.textContent).toBe('Akce b');
  expect(host.textContent).toContain('synthetic-b@example.invalid');
  expect(host.textContent).not.toContain('synthetic-a@example.invalid');
  expect(vi.mocked(getEvent).mock.calls).toEqual([['a'], ['b'], ['b']]);
  expect(adminCancelRegistration).not.toHaveBeenCalled();
  expect(configureEventRegistration).not.toHaveBeenCalled();
  expect(reissueRegistrationLink).not.toHaveBeenCalled();
});

it('keeps B visible when the previous event registrations resolve later', async () => {
  let resolveA!: (teams: readonly RegistrationRecord[]) => void;
  vi.mocked(listEventRegistrations).mockImplementationOnce(() => new Promise(resolve => { resolveA = resolve; }));
  await openRegistrations('a');
  expect(vi.mocked(listEventRegistrations)).toHaveBeenCalledWith('a');

  await act(async () => router.navigate(route('b')));
  expect(host.querySelector('h1')?.textContent).toBe('Akce b');
  expect(host.textContent).toContain('synthetic-b@example.invalid');

  await act(async () => resolveA([team('a')]));
  expect(host.querySelector('h1')?.textContent).toBe('Akce b');
  expect(host.textContent).toContain('synthetic-b@example.invalid');
  expect(host.textContent).not.toContain('synthetic-a@example.invalid');
});
