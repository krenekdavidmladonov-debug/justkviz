// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createEvent } from '../apps/web/src/features/events/eventApi';
import type { EventMutationResponse } from '../apps/web/src/features/events/types';
import { AdminEventCreatePage } from '../apps/web/src/routes/admin/AdminEventCreatePage';

const auth = vi.hoisted(() => ({ uid: 'staff-one', version: 1 }));
vi.mock('../apps/web/src/auth/AuthProvider', () => ({ useAuth: () => ({
  currentUser: { uid: auth.uid }, membership: { version: auth.version }, can: () => true,
}) }));
vi.mock('../apps/web/src/features/events/eventApi', async original => ({
  ...await original<typeof import('../apps/web/src/features/events/eventApi')>(), createEvent: vi.fn(),
}));

const createPath = '/admin/events/new';
const listPath = '/admin/events';
const created: EventMutationResponse = { eventId: 'synthetic-created', revision: 1, lifecycleStatus: 'draft', registrationStatus: 'closed' };
const createdPath = `${listPath}/${created.eventId}`;
let host: HTMLDivElement;
let root: Root;
let router: ReturnType<typeof createMemoryRouter>;
let loadList: (() => Promise<null>) | undefined;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(createEvent).mockReset();
  Object.assign(auth, { uid: 'staff-one', version: 1 });
  loadList = undefined;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  router = createMemoryRouter([
    { path: createPath, element: <AdminEventCreatePage isCurrentEntry={entryKey => router.state.location.key === entryKey && router.state.navigation.state === 'idle'} /> },
    { path: listPath, loader: () => loadList?.() ?? null, element: <h1>Přehled akcí</h1> },
    { path: `${listPath}/:eventId`, element: <h1>Detail akce</h1> },
  ], { initialEntries: [createPath] });
});
afterEach(async () => { await act(async () => root.unmount()); router.dispose(); host.remove(); vi.unstubAllGlobals(); });

async function render() {
  await act(async () => root.render(<React.StrictMode><RouterProvider key={`${auth.uid}:${auth.version}`} router={router} /></React.StrictMode>));
}

const form = () => host.querySelector<HTMLFormElement>('form')!;
const submitButton = () => form().querySelector<HTMLButtonElement>('button[type=submit]')!;
async function fillForm() {
  const fields = [
    ['Název akce', 'Testovací večer'], ['Datum a čas v Praze', '2030-10-20T19:00'],
    ['Místo', 'Testovací sál'], ['Veřejné upřesnění místa', 'Praha'],
  ];
  for (const [label, value] of fields) {
    const input = [...form().querySelectorAll('label')].find(item => item.textContent === label)!.querySelector('input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  expect(form().checkValidity()).toBe(true);
}

function deferCreate() {
  let resolve!: (value: EventMutationResponse) => void;
  let reject!: (error: Error) => void;
  vi.mocked(createEvent).mockReturnValue(new Promise((done, fail) => { resolve = done; reject = fail; }));
  return { resolve, reject };
}

it('sends a single create request for two valid submissions in the same React batch', async () => {
  const request = deferCreate();
  await render();
  await fillForm();
  await act(async () => { form().requestSubmit(); form().requestSubmit(); });

  expect(createEvent).toHaveBeenCalledTimes(1);
  expect(createEvent).toHaveBeenCalledWith(expect.objectContaining({ title: 'Testovací večer', startsAt: '2030-10-20T19:00', venueName: 'Testovací sál', publicLocation: 'Praha' }));
  expect(submitButton().disabled).toBe(true);
  await act(async () => request.resolve(created));
  expect(router.state.location.pathname).toBe(createdPath);
});

it.each(['route exit', 'staff remount'] as const)('ignores a successful create response after a %s', async change => {
  const request = deferCreate();
  await render();
  await fillForm();
  await act(async () => form().requestSubmit());
  expect(createEvent).toHaveBeenCalledTimes(1);

  const expectedPath = change === 'route exit' ? listPath : createPath;
  if (change === 'route exit') {
    await act(async () => host.querySelector<HTMLAnchorElement>('a.back-link')!.click());
  } else {
    auth.uid = 'staff-two';
    await render();
    expect(submitButton().disabled).toBe(false);
  }
  expect(router.state.location.pathname).toBe(expectedPath);

  await act(async () => request.resolve(created));
  expect(router.state.location.pathname).toBe(expectedPath);
});

it('lets the user leave even when the destination route is still loading', async () => {
  let finishList!: (value: null) => void;
  loadList = () => new Promise(resolve => { finishList = resolve; });
  const request = deferCreate();
  await render();
  await fillForm();
  await act(async () => form().requestSubmit());
  await act(async () => {
    host.querySelector<HTMLAnchorElement>('a.back-link')!.click();
    expect(router.state.navigation.location?.pathname).toBe(listPath);
    expect(router.state.location.pathname).toBe(createPath);
    request.resolve(created);
  });
  expect(router.state.navigation.location?.pathname).toBe(listPath);
  await act(async () => finishList(null));
  expect(router.state.location.pathname).toBe(listPath);
});

it('navigates to the created event after a membership refresh for the same staff user', async () => {
  const request = deferCreate();
  await render();
  await fillForm();
  await act(async () => form().requestSubmit());

  auth.version++;
  await render();
  expect(router.state.location.pathname).toBe(createPath);
  expect(submitButton().disabled).toBe(true);
  await act(async () => form().requestSubmit());
  expect(createEvent).toHaveBeenCalledTimes(1);
  await act(async () => request.resolve(created));
  expect(router.state.location.pathname).toBe(createdPath);
});

it('re-enables the same form after a rejection and navigates after a successful retry', async () => {
  const request = deferCreate();
  await render();
  await fillForm();
  await act(async () => form().requestSubmit());
  await act(async () => request.reject(new Error('Testovací chyba vytvoření')));

  expect(host.querySelector('[role=alert]')?.textContent).toBe('Testovací chyba vytvoření');
  expect(submitButton().disabled).toBe(false);
  vi.mocked(createEvent).mockResolvedValueOnce(created);
  await act(async () => form().requestSubmit());
  expect(createEvent).toHaveBeenCalledTimes(2);
  expect(router.state.location.pathname).toBe(createdPath);
});
