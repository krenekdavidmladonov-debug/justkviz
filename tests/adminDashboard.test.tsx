// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { AdminPage } from '../apps/web/src/routes/admin/AdminPage';
import { AdminShell } from '../apps/web/src/app/AdminShell';
import { useDashboardData } from '../apps/web/src/features/dashboard/useDashboardData';
import { listQuizzes } from '../apps/web/src/features/quizzes/quizRepository';
import { listEvents } from '../apps/web/src/features/events/eventRepository';
import type { EventRecord } from '../apps/web/src/features/events/types';
import type { QuizSummary } from '../apps/web/src/features/quizzes/types';
const permissions = vi.hoisted(() => new Set<string>());
const identity = vi.hoisted(() => ({ uid: 'fixture', version: 1 }));
vi.mock('../apps/web/src/auth/AuthProvider', () => {
  const can = (permission: string) => permissions.has(permission);
  return { useAuth: () => ({ can, membership: { role: 'viewer', version: identity.version }, currentUser: { uid: identity.uid, email: 'fixture@example.test' }, signOut: vi.fn() }) };
});
vi.mock('../apps/web/src/features/quizzes/quizRepository', () => ({ listQuizzes: vi.fn() }));
vi.mock('../apps/web/src/features/events/eventRepository', () => ({ listEvents: vi.fn() }));
const quiz = (id: string, status: QuizSummary['status']): QuizSummary => ({ id, status, title: `Kvíz ${id}`, description: '', createdAt: new Date('2026-08-01T12:00:00Z'), updatedAt: new Date('2026-08-28T12:00:00Z'), createdBy: 'fixture', updatedBy: 'fixture', roundCount: 0, questionCount: 0 });
const event = (id: string, patch: Partial<EventRecord> = {}): EventRecord => ({ id, title: `Akce ${id}`, startsAt: new Date('2030-10-20T18:00:00Z'), timeZone: 'Europe/Prague', venue: { name: 'Sál', publicLocation: '' }, lifecycleStatus: 'ready', registrationPublished: true, registrationStatus: 'open', registrationOpensAt: new Date('2020-01-01T00:00:00Z'), registrationClosesAt: new Date('2030-10-20T17:00:00Z'), acceptedTeams: 2, acceptedPeople: 7, teamCapacity: 10, peopleCapacity: 40, teamSizeMin: 2, teamSizeMax: 6, revision: 1, scoring: { unitScale: 2, rankingMode: 'dense', started: false }, ...patch });
let root: Root, container: HTMLDivElement;
async function render(element = <AdminPage />) { await act(async () => root.render(<MemoryRouter>{element}</MemoryRouter>)); }
const links = () => [...container.querySelectorAll('a')].map(link => [link.textContent?.replace(/\s+/gu, ' ').trim(), link.getAttribute('href')]);
const hasLink = (label: string, href: string) => links().some(([text, target]) => text?.startsWith(label) && target === href);
const stat = (label: string, within: ParentNode = container) => [...within.querySelectorAll('.dashboard-stats > div')].find(item => item.querySelector('dt')?.textContent === label)?.querySelector('dd')?.textContent;
function HookProbe() {
  const data = useDashboardData();
  return <><output>{JSON.stringify(data.events.map(item => ({ id: item.id, revision: item.revision, published: item.registrationPublished })))}</output><button className="probe-refresh" onClick={() => void data.load()}>Refresh</button><button className="probe-publish" onClick={() => { const first = data.events[0]; if (first) data.updateEvent({ ...first, revision: first.revision + 1, registrationPublished: true }); }}>Acknowledge publication</button></>;
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2030-10-15T12:00:00Z'));
  permissions.clear(); identity.uid = 'fixture'; identity.version = 1;
  vi.mocked(listQuizzes).mockReset().mockResolvedValue([quiz('ready', 'ready'), quiz('draft', 'draft')]); vi.mocked(listEvents).mockReset().mockResolvedValue([]);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('compact overview and existing data boundaries', () => {
  test.each([
    [['quiz.read', 'quiz.create', 'quiz.edit', 'event.read', 'event.create'], ['Nový kvíz']],
    [['quiz.read', 'event.read'], []], [['quiz.read', 'quiz.create'], ['Nový kvíz']], [['event.read', 'event.create'], []],
  ])('only exposes the compact header action allowed by %j', async (allowed, expected) => {
    allowed.forEach(permission => permissions.add(permission)); await render();
    expect([...container.querySelectorAll('.dashboard-actions a')].map(link => link.textContent)).toEqual(expected);
    expect(listQuizzes).toHaveBeenCalledTimes(allowed.includes('quiz.read') ? 1 : 0); expect(listEvents).toHaveBeenCalledTimes(allowed.includes('event.read') ? 1 : 0);
    if (allowed.includes('quiz.create')) expect(hasLink('Nový kvíz', '/admin/quizzes/new')).toBe(true);
    expect(container.querySelector('.dashboard-actions')?.textContent ?? '').not.toContain('Vytvořit akci');
  });
  test('puts real draft quizzes below the event summary with the read-only destination and actual update date', async () => {
    permissions.add('quiz.read'); permissions.add('event.read'); vi.mocked(listEvents).mockResolvedValue([event('next')]); await render();
    expect(container.querySelector('.dashboard-draft-card h3')?.textContent).toBe('Kvíz draft'); expect(hasLink('Otevřít detail', '/admin/quizzes/draft')).toBe(true);
    expect(container.querySelector('.dashboard-draft-card .card-meta')?.textContent).toContain('28. 8. 2026'); expect(hasLink('Všechny kvízy', '/admin/quizzes')).toBe(true);
    const summary = container.querySelector('.dashboard-event-summary')!, drafts = container.querySelector('.dashboard-drafts')!;
    expect(summary.compareDocumentPosition(drafts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); expect(container.textContent).not.toContain('Naposledy otevřeno');
  });
  test('shows at most six newest drafts, retains edit destinations and excludes ready/trash quizzes', async () => {
    permissions.add('quiz.read'); permissions.add('quiz.edit');
    vi.mocked(listQuizzes).mockResolvedValue([...Array.from({ length: 8 }, (_, index) => ({ ...quiz(String(index), 'draft'), updatedAt: new Date(Date.UTC(2030, 9, index + 1)) })), quiz('ready', 'ready'), { ...quiz('trash', 'draft'), disposition: 'trash' }]);
    await render(); expect(container.querySelectorAll('.dashboard-draft-card')).toHaveLength(6); expect(container.querySelector('.dashboard-draft-card h3')?.textContent).toBe('Kvíz 7'); expect(hasLink('Pokračovat v úpravách', '/admin/quizzes/7/edit')).toBe(true); expect(container.textContent).not.toContain('Kvíz ready'); expect(container.textContent).not.toContain('Kvíz trash');
  });
  test.each([true, false])('empty drafts remain concise and never invent work: create permission %s', async canCreate => {
    permissions.add('quiz.read'); if (canCreate) permissions.add('quiz.create'); vi.mocked(listQuizzes).mockResolvedValue([quiz('ready', 'ready')]); await render();
    expect(container.querySelector('.dashboard-drafts-empty')?.textContent).toBe('Žádné rozpracované kvízy.'); expect(container.querySelector('.dashboard-draft-card')).toBeNull(); expect(hasLink('Všechny kvízy', '/admin/quizzes')).toBe(true);
  });
  test('no quiz permission means no library read or draft section, with the account offered instead', async () => { await render(); expect(listQuizzes).not.toHaveBeenCalled(); expect(hasLink('osobním účtu', '/account')).toBe(true); expect(container.querySelector('.dashboard-drafts')).toBeNull(); });
  test('preserves loading and a small recoverable error without showing an empty library', async () => {
    permissions.add('quiz.read'); let fail!: (error: Error) => void; vi.mocked(listQuizzes).mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; })); await render(); expect(container.textContent).toContain('Načítám přehled');
    await act(async () => fail(new Error('Local fixture failure'))); expect(container.querySelector('[role="alert"]')?.textContent).toContain('Kvízy se nepodařilo načíst'); expect(container.querySelector('.dashboard-drafts-empty')).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>('.dashboard-inline-error button')!.click()); expect(container.querySelector('[role="alert"]')).toBeNull(); expect(container.querySelector('.dashboard-draft-card')).not.toBeNull(); expect(listQuizzes).toHaveBeenCalledTimes(2);
  });
});
describe('all published event summaries', () => {
  test('renders every relevant published event with independent real stats and no selector', async () => {
    ['event.read', 'quiz.read'].forEach(permission => permissions.add(permission));
    vi.mocked(listEvents).mockResolvedValue([event('later'), event('first', { startsAt: new Date('2030-10-19T18:00:00Z'), acceptedTeams: 3, acceptedPeople: 11 }), event('preparing', { registrationPublished: false }), event('past', { lifecycleStatus: 'completed', acceptedTeams: 60, acceptedPeople: 200 }), event('trash', { disposition: 'trash' })]); await render();
    const sections = [...container.querySelectorAll('.dashboard-event-summary[data-event-id]')];
    expect(sections.map(section => section.getAttribute('data-event-id'))).toEqual(['first', 'later']); expect(container.querySelector('select')).toBeNull();
    const first = sections[0]!, later = sections[1]!;
    expect(first.getAttribute('aria-label')).toBe('Akce first'); expect(first.querySelector('h2')?.textContent).toBe('Akce first');
    for (const section of sections) expect([...section.querySelectorAll('.dashboard-stats dt')].map(node => node.textContent)).toEqual(['Do začátku', 'Volno', 'Týmy']);
    expect(stat('Týmy', first)).toBe('3 / 10'); expect(stat('Osoby', first)).toBeUndefined(); expect(stat('Volno', first)).toContain('7 týmů'); expect(stat('Volno', first)).not.toContain('osob'); expect(stat('Do začátku', first)).toContain('4 dny'); expect(stat('Do začátku', first)).toContain('6 h 0 min');
    expect(stat('Týmy', later)).toBe('2 / 10'); expect(stat('Osoby', later)).toBeUndefined(); expect(stat('Volno', later)).toContain('8 týmů'); expect(stat('Volno', later)).not.toContain('osob'); expect(stat('Do začátku', later)).toContain('5 dní');
    expect(hasLink('Spravovat akci', '/admin/events/first')).toBe(true); expect(hasLink('Spravovat akci', '/admin/events/later')).toBe(true);
    expect(container.textContent).not.toContain('Akce preparing'); expect(container.querySelector('.dashboard-continue-grid')).toBeNull(); expect(container.querySelectorAll('.event-publication-control')).toHaveLength(0); expect(listEvents).toHaveBeenCalledTimes(1); expect(listQuizzes).toHaveBeenCalledTimes(1);
  });
  test.each(['draft', 'ready', 'live'] as const)('does not show an unpublished %s event even if its date or internal readiness is relevant', async lifecycleStatus => {
    permissions.add('event.read'); vi.mocked(listEvents).mockResolvedValue([event('hidden', { lifecycleStatus, registrationPublished: false })]); await render();
    expect(container.querySelector('[data-event-id="hidden"]')).toBeNull(); expect(container.textContent).not.toContain('Akce hidden'); expect(container.textContent).toContain('Žádná zveřejněná nadcházející akce.'); expect(hasLink('Otevřít akce', '/admin/events')).toBe(true);
  });
  test('refreshing publication shows or removes only that event and leaves the other event stats intact', async () => {
    permissions.add('event.read'); const hidden = event('new', { registrationPublished: false }), other = event('other', { acceptedTeams: 1, acceptedPeople: 4, teamCapacity: 5, peopleCapacity: 20 });
    vi.mocked(listEvents).mockResolvedValue([hidden, other]); await render(); expect(container.querySelectorAll('[data-event-id]')).toHaveLength(1);
    vi.mocked(listEvents).mockResolvedValue([{ ...hidden, revision: 2, registrationPublished: true }, other]); await act(async () => container.querySelector<HTMLButtonElement>('.dashboard-refresh button')!.click()); expect([...container.querySelectorAll('[data-event-id]')].map(section => section.getAttribute('data-event-id'))).toEqual(['new', 'other']);
    const untouched = container.querySelector('[data-event-id="other"]')!; expect(stat('Týmy', untouched)).toBe('1 / 5'); expect(stat('Osoby', untouched)).toBeUndefined();
    vi.mocked(listEvents).mockResolvedValue([{ ...hidden, revision: 3, registrationPublished: false }, other]); await act(async () => container.querySelector<HTMLButtonElement>('.dashboard-refresh button')!.click()); expect(container.querySelector('[data-event-id="new"]')).toBeNull(); expect(stat('Týmy', container.querySelector('[data-event-id="other"]')!)).toBe('1 / 5');
  });
  test('an inaccessible quiz library does not hide successfully loaded published event summaries', async () => {
    permissions.add('event.read'); permissions.add('quiz.read'); vi.mocked(listQuizzes).mockRejectedValue(new Error('fixture')); vi.mocked(listEvents).mockResolvedValue([event('available'), event('another')]); await render(); expect(container.querySelector('[role="alert"]')).not.toBeNull(); expect(container.querySelectorAll('[data-event-id]')).toHaveLength(2); expect(container.querySelector('.dashboard-drafts-empty')).toBeNull();
  });
});

