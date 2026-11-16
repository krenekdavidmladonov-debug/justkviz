// @vitest-environment happy-dom
import React, { act, lazy, Suspense, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi, type MockInstance } from 'vitest';
import { RouteErrorPage } from '../apps/web/src/app/RouteErrorPage';
import { lazyAdminRoute } from '../apps/web/src/app/lazyAdminRoute';
import { RequireStaff } from '../apps/web/src/routes/admin/RequireStaff';
import { AdminLoading } from '../apps/web/src/routes/admin/AdminLoading';

vi.mock('../apps/web/src/auth/AuthProvider', () => ({ useAuth: () => ({
  can: () => true, currentUser: { uid: 'test' }, role: 'admin', loading: false,
}) }));

let host: HTMLDivElement, root: Root;
let reload: MockInstance<() => void>;
let router: ReturnType<typeof createMemoryRouter>;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  reload = vi.spyOn(window.location, 'reload').mockImplementation(() => undefined);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  router.dispose();
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function renderAdmin(load: () => Promise<ComponentType>, initial = '/admin') {
  router = createMemoryRouter([
    { path: '/admin', element: <RequireStaff />, errorElement: <RouteErrorPage />, HydrateFallback: AdminLoading, children: [
      { index: true, element: <h1>Přehled administrace</h1> },
      { path: 'quizzes', lazy: lazyAdminRoute(load, ['quiz.read']) },
    ] },
    { path: '/', element: <h1>Akce</h1> },
  ], { initialEntries: [initial] });
  await act(async () => root.render(<RouterProvider router={router} />));
}

const failedModule = () => Promise.reject(new TypeError('Failed to fetch dynamically imported module: https://private.example/assets/QuizLibrary-secret.js?token=private-token'));

it.each(['/admin/quizzes?filter=draft#library', '/admin'])('recovers a rejected lazy module from %s without automatic reload', async initial => {
  await renderAdmin(failedModule, initial);
  if (initial === '/admin') await act(async () => router.navigate('/admin/quizzes?filter=draft#library'));
  expect(host.textContent).toContain('Stránku se nepodařilo načíst.');
  expect(host.textContent).toContain('JustKvíz');
  expect(host.textContent).not.toContain('private.example');
  expect(host.textContent).not.toContain('private-token');
  expect(host.textContent).not.toContain('QuizLibrary-secret');
  expect(host.textContent).not.toContain('Unexpected Application Error');
  expect(reload).not.toHaveBeenCalled();
  expect(router.state.location).toMatchObject({ pathname: '/admin/quizzes', search: '?filter=draft', hash: '#library' });
  await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
  expect(reload).toHaveBeenCalledOnce();
  expect(reload).toHaveBeenCalledWith();
  expect(router.state.location).toMatchObject({ pathname: '/admin/quizzes', search: '?filter=draft', hash: '#library' });
});

it('offers a working safe return from a failed admin destination', async () => {
  await renderAdmin(failedModule, '/admin/quizzes');
  const link = host.querySelector<HTMLAnchorElement>('a[href="/admin"]');
  expect(link?.textContent).toBe('Zpět do administrace');
  await act(async () => link!.click());
  expect(host.textContent).toContain('Přehled administrace');
  expect(reload).not.toHaveBeenCalled();
});

it('redacts arbitrary thrown values instead of displaying private diagnostics', async () => {
  // Real route failures can reject with untrusted values instead of Error instances.
  // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
  await renderAdmin(() => Promise.reject({ message: 'Contact private@example.test', token: 'private-token', stack: 'private-stack' }), '/admin/quizzes');
  expect(host.textContent).toContain('Něco se nepovedlo.');
  expect(host.textContent).not.toContain('private');
  expect(host.querySelector('pre')).toBeNull();
  expect(reload).not.toHaveBeenCalled();
});

it('catches component render errors with the same generic recovery screen', async () => {
  function BrokenPage(): React.ReactNode { throw new Error('Private contact private@example.test and private-token'); }
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await renderAdmin(async () => BrokenPage, '/admin/quizzes');
  expect(host.textContent).toContain('Něco se nepovedlo.');
  expect(host.textContent).not.toContain('private');
  expect(reload).not.toHaveBeenCalled();
});

it.each(['error loading dynamically imported module', 'Importing a module script failed'])('catches React.lazy projector failures: %s', async message => {
  const Projector = lazy(() => Promise.reject(new TypeError(message)));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  router = createMemoryRouter([
    { path: '/projector/:sessionId', element: <Suspense fallback={<p>Načítám…</p>}><Projector /></Suspense>, errorElement: <RouteErrorPage /> },
    { path: '/', element: <h1>Akce</h1> },
  ], { initialEntries: ['/projector/session?token=private-token#private-hash'] });
  await act(async () => root.render(<RouterProvider router={router} />));
  expect(host.textContent).toContain('Stránku se nepodařilo načíst.');
  expect(host.textContent).not.toContain('private');
  expect(host.querySelector('a[href="/"]')?.textContent).toBe('JustKvíz');
  expect(host.textContent).toContain('Zpět na akce');
  expect(reload).not.toHaveBeenCalled();
});
