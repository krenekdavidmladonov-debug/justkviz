// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '../apps/web/src/app/router';

const routing = vi.hoisted(() => ({ routes: [] as RouteObject[] }));
const access = vi.hoisted(() => ({ signedIn: true, staff: true, manageUsers: false }));
const loaded = vi.hoisted(() => ({ referee: 0, account: 0, users: 0, settings: 0 }));
const mounted = vi.hoisted(() => ({ users: vi.fn(), settings: vi.fn() }));
vi.mock('react-router-dom', async original => ({
  ...await original<typeof import('react-router-dom')>(),
  createBrowserRouter: (routes: RouteObject[]) => { routing.routes = routes; return {}; },
}));
vi.mock('../apps/web/src/app/SessionLayout', async () => ({ SessionLayout: (await import('react-router-dom')).Outlet }));
vi.mock('../apps/web/src/auth/AuthProvider', () => ({ useAuth: () => ({
  currentUser: access.signedIn ? { uid: 'synthetic-staff' } : null, role: access.staff ? 'admin' : null,
  loading: false, can: (permission: string) => permission !== 'users.manage' || access.manageUsers,
}) }));
vi.mock('../apps/web/src/routes/events/EventsPage', () => ({ EventsPage: () => <h1>Veřejné akce</h1> }));
vi.mock('../apps/web/src/routes/admin/AdminPage', () => ({ AdminPage: () => <h1>Administrace</h1> }));
vi.mock('../apps/web/src/routes/admin/AdminLoginPage', () => ({ AdminLoginPage: () => <h1>Přihlášení</h1> }));
vi.mock('../apps/web/src/routes/admin/AdminNoAccessPage', () => ({ AdminNoAccessPage: () => <h1>Bez přístupu</h1> }));
vi.mock('../apps/web/src/routes/admin/UsersAccessPage', () => {
  loaded.users++;
  return { UsersAccessPage: () => { mounted.users(); return <h1>Přístupy spolupracovníků</h1>; } };
});
vi.mock('../apps/web/src/routes/admin/AdminSettingsPage', () => {
  loaded.settings++;
  return { AdminSettingsPage: () => { mounted.settings(); return <h1>Nastavení účtu</h1>; } };
});
vi.mock('../apps/web/src/routes/AccountPage', async () => {
  loaded.account++;
  const { useLocation, useParams } = await import('react-router-dom');
  return { AccountPage: () => {
    const { inviteId } = useParams(), { hash } = useLocation();
    return <section data-test-account><h1>Můj účet</h1><span data-test-invite>{inviteId}</span><span data-test-hash>{hash}</span></section>;
  } };
});
vi.mock('../apps/web/src/routes/referee/RefereePage', () => {
  loaded.referee++;
  return { RefereePage: () => <h1>Bodování rozhodčího</h1> };
});

let host: HTMLDivElement, root: Root;
let router: ReturnType<typeof createMemoryRouter>;
function copyRoutes(routes: RouteObject[]): RouteObject[] {
  return routes.map(route => route.children ? { ...route, children: copyRoutes(route.children) } : { ...route });
}
function routeAt(routes: RouteObject[], path: string): RouteObject {
  const pending = [...routes];
  for (const route of pending) {
    if (route.path === path) return route;
    if (route.children) pending.push(...route.children);
  }
  throw new Error('Missing tested route ' + path);
}
async function render(initial: string, configure?: (routes: RouteObject[]) => void) {
  const routes = copyRoutes(routing.routes);
  configure?.(routes);
  router = createMemoryRouter(routes, { initialEntries: [initial] });
  await act(async () => {
    root.render(<RouterProvider router={router} />);
    if (!configure && !router.state.initialized) {
      await new Promise<void>(resolve => {
        const unsubscribe = router.subscribe(state => {
          if (state.initialized) { unsubscribe(); resolve(); }
        });
      });
    }
  });
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.assign(access, { signedIn: true, staff: true, manageUsers: false });
  mounted.users.mockClear(); mounted.settings.mockClear();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); router?.dispose(); host.remove(); vi.unstubAllGlobals(); });

it('does not import referee, account, users or settings modules for the public events page', async () => {
  await render('/');
  expect(host.textContent).toContain('Veřejné akce');
  expect(loaded).toEqual({ referee: 0, account: 0, users: 0, settings: 0 });
});

it('keeps users.manage before mounting the users page while allowing staff settings', async () => {
  await render('/admin/users');
  expect(host.textContent).toContain('Tato činnost není dostupná');
  expect(mounted.users).not.toHaveBeenCalled();
  await act(async () => router.navigate('/admin/settings'));
  expect(host.textContent).toContain('Nastavení účtu');
  expect(mounted.settings).toHaveBeenCalled();
  access.manageUsers = true;
  await act(async () => router.navigate('/admin/users'));
  expect(host.textContent).toContain('Přístupy spolupracovníků');
  expect(mounted.users).toHaveBeenCalled();
});

it.each(['signedIn', 'staff'] as const)('keeps RequireStaff checking %s for settings deep links', async field => {
  access[field] = false;
  await render('/admin/settings');
  expect(host.textContent).toContain(field === 'signedIn' ? 'Přihlášení' : 'Bez přístupu');
  expect(mounted.settings).not.toHaveBeenCalled();
});

it('shares the account module between account and invite with the invite parameters and hash', async () => {
  await render('/account');
  const account = host.querySelector('[data-test-account]');
  await act(async () => router.navigate('/invite/synthetic-invite#token=synthetic-token'));
  expect(host.querySelector('[data-test-account]')).toBe(account);
  expect(host.querySelector('[data-test-invite]')?.textContent).toBe('synthetic-invite');
  expect(host.querySelector('[data-test-hash]')?.textContent).toBe('#token=synthetic-token');
  expect(loaded.account).toBe(1);
});

it.each([
  ['/account', 'account'], ['/invite/synthetic-invite#token=synthetic-token', 'invite/:inviteId'],
])('shows a cold-load fallback for %s', async (initial, path) => {
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  await render(initial, routes => {
    const route = routeAt(routes, path), load = route.lazy;
    if (typeof load !== 'function') throw new Error('Expected a lazy route');
    route.lazy = async () => { await ready; return load(); };
  });
  expect(host.textContent).toContain('Načítám stránku');
  expect(host.querySelector('.site-header')).not.toBeNull();
  await act(async () => release());
  expect(host.textContent).toContain('Můj účet');
});

it.each([
  ['/account#token=synthetic-token', 'account'], ['/admin/settings', 'settings'],
])('keeps the existing error boundary for a failed module on %s', async (initial, path) => {
  await render(initial, routes => {
    routeAt(routes, path).lazy = () => Promise.reject(new TypeError('Failed to fetch dynamically imported module: https://private.example/token'));
  });
  expect(host.textContent).toContain('Stránku se nepodařilo načíst.');
  expect(host.textContent).not.toContain('private.example');
  expect(router.state.location.pathname + router.state.location.hash).toBe(initial);
});
