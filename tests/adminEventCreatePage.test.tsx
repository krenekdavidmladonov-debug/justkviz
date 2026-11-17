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
  window.sessionStorage.clear();
  Object.assign(auth, { uid: 'staff-one', version: 1 });
  loadList = undefined;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  router = createMemoryRouter([
    { path: createPath, element: <AdminEventCreatePage isCurrentEntry={entryKey => router.state.location.key === entryKey && router.state.navigation.state === 'idle'} /> },
    { path: listPath, loader: () => loadList?.() ?? null, element: <h1>Přehled akcí</h1> },
    { path: `${listPath}/:eventId`, element: <h1>Detail akce</h1> },
  ], { initialEntries: [createPath] });
});
afterEach(async () => { await act(async () => root.unmount()); router.dispose(); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

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
    const input = [...form().querySelectorAll('label')].find(item => item.querySelector('span')?.firstChild?.textContent === label)!.querySelector('input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  expect(form().checkValidity()).toBe(true);
}

async function changeField(label: string, value: string) {
  const element = [...form().querySelectorAll('label')].find(item => item.querySelector('span')?.firstChild?.textContent === label)!.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,textarea,select')!;
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
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
  expect(createEvent).toHaveBeenCalledWith(expect.objectContaining({ title: 'Testovací večer', startsAt: '2030-10-20T19:00', venueName: 'Testovací sál', publicLocation: 'Praha' }), expect.any(String));
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

it('retains the exact submitted event and request identity after an uncertain response and same-user remount', async () => {
  const request = deferCreate();
  await render();
  await fillForm();
  await act(async () => form().requestSubmit());
  const first = vi.mocked(createEvent).mock.calls[0]!;
  expect(first[1]).toEqual(expect.any(String));
  await act(async () => request.reject(new Error('Synthetic response lost after commit')));
  auth.version++;
  await render();
  expect(form().querySelector<HTMLInputElement>('input')!.value).toBe('Testovací večer');
  expect([...form().querySelectorAll('fieldset')].every(item => item.disabled)).toBe(true);
  vi.mocked(createEvent).mockResolvedValueOnce(created);
  await act(async () => form().requestSubmit());
  expect(vi.mocked(createEvent).mock.calls[1]).toEqual(first);
  expect(router.state.location.pathname).toBe(createdPath);
});

it('restores the full submitted configuration from durable recovery after a complete component remount', async () => {
  const request = deferCreate();
  await render(); await fillForm();
  await changeField('Datum a čas v Praze', '2030-10-27T02:30');
  await changeField('Popis akce', 'Synthetic original description');
  await changeField('Způsob účtování', 'per-event');
  await changeField('Cena v Kč', '1700');
  await changeField('Maximální počet týmů', '17');
  await changeField('Minimální počet členů týmu', '1');
  await act(async () => form().querySelector<HTMLInputElement>('input[type=checkbox]')!.click());
  await act(async () => form().requestSubmit());
  const first = vi.mocked(createEvent).mock.calls[0]!;
  expect(first[0]).toMatchObject({ pricingMode: 'per-event', pricingAmountCzk: 1700, pricingHidden: true, description: 'Synthetic original description', teamCapacity: 17, teamSizeMin: 1 });
  await act(async () => request.reject(new Error('Synthetic lost ACK')));
  await act(async () => root.unmount()); root = createRoot(host);
  await render();
  expect(form().querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('Synthetic original description');
  expect([...form().querySelectorAll('fieldset')].every(item => item.disabled)).toBe(true);
  vi.mocked(createEvent).mockResolvedValueOnce(created);
  await act(async () => form().requestSubmit());
  expect(vi.mocked(createEvent).mock.calls[1]).toEqual(first);
  expect(router.state.location.pathname).toBe(createdPath);
});

it('keeps an unobserved successful attempt across A to B to A without exposing its fields to B', async () => {
  const request = deferCreate();
  await render(); await fillForm();
  await act(async () => form().requestSubmit());
  const first = vi.mocked(createEvent).mock.calls[0]!;
  auth.uid = 'staff-two'; await render();
  expect(form().querySelector<HTMLInputElement>('input')!.value).toBe('');
  await act(async () => request.resolve(created));
  expect(router.state.location.pathname).toBe(createPath);
  auth.uid = 'staff-one'; await render();
  expect(form().querySelector<HTMLInputElement>('input')!.value).toBe('Testovací večer');
  vi.mocked(createEvent).mockResolvedValueOnce(created);
  await act(async () => form().requestSubmit());
  expect(vi.mocked(createEvent).mock.calls[1]).toEqual(first);
  expect(router.state.location.pathname).toBe(createdPath);
});

it('does not dispatch a creation whose recovery snapshot could not be persisted', async () => {
  await render(); await fillForm();
  const write = vi.spyOn(window.sessionStorage, 'setItem').mockImplementation(() => { throw Error('Synthetic storage denial'); });
  await act(async () => form().requestSubmit());
  expect(createEvent).not.toHaveBeenCalled();
  expect(host.querySelector('[role=alert]')?.textContent).toContain('Akce nebyla odeslána');
  expect(form().querySelector<HTMLInputElement>('input')!.value).toBe('Testovací večer');
  write.mockRestore();
  vi.mocked(createEvent).mockResolvedValueOnce(created);
  await act(async () => form().requestSubmit());
  expect(router.state.location.pathname).toBe(createdPath);
});

it('requires an explicit checked reset before editing an ambiguous submission', async () => {
  const request = deferCreate();
  await render(); await fillForm();
  await act(async () => form().requestSubmit());
  const first = vi.mocked(createEvent).mock.calls[0]!;
  await act(async () => request.reject(new Error('Synthetic lost response')));
  const reset = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === 'Začít nový pokus')!;
  expect(reset.disabled).toBe(true);
  const checked = [...host.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].find(item => item.parentElement!.textContent.includes('Zkontroloval'))!;
  await act(async () => checked.click());
  await act(async () => { reset.click(); form().requestSubmit(); });
  expect(createEvent).toHaveBeenCalledTimes(1);
  expect(form().querySelector<HTMLInputElement>('input')!.value).toBe('');
  await fillForm();
  vi.mocked(createEvent).mockResolvedValueOnce(created);
  await act(async () => form().requestSubmit());
  expect(vi.mocked(createEvent).mock.calls[1]![1]).not.toBe(first[1]);
  expect(router.state.location.pathname).toBe(createdPath);
});

it('identifies, focuses and scrolls to the first missing field without creating an attempt payload', async () => {
  await render();
  const title = form().elements.namedItem('title') as HTMLInputElement;
  const scroll = vi.fn();
  title.scrollIntoView = scroll;
  await act(async () => form().requestSubmit());
  expect(createEvent).not.toHaveBeenCalled();
  expect(title.getAttribute('aria-invalid')).toBe('true');
  expect(document.activeElement).toBe(title);
  expect(scroll).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' });
  expect(host.querySelector('[role=alert]')?.textContent).toBe('Vyplňte toto pole.');
});

it.each(['', '   '])('reports a missing public location %j next to the required field', async value => {
  await render(); await fillForm();
  await changeField('Veřejné upřesnění místa', value);
  const location = form().elements.namedItem('publicLocation') as HTMLInputElement;
  location.scrollIntoView = vi.fn();
  await act(async () => form().requestSubmit());
  expect(createEvent).not.toHaveBeenCalled();
  expect(location.required).toBe(true);
  expect(location.labels?.[0]?.textContent).toContain('*');
  expect(location.getAttribute('aria-invalid')).toBe('true');
  expect(document.activeElement).toBe(location);
  expect(location.labels?.[0]?.querySelector('[role=alert]')?.textContent).toBe('Vyplňte toto pole.');
});

it('reports an impossible Prague clock time directly at the date field', async () => {
  await render(); await fillForm();
  await changeField('Datum a čas v Praze', '2026-03-29T02:30');
  const date = form().elements.namedItem('startsAt') as HTMLInputElement;
  date.scrollIntoView = vi.fn();
  await act(async () => form().requestSubmit());
  expect(createEvent).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(date);
  expect(date.labels?.[0]?.querySelector('[role=alert]')?.textContent).toContain('neexistuje');
});

it('requires confirmation for a past date and leaves the draft editable after cancelling', async () => {
  await render(); await fillForm();
  await changeField('Datum a čas v Praze', '2020-01-01T19:00');
  vi.mocked(createEvent).mockResolvedValue(created);
  const confirm = vi.fn(() => false);
  vi.stubGlobal('confirm', confirm);
  await act(async () => form().requestSubmit());
  expect(confirm).toHaveBeenCalledExactlyOnceWith('Akce je v minulosti, opravdu?');
  expect(createEvent).not.toHaveBeenCalled();
  expect([...form().querySelectorAll('fieldset')].every(item => !item.disabled)).toBe(true);
  confirm.mockReturnValue(true);
  await act(async () => form().requestSubmit());
  expect(createEvent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ startsAt: '2020-01-01T19:00' }), expect.any(String));
  expect(router.state.location.pathname).toBe(createdPath);
});
