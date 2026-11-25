// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PublicEventPage } from '../apps/web/src/routes/events/PublicEventPage';
const api = vi.hoisted(() => ({ event:vi.fn(), results:vi.fn() }));
vi.mock('../apps/web/src/features/events/publicEventRead', () => ({ getPublicEvent:api.event }));
vi.mock('../apps/web/src/features/events/publicEventResults', () => ({ getPublicEventResults:api.results }));
vi.mock('../apps/web/src/features/events/registrationApi', () => ({ newRegistrationRetryKey:() => 'synthetic-retry', createEventRegistration:vi.fn(), registrationActionError:() => 'error' }));
const result = { eventId:'event', title:'Syntetická dokončená akce', startsAt:new Date('2030-01-01'), timeZone:'Europe/Prague', venueName:'Sál', publicLocation:'Město', lifecycleStatus:'completed', rows:[{ rank:1, teamName:'Alfa', halfPoints:21 }, { rank:1, teamName:'Beta', halfPoints:21 }, { rank:2, teamName:'Gama', halfPoints:18 }] };
let host:HTMLDivElement, root:ReturnType<typeof createRoot>, router:ReturnType<typeof createMemoryRouter>;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); api.event.mockReset().mockResolvedValue(null); api.results.mockReset().mockResolvedValue(result); host=document.createElement('div'); document.body.append(host); root=createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); router.dispose(); host.remove(); vi.unstubAllGlobals(); });
async function render() { router=createMemoryRouter([{ path:'/events/:eventId', element:<PublicEventPage /> }], { initialEntries:['/events/event'] }); await act(async () => root.render(<RouterProvider router={router} />)); }
it('shows all confirmed rows and co-winners without a registration form', async () => {
  await render();
  expect(host.textContent).toContain('Akce proběhla'); expect(host.textContent).toContain('Vítězové');
  expect(host.querySelectorAll('.public-event-winners li')).toHaveLength(2);
  expect(host.querySelectorAll('tbody tr')).toHaveLength(3);
  expect(host.textContent).toContain('10,5'); expect(host.querySelector('form')).toBeNull();
  expect(api.results).toHaveBeenCalledWith('event');
});
it('does not claim a winner for an unpublished or unconfirmed event', async () => {
  api.results.mockResolvedValue(null); await render();
  expect(host.textContent).toContain('Akce není dostupná'); expect(host.querySelector('table')).toBeNull();
});
it('clears the previous event while a different direct link loads', async () => {
  await render();
  let resolve!:(value:null) => void;
  api.results.mockImplementation(() => new Promise<null>(yes => { resolve=yes; }));
  await act(async () => { await router.navigate('/events/other'); });
  expect(host.textContent).not.toContain('Alfa'); expect(host.textContent).toContain('Načítám akci');
  await act(async () => resolve(null)); expect(host.querySelector('table')).toBeNull();
});
