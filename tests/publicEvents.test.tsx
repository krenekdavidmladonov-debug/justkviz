// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import { EventsPage } from '../apps/web/src/routes/events/EventsPage';
import { PublicEventPage } from '../apps/web/src/routes/events/PublicEventPage';
import { getPublicEvent } from '../apps/web/src/features/events/eventRepository';
const mocks = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), query: vi.fn(), where: vi.fn(), create: vi.fn() }));
vi.mock('../apps/web/src/features/events/registrationApi', () => ({ createEventRegistration: mocks.create, newRegistrationRetryKey: () => 'stable-retry-key', registrationActionError: () => 'Přihlášení se nepodařilo. Zkuste to znovu.' }));
vi.mock('../apps/web/src/services/firebase/firestore', () => ({ getFirebaseFirestore: () => ({}) }));
vi.mock('../apps/web/src/features/access/api', () => ({ privateRead: vi.fn() }));
vi.mock('firebase/firestore', async original => ({ ...await original<typeof import('firebase/firestore')>(), collection: () => 'publicEvents', doc: (_db: unknown, _collection: string, id: string) => id, query: mocks.query, where: mocks.where, getDocsFromServer: mocks.list, getDocFromServer: mocks.get }));
let host: HTMLDivElement, root: Root;
const data = (title: string, lifecycleStatus: string, offset: number, full = false) => ({ title, lifecycleStatus, description: 'Veřejný popis večera.', startsAt: Timestamp.fromMillis(Date.now() + offset * 86400000), timeZone: 'Europe/Prague', venueName: 'Sál', publicLocation: 'Praha', registrationStatus: 'open', registrationPublished: true, teamSize: { min: 3, max: 6 }, capacity: { teams: { maximum: 10, accepted: full ? 10 : 3 }, people: { maximum: 60, accepted: 12 } }, registrationWindow: { opensAt: Timestamp.fromMillis(Date.now() - 86400000), closesAt: Timestamp.fromMillis(Date.now() + 86400000) }, revision: 1 });
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); mocks.where.mockReset().mockReturnValue('published-filter'); mocks.query.mockReset().mockReturnValue('published-query'); mocks.list.mockReset().mockResolvedValue({ docs: [{ id: 'future', data: () => data('Budoucí večer', 'ready', 5, true) }, { id: 'past', data: () => data('Historický večer', 'completed', -2) }] }); mocks.get.mockReset(); mocks.create.mockReset(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
it('queries published events with a single field filter, separates history and displays real units with no full-capacity signup CTA', async () => {
  await act(async () => root.render(<MemoryRouter><EventsPage /></MemoryRouter>));
  expect(mocks.where).toHaveBeenCalledWith('registrationPublished', '==', true); expect(mocks.query).toHaveBeenCalledWith('publicEvents', 'published-filter');
  expect(host.querySelector('[aria-label="Nadcházející a probíhající akce"]')?.textContent).toContain('Budoucí večer'); expect(host.querySelector('[aria-label="Nadcházející a probíhající akce"]')?.textContent).not.toContain('Historický večer');
  expect(host.querySelector('[aria-labelledby="past-events-title"]')?.textContent).toContain('Historický večer');
  const capacity = host.querySelector('.public-event-card .public-event-capacity');
  expect(capacity?.querySelector('.public-capacity-counts')?.textContent).toContain('Přihlášené týmy10Volná místa pro týmy0');
  expect(capacity?.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('10');
  expect(capacity?.textContent).not.toContain('osob'); expect(capacity?.textContent).not.toContain('60');
  expect(host.textContent).toContain('Obsazeno'); expect(host.textContent).toContain('Veřejný popis večera.'); expect(host.querySelector('.public-event-card .public-event-cta')?.textContent).toContain('Detail akce');
});
it('offers a prominent team signup link only for open registrations and displays date, venue and team size', async () => {
  mocks.list.mockResolvedValue({ docs: [{ id: 'open', data: () => data('Filmový večer', 'ready', 2) }] });
  await act(async () => root.render(<MemoryRouter><EventsPage /></MemoryRouter>));
  const card = host.querySelector('.public-event-card');
  expect(card?.querySelector('h3')?.textContent).toBe('Filmový večer');
  expect(card?.querySelector('.public-event-cta')?.getAttribute('href')).toBe('/events/open#prihlaseni');
  expect(card?.querySelector('.public-event-cta')?.textContent).toContain('Přihlásit tým');
  expect(card?.textContent).toContain('Sál'); expect(card?.textContent).toContain('Praha'); expect(card?.textContent).toContain('Členů v týmu max. 4');
});
it('retries a failed public list load without reporting an empty schedule', async () => {
  mocks.list.mockRejectedValueOnce(new Error('offline'));
  await act(async () => root.render(<MemoryRouter><EventsPage /></MemoryRouter>));
  expect(host.textContent).toContain('Akce se nepodařilo načíst.'); expect(host.textContent).not.toContain('Další večer teprve chystáme');
  await act(async () => host.querySelector('button')?.click());
  expect(host.textContent).toContain('Budoucí večer');
});
async function renderDetail(raw: Record<string, unknown> = data('Večerní kvíz', 'ready', 2)) {
  mocks.get.mockResolvedValue({ id: 'detail', exists: () => true, data: () => raw });
  await act(async () => root.render(<MemoryRouter key="detail" initialEntries={['/events/detail']}><Routes><Route path="/events/:eventId" element={<PublicEventPage />} /></Routes></MemoryRouter>));
}
it.each([
  [undefined, '350 Kč za tým'],
  [{ mode: 'per-team', amountCzk: 450 }, '450 Kč za tým'],
  [{ mode: 'per-team', amountCzk: 0 }, '0 Kč za tým'],
  [{ mode: 'per-event', amountCzk: 15000 }, '15 000 Kč za celou akci'],
  [{ mode: 'agreement', amountCzk: null }, 'Cena dle dohody'],
])('uses the event price consistently on cards and detail: %j', async (pricing, label) => {
  const raw = { ...data('Večerní kvíz', 'ready', 2), ...(pricing === undefined ? {} : { pricing }) };
  mocks.list.mockResolvedValue({ docs: [{ id: 'detail', data: () => raw }] });
  await act(async () => root.render(<MemoryRouter><EventsPage /></MemoryRouter>));
  expect(host.querySelector('.public-event-price strong')?.textContent?.replace(/\u00a0/g, ' ')).toBe(label);
  await renderDetail(raw);
  expect(host.querySelector('.public-event-price strong')?.textContent?.replace(/\u00a0/g, ' ')).toBe(label);
});
it('omits hidden pricing from public cards and detail without restoring the default price', async () => {
  const raw = { ...data('Soukromý večer', 'ready', 2), pricing: { mode: 'agreement', amountCzk: null, hidden: true } };
  mocks.list.mockResolvedValue({ docs: [{ id: 'detail', data: () => raw }] });
  await act(async () => root.render(<MemoryRouter><EventsPage /></MemoryRouter>));
  expect(host.querySelector('.public-event-card')).not.toBeNull();
  expect(host.querySelector('.public-event-price')).toBeNull();
  expect(host.textContent).not.toContain('350 Kč');
  await renderDetail(raw);
  expect(host.querySelector('h1')?.textContent).toBe('Soukromý večer');
  expect(host.querySelector('.public-event-price')).toBeNull();
  expect(host.textContent).not.toContain('Cena kvízu');
});
it('shows the real signup form with a contact privacy explanation and preserves a private management link', async () => {
  await renderDetail();
  expect(host.querySelector('h1')?.textContent).toBe('Večerní kvíz');
  expect(host.querySelectorAll('form input')).toHaveLength(3);
  expect(host.querySelector('input[type="number"]')?.getAttribute('min')).toBe('3');
  expect(host.querySelector('input[type="number"]')?.getAttribute('max')).toBe('4');
  expect((host.querySelector('input[type="number"]') as HTMLInputElement)?.value).toBe('3');
  expect(host.textContent).not.toContain('Společně na kvíz');
  expect(host.textContent).not.toContain('Vyberte název, domluvte sestavu');
  expect(host.querySelector('.public-event-detail-hero .public-event-description')?.textContent).toBe('Veřejný popis večera.');
  expect(host.textContent).toContain('Kontaktní e-mail ani údaje o registraci se veřejně nezobrazují.');
  mocks.create.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ eventId: 'detail', registrationId: 'private-registration', managementToken: 'private/token', status: 'accepted', teamName: 'Tým', memberCount: 2, contactEmail: 'private@example.test' });
  await act(async () => { host.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Přihlášení se nepodařilo.');
  await act(async () => { host.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(mocks.create.mock.calls[0]?.[2]).toBe('stable-retry-key'); expect(mocks.create.mock.calls[1]?.[2]).toBe('stable-retry-key');
  const link = host.querySelector('.registration-success a');
  expect(link?.getAttribute('href')).toBe('/events/detail/registration/manage#registration=private-registration&token=private%2Ftoken');
  expect(host.textContent).not.toContain('private@example.test');
  expect(host.textContent).not.toContain('private/token');
});
it.each([0, 4, 10])('shows %i accepted teams faithfully without a people-capacity metric', async accepted => {
  const raw = data('Večerní kvíz', 'ready', 2);
  raw.capacity.teams.accepted = accepted;
  raw.capacity.people = { maximum: 1, accepted: 1 };
  await renderDetail(raw);
  const capacity = host.querySelector('.public-event-capacity');
  expect(capacity?.querySelector('.public-capacity-counts')?.textContent).toBe(`Přihlášené týmy${accepted}Volná místa pro týmy${10 - accepted}`);
  const meter = capacity?.querySelector('[role="progressbar"]');
  expect(meter?.getAttribute('aria-valuenow')).toBe(String(accepted));
  expect(meter?.getAttribute('aria-valuemax')).toBe('10');
  expect(meter?.children).toHaveLength(10);
  expect(meter?.querySelectorAll('.is-occupied')).toHaveLength(accepted);
  expect(capacity?.textContent).not.toContain('osob');
  expect(host.querySelector('form') !== null).toBe(accepted < 10);
});
it('keeps a stricter event maximum and does not invent an occupancy percentage for unlimited teams', async () => {
  const raw = data('Menší týmy', 'ready', 2);
  raw.teamSize.max = 3;
  await renderDetail({ ...raw, capacity: { people: raw.capacity.people } });
  expect(host.querySelector('input[type="number"]')?.getAttribute('min')).toBe('3');
  expect(host.querySelector('input[type="number"]')?.getAttribute('max')).toBe('3');
  expect(host.querySelector('.public-event-capacity')?.textContent).toContain('max. 3');
  expect(host.querySelector('.public-capacity-available')?.textContent).toContain('Bez limitu');
  expect(host.querySelector('[role="progressbar"]')).toBeNull();
});
it.each(['full', 'scheduled', 'closed'] as const)('explains %s registration state and does not render a signup form', async status => {
  const raw = data('Večerní kvíz', 'ready', 2, status === 'full');
  if (status === 'scheduled') raw.registrationWindow.opensAt = Timestamp.fromMillis(Date.now() + 86400000);
  if (status === 'closed') raw.registrationWindow.closesAt = Timestamp.fromMillis(Date.now() - 1000);
  await renderDetail(raw);
  expect(host.querySelector('form')).toBeNull();
  expect(host.querySelector('.public-registration-panel')?.textContent).toContain(status === 'full' ? 'Kapacita pro další tým je právě obsazená.' : status === 'scheduled' ? 'Přihlášení týmů se otevře' : 'Přihlášení nových týmů je pro tuto akci uzavřené.');
  expect(host.querySelector('.public-registration-panel a')?.getAttribute('href')).toBe('/');
});
it('allows retrying a detail load error', async () => {
  mocks.get.mockRejectedValueOnce(new Error('offline'));
  await act(async () => root.render(<MemoryRouter initialEntries={['/events/detail']}><Routes><Route path="/events/:eventId" element={<PublicEventPage />} /></Routes></MemoryRouter>));
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('Akci se nepodařilo načíst.');
  mocks.get.mockResolvedValue({ exists: () => true, data: () => data('Obnovená akce', 'ready', 2) });
  await act(async () => host.querySelector('button')?.click());
  expect(host.querySelector('h1')?.textContent).toBe('Obnovená akce');
});
it('returns the same unavailable result for hidden and nonexistent direct URLs without exposing content', async () => {
  mocks.get.mockRejectedValueOnce({ code: 'permission-denied' }); expect(await getPublicEvent('hidden')).toBeNull();
  mocks.get.mockResolvedValueOnce({ exists: () => false }); expect(await getPublicEvent('missing')).toBeNull();
  mocks.get.mockResolvedValueOnce({ exists: () => true, data: () => ({ ...data('Hidden', 'ready', 1), registrationPublished: false }) }); expect(await getPublicEvent('hidden')).toBeNull();
});