describe('unchanged dashboard hook concurrency and scope', () => {
  test('a refresh begun before an acknowledged publication cannot replace the newer result', async () => {
    permissions.add('event.read'); const original = event('race', { registrationPublished: false }); vi.mocked(listEvents).mockResolvedValue([original]); await render(<HookProbe />);
    let finishRefresh!: (value: readonly EventRecord[]) => void; vi.mocked(listEvents).mockImplementationOnce(() => new Promise(resolve => { finishRefresh = resolve; })); await act(async () => container.querySelector<HTMLButtonElement>('.probe-refresh')!.click()); await act(async () => container.querySelector<HTMLButtonElement>('.probe-publish')!.click()); expect(container.querySelector('output')?.textContent).toContain('"published":true'); await act(async () => finishRefresh([original])); expect(container.querySelector('output')?.textContent).toContain('"revision":2,"published":true');
  });
  test('starts event and quiz reads together and discards late responses after identity or membership changes', async () => {
    permissions.add('event.read'); permissions.add('quiz.read'); let oldEvents!: (value: readonly EventRecord[]) => void, oldQuizzes!: (value: readonly QuizSummary[]) => void;
    vi.mocked(listEvents).mockImplementationOnce(() => new Promise(resolve => { oldEvents = resolve; })); vi.mocked(listQuizzes).mockImplementationOnce(() => new Promise(resolve => { oldQuizzes = resolve; })); await render(); expect(listEvents).toHaveBeenCalledTimes(1); expect(listQuizzes).toHaveBeenCalledTimes(1);
    identity.uid = 'new-user'; identity.version = 2; vi.mocked(listEvents).mockResolvedValue([event('new')]); vi.mocked(listQuizzes).mockResolvedValue([]); await render(); await act(async () => { oldEvents([event('old')]); oldQuizzes([quiz('old', 'draft')]); }); expect(container.textContent).toContain('Akce new'); expect(container.textContent).not.toContain('Akce old'); expect(container.textContent).not.toContain('Kvíz old'); permissions.delete('event.read'); permissions.delete('quiz.read'); identity.version++; await render(); expect(container.querySelector('[data-event-id]')).toBeNull();
  });
  test('refreshes on return at most once in 30 seconds and supports explicit refresh', async () => {
    permissions.add('event.read'); let now = 10_000; vi.spyOn(Date, 'now').mockImplementation(() => now); Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); await render(); await act(async () => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); }); expect(listEvents).toHaveBeenCalledTimes(1); now += 31_000; await act(async () => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); }); expect(listEvents).toHaveBeenCalledTimes(2); await act(async () => container.querySelector<HTMLButtonElement>('.dashboard-refresh button')!.click()); expect(listEvents).toHaveBeenCalledTimes(3);
  });
});
describe('existing environment configuration', () => {
  test.each(['staging', 'production', 'development', undefined])('preserves the existing V2 environment identity without the obsolete synthetic-data banner: %s', async environment => {
    vi.stubEnv('VITE_APP_ENV', environment); vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'demo-filmovy-kviz-v2'); await render(<AdminShell />);
    expect(container.querySelectorAll('.admin-environment-label')).toHaveLength(2);
    for (const label of container.querySelectorAll('.admin-environment-label')) {
      expect(label.textContent).toBe('V2');
      expect(label.getAttribute('title')).toBe('Projekt V2: demo-filmovy-kviz-v2');
    }
    expect(container.textContent).not.toContain('Pro zkoušení používejte pouze smyšlená data.');
    expect(container.textContent).not.toContain('Testovací verze');
    expect(container.textContent).not.toContain('STAGING');
    expect(listQuizzes).not.toHaveBeenCalled();
  });
});
