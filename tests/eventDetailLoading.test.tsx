// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AdminEventDetailPage } from '../apps/web/src/routes/admin/AdminEventDetailPage';
import { getEvent } from '../apps/web/src/features/events/eventRepository';
import { listQuizzes } from '../apps/web/src/features/quizzes/quizRepository';
import { getEditorQuiz } from '../apps/web/src/features/editor/editorRepository';
import { lockEventQuiz } from '../apps/web/src/features/events/eventApi';
import { setEventPublication } from '../apps/web/src/features/events/registrationApi';
import { registrationSharingState } from '../apps/web/src/features/events/registrationSharing';
import type { EditorQuiz } from '../apps/web/src/features/editor/types';
import type { EventRecord } from '../apps/web/src/features/events/types';
import type { QuizSummary } from '../apps/web/src/features/quizzes/types';
import { eventFormRecord } from './browser/events-form-ux.data';

const access = vi.hoisted(() => ({ allowed: true, denied: [] as string[] }));
vi.mock('../apps/web/src/auth/AuthProvider', () => ({ useAuth: () => ({ can: (permission: string) => access.allowed && !access.denied.includes(permission), currentUser: { uid: 'test' } }) }));
vi.mock('../apps/web/src/features/events/eventRepository', () => ({ getEvent: vi.fn() }));
vi.mock('../apps/web/src/features/quizzes/quizRepository', () => ({ listQuizzes: vi.fn() }));
vi.mock('../apps/web/src/features/editor/editorRepository', () => ({ getEditorQuiz: vi.fn() }));
vi.mock('../apps/web/src/features/events/eventApi', () => ({ eventActionError: () => 'Chyba', lockEventQuiz: vi.fn(), updateEvent: vi.fn() }));
vi.mock('../apps/web/src/features/events/registrationApi', () => ({ setEventPublication: vi.fn() }));
vi.mock('../apps/web/src/features/events/EventActions', () => ({ EventActions: () => null, lifecycleLabels: {} }));
vi.mock('../apps/web/src/features/leaderboard/EventLiveButton', () => ({ EventLiveButton: () => null }));
vi.mock('../apps/web/src/features/referee/RefereeAccessPanel', () => ({ RefereeAccessPanel: () => null }));
vi.mock('../apps/web/src/features/events/ManualTeamDialog', () => ({ ManualTeamDialog: () => null }));
vi.mock('../apps/web/src/features/events/RegistrationSharePanel', () => ({ RegistrationSharePanel: ({ event, now }: { event: EventRecord; now: number }) => <p data-testid="registration-sharing-state">{registrationSharingState(event, now).message}</p> }));
let host: HTMLDivElement, root: Root;
const assignment = { quizId: 'quiz', quizRevision: 1, snapshotId: 'snapshot', quizTitle: 'Připravený kvíz', roundCount: 1, questionCount: 1, lockedAt: new Date() };
const summary: QuizSummary = { id: 'quiz', title: 'Nabídka kvízu', description: '', status: 'draft', roundCount: 1, questionCount: 1,
  createdAt: new Date(), updatedAt: new Date(), createdBy: 'test', updatedBy: 'test' };
const record = (patch: Partial<EventRecord> = {}): EventRecord => ({ ...eventFormRecord(), quizAssignment: assignment, ...patch });
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); access.allowed = true; access.denied = [];
  vi.mocked(getEvent).mockReset().mockResolvedValue(record());
  vi.mocked(listQuizzes).mockReset().mockResolvedValue([summary]);
  vi.mocked(getEditorQuiz).mockReset().mockResolvedValue({ id: 'quiz', title: 'Prázdný kvíz', description: '', revision: 1, slideCount: 0, roundCount: 0, questionCount: 0, slides: [] });
  vi.mocked(lockEventQuiz).mockReset().mockResolvedValue({ eventId: record().id, revision: 3, lifecycleStatus: 'ready', registrationStatus: 'closed' });
  vi.mocked(setEventPublication).mockReset();
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function render() {
  const router = createMemoryRouter([{ path: '/admin/events/:eventId', element: <AdminEventDetailPage /> }], { initialEntries: ['/admin/events/' + record().id] });
  await act(async () => root.render(<RouterProvider router={router} />)); return router;
}
it.each([false, true])('updates registration summary and sharing immediately after opening, full=%s', async full => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2030-10-01T10:00:00Z'));
  vi.mocked(getEvent).mockResolvedValue(record({ acceptedTeams: full ? 20 : 0 }));
  let resolve!: (value: Awaited<ReturnType<typeof setEventPublication>>) => void;
  vi.mocked(setEventPublication).mockImplementation(() => new Promise(done => { resolve = done; }));
  await render();
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Zveřejnit a otevřít registrace')!.click());
  await act(async () => host.querySelector<HTMLButtonElement>('dialog .primary-button')!.click());
  await act(async () => {
    vi.advanceTimersByTime(1000);
    resolve({ eventId: record().id, revision: 3, registrationPublished: true, registrationStatus: full ? 'full' : 'open', lifecycleStatus: 'draft', registrationOpensAt: new Date(Date.now()).toISOString(), registrationClosesAt: record().startsAt.toISOString() });
  });
  expect(host.querySelector('.event-evening-summary')?.textContent).toContain(full ? 'Obsazeno' : 'Registrace otevřené');
  expect(host.querySelector('.event-evening-summary')?.textContent).not.toContain('Registrace se otevřou později');
  expect(host.querySelector('[data-testid="registration-sharing-state"]')?.textContent).toBe(full ? 'Stránka je dostupná, přihlášky jsou nyní uzavřené.' : 'Přihlášky jsou otevřené.');
  expect(host.querySelector('dialog')).toBeNull();
});
it('uses current time when a delayed event read arrives', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2030-10-01T10:00:00Z'));
  let resolve!: (value: EventRecord) => void;
  vi.mocked(getEvent).mockImplementation(() => new Promise(done => { resolve = done; }));
  await render();
  await act(async () => {
    vi.advanceTimersByTime(2000);
    resolve(record({ registrationPublished: true, registrationStatus: 'open', registrationOpensAt: new Date('2030-10-01T10:00:01Z'), registrationClosesAt: new Date('2030-10-20T17:00:00Z') }));
  });
  expect(host.querySelector('.event-evening-summary')?.textContent).toContain('Registrace otevřené');
  expect(host.querySelector('[data-testid="registration-sharing-state"]')?.textContent).toBe('Přihlášky jsou otevřené.');
});
it('offers referee access from the evening summary and the separate organizer answer key', async () => {
  await render();
  expect(host.querySelector('.event-evening-summary a[href="#event-referee"]')?.textContent).toBe('Přístup pro rozhodčího');
  expect(host.querySelector('#event-referee a[href$="/print"]')).not.toBeNull();
  expect(host.querySelector('#event-referee')!.compareDocumentPosition(host.querySelector('#event-edit')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
it.each(['event.answers.read', 'event.answers.export', 'event.export'])('does not offer private answer-key handoff without %s', async permission => {
  access.denied = [permission]; await render();
  expect(host.querySelector('#event-referee')).not.toBeNull();
  expect(host.querySelector('#event-referee a[href$="/print"]')).toBeNull();
});
it.each<Partial<EventRecord>>([{ disposition: 'trash' }, { disposition: 'archived' }, { lifecycleStatus: 'completed' }, { lifecycleStatus: 'cancelled' }])('does not offer referee access for unavailable events', async patch => {
  vi.mocked(getEvent).mockResolvedValue(record(patch)); await render();
  expect(host.querySelector('a[href="#event-referee"]')).toBeNull(); expect(host.querySelector('#event-referee')).toBeNull();
});
it.each<Partial<EventRecord>>([
  { liveSessionId: 'live' }, { scoring: { unitScale: 2, rankingMode: 'dense', started: true } },
  { lifecycleStatus: 'completed' }, { lifecycleStatus: 'cancelled' }, { disposition: 'archived' }, { disposition: 'trash' },
])('does not fetch the library or private source quiz when assignment is immutable: %j', async patch => {
  vi.mocked(getEvent).mockResolvedValue(record(patch)); await render();
  expect(host.textContent).toContain('Připravený kvíz');
  expect(listQuizzes).not.toHaveBeenCalled(); expect(getEditorQuiz).not.toHaveBeenCalled();
});
it('does not read quiz content without the complete selection permissions', async () => {
  access.allowed = false; await render(); expect(listQuizzes).not.toHaveBeenCalled(); expect(getEditorQuiz).not.toHaveBeenCalled();
});
it('compares the source on request without changing the version of an ongoing event', async () => {
  vi.mocked(getEvent).mockResolvedValue(record({ liveSessionId: 'live' }));
  vi.mocked(getEditorQuiz).mockResolvedValue({ id: 'quiz', title: 'Novější kvíz', description: '', revision: 4, slideCount: 0, roundCount: 0, questionCount: 0, slides: [] });
  await render();
  expect(getEditorQuiz).not.toHaveBeenCalled();
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Ověřit novější změny v knihovně')!.click());
  expect(host.textContent).toContain('V knihovně je novější verze 4');
  expect(host.textContent).toContain('Tato akce stále používá připravenou verzi 1');
  expect(host.querySelector('[data-testid="event-quiz-assignment"]')?.textContent).toContain('Připravená verze 1');
});
it('shows the event before the optional library arrives and keeps editorial issues advisory', async () => {
  let resolve!: (quizzes: readonly QuizSummary[]) => void;
  vi.mocked(listQuizzes).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await render(); expect(host.textContent).toContain('Týmy a kapacita'); expect(host.textContent).toContain('Načítám nabídku');
  expect(getEditorQuiz).not.toHaveBeenCalled();
  await act(async () => resolve([summary]));
  expect(getEditorQuiz).toHaveBeenCalledWith('quiz');
  expect(host.querySelector('[data-preflight-status]')?.getAttribute('data-preflight-status')).toBe('BLOCKED');
  const prepare = [...host.querySelectorAll('button')].find(button => button.textContent === 'Aktualizovat kvíz pro akci');
  expect(prepare?.disabled).toBe(false);
  expect(host.querySelector<HTMLDetailsElement>('.event-readiness details')?.open).toBe(false);
  expect(host.querySelector('.warning-confirmation input')).toBeNull();
});
it('keeps the event usable after a library failure and offers a working retry', async () => {
  vi.mocked(listQuizzes).mockRejectedValueOnce(new Error('offline')); await render();
  expect(host.textContent).toContain('Týmy a kapacita'); expect(host.querySelector('[role=alert]')?.textContent).toContain('Nabídku kvízů');
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Zkusit znovu')!.click());
  expect(listQuizzes).toHaveBeenCalledTimes(2); expect(host.querySelector('[role=alert]')).toBeNull();
});
it('ignores an earlier event response after the route changes', async () => {
  let resolve!: (event: EventRecord) => void;
  vi.mocked(getEvent).mockImplementationOnce(() => new Promise(done => { resolve = done; }))
    .mockResolvedValueOnce(record({ id: 'other', title: 'Jiná dokončená akce', lifecycleStatus: 'completed' }));
  const router = await render(); await act(async () => router.navigate('/admin/events/other'));
  await act(async () => resolve(record()));
  expect(host.textContent).toContain('Jiná dokončená akce'); expect(listQuizzes).not.toHaveBeenCalled();
});
it('ignores the optional library response after navigating to an immutable event', async () => {
  let resolve!: (quizzes: readonly QuizSummary[]) => void;
  vi.mocked(listQuizzes).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const router = await render();
  vi.mocked(getEvent).mockResolvedValue(record({ id: 'other', lifecycleStatus: 'completed' }));
  await act(async () => router.navigate('/admin/events/other'));
  await act(async () => resolve([summary]));
  expect(getEditorQuiz).not.toHaveBeenCalled(); expect(host.querySelector('select')).toBeNull();
});

function readyQuiz(revision = 1): EditorQuiz {
  return { id: 'quiz', title: 'Hotový kvíz', description: '', revision, slideCount: 1, roundCount: 1, questionCount: 1, slides: [{
    id: 'question', position: 1, kind: 'free', storedKind: 'free', isQuestion: true, roundId: 'round', roundTitle: 'Kolo',
    title: '', text: 'Kolik?', correctAnswer: 'Dvě', options: [], moderatorNote: '', media: [],
    presentation: { videoStart: null, videoEnd: null, audioTrigger: null, backgroundOverlay: null, answerOverlay: null, sourceQuestionNumber: null },
    backgroundImage: '', questionImage: '', answerImage: '', mediaSource: '', backgroundOverlay: null, clipStartSeconds: null, clipEndSeconds: null, hasLegacyData: false,
  }] };
}
const prepareButton = () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Aktualizovat kvíz pro akci')!;
it('prepares the latest saved revision despite a new editorial issue', async () => {
  const latest = { ...readyQuiz(2), slides: [{ ...readyQuiz().slides[0]!, correctAnswer: '' }] };
  vi.mocked(getEditorQuiz).mockResolvedValueOnce(readyQuiz()).mockResolvedValue(latest);
  await render(); expect(prepareButton().disabled).toBe(false);
  await act(async () => prepareButton().click());
  expect(lockEventQuiz).toHaveBeenCalledWith(record().id, record().revision, 'quiz', 2, false);
  expect(host.querySelector('[data-preflight-status]')?.getAttribute('data-preflight-status')).toBe('BLOCKED');
  expect(host.querySelector('a[href*="questionId=question"]')?.textContent).toBe('Opravit');
});
it('prepares a quiz with external-media recommendations without requiring acknowledgement', async () => {
  vi.mocked(getEditorQuiz).mockResolvedValue({ ...readyQuiz(), slides: [{ ...readyQuiz().slides[0]!, kind: 'image', storedKind: 'image', questionImage: 'https://example.test/image.jpg' }] });
  await render(); expect(prepareButton().disabled).toBe(false);
  expect(host.querySelector('.warning-confirmation input')).toBeNull();
  await act(async () => prepareButton().click());
  expect(lockEventQuiz).toHaveBeenCalledWith(record().id, record().revision, 'quiz', 1, false);
});
it('prepares the freshly checked revision and guards duplicate clicks while reading', async () => {
  let resolve!: (quiz: EditorQuiz) => void;
  vi.mocked(getEditorQuiz).mockResolvedValueOnce(readyQuiz()).mockImplementationOnce(() => new Promise(done => { resolve = done; })).mockResolvedValue(readyQuiz(2));
  await render(); await act(async () => { prepareButton().click(); prepareButton().click(); });
  expect(getEditorQuiz).toHaveBeenCalledTimes(2);
  await act(async () => resolve(readyQuiz(2)));
  expect(lockEventQuiz).toHaveBeenCalledTimes(1); expect(lockEventQuiz).toHaveBeenCalledWith(record().id, record().revision, 'quiz', 2, false);
});
it('does not display an outdated readiness result after the selected quiz changes', async () => {
  let resolve!: (quiz: EditorQuiz) => void;
  vi.mocked(listQuizzes).mockResolvedValue([summary, { ...summary, id: 'other' }]);
  vi.mocked(getEditorQuiz).mockImplementationOnce(() => new Promise(done => { resolve = done; })).mockResolvedValue({ ...readyQuiz(), id: 'other', title: 'Druhý kvíz' });
  await render();
  await act(async () => { const select = host.querySelector('#event-quiz select') as HTMLSelectElement; select.value = 'other'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await act(async () => resolve(readyQuiz()));
  expect(host.querySelector('.event-readiness')?.textContent).toContain('Druhý kvíz'); expect(host.querySelector('.event-readiness')?.textContent).not.toContain('Hotový kvíz');
});
it('offers a local retry when the selected quiz cannot be loaded', async () => {
  vi.mocked(getEditorQuiz).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(readyQuiz()); await render();
  expect(host.textContent).toContain('Kvíz se nepodařilo načíst'); expect(prepareButton().disabled).toBe(true);
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Zkusit znovu')!.click());
  expect(host.querySelector('[data-preflight-status]')?.getAttribute('data-preflight-status')).toBe('READY'); expect(prepareButton().disabled).toBe(false);
});
