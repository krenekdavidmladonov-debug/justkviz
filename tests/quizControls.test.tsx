// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { FirebaseError } from 'firebase/app';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { QuizStatusControl } from '../apps/web/src/features/quizzes/QuizStatusControl';
import { QuizDetailPage } from '../apps/web/src/routes/admin/QuizDetailPage';
import { QuizPreflightPage } from '../apps/web/src/routes/admin/QuizPreflightPage';
import { getQuizDetail } from '../apps/web/src/features/quizzes/quizRepository';
import { getEditorQuiz } from '../apps/web/src/features/editor/editorRepository';
import { updateQuizMetadata } from '../apps/web/src/features/editor/editorApi';
import { createLiveSession } from '../apps/web/src/features/live/liveApi';
import type { QuizDetail } from '../apps/web/src/features/quizzes/types';

const access = vi.hoisted(() => ({ denied: [] as string[] }));
vi.mock('../apps/web/src/auth/AuthProvider', () => ({ useAuth: () => ({ can: (permission: string) => !access.denied.includes(permission) }) }));
vi.mock('../apps/web/src/features/quizzes/quizRepository', () => ({ getQuizDetail: vi.fn() }));
vi.mock('../apps/web/src/features/editor/editorRepository', () => ({ getEditorQuiz: vi.fn() }));
vi.mock('../apps/web/src/features/editor/editorApi', () => ({ updateQuizMetadata: vi.fn() }));
vi.mock('../apps/web/src/features/live/liveApi', () => ({ createLiveSession: vi.fn() }));

const quiz: QuizDetail = { id: 'quiz', title: 'Filmový večer', description: 'Popis', revision: 7, status: 'draft', roundCount: 1, questionCount: 1, rounds: [], createdAt: new Date(), updatedAt: new Date(), createdBy: 'test', updatedBy: 'test' };
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); access.denied = [];
  vi.mocked(getQuizDetail).mockReset().mockResolvedValue(quiz);
  vi.mocked(getEditorQuiz).mockReset().mockResolvedValue({ ...quiz, revision: 7, slideCount: 0, slides: [] });
  vi.mocked(createLiveSession).mockReset().mockResolvedValue({ sessionId: 'session', revision: 0, status: 'waiting', currentSlidePosition: 0, answerRevealed: false, presentationMode: 'slide', mediaGeneration: 0, mediaCommand: 'idle', mediaPlaybackState: 'idle' });
  vi.mocked(updateQuizMetadata).mockReset().mockResolvedValue({ quizId: quiz.id, revision: 8, slideCount: 1, questionCount: 1, roundCount: 1 });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render(element: React.ReactNode, path = '/admin/quizzes/quiz') {
  const router = createMemoryRouter([
    { path: '/admin/quizzes/:quizId', element },
    { path: '/admin/quizzes/:quizId/readiness', element },
    { path: '/admin/live/:sessionId', element: <p>Živé řízení</p> },
  ], { initialEntries: [path] });
  await act(async () => root.render(<RouterProvider router={router} />)); return router;
}
const button = (label: string) => [...host.querySelectorAll('button')].find(item => item.textContent === label)!;

it('marks a library quiz ready through the revision-protected metadata operation without a content check', async () => {
  const changed = vi.fn(); await render(<QuizStatusControl quiz={quiz} onChanged={changed} />);
  expect(host.querySelector('.quiz-status')?.textContent).toBe('Koncept');
  await act(async () => { button('Označit jako připravený').click(); button('Označit jako připravený').click(); });
  expect(updateQuizMetadata).toHaveBeenCalledTimes(1);
  expect(updateQuizMetadata).toHaveBeenCalledWith('quiz', 7, quiz.title, quiz.description, undefined, undefined, undefined, undefined, 'ready');
  expect(changed).toHaveBeenCalledTimes(1); expect(getEditorQuiz).not.toHaveBeenCalled();
});
it('can return a ready quiz to concepts and keeps archived status read-only', async () => {
  await render(<QuizStatusControl quiz={{ ...quiz, status: 'ready' }} onChanged={vi.fn()} />);
  await act(async () => button('Vrátit do konceptů').click());
  expect(vi.mocked(updateQuizMetadata).mock.lastCall?.[8]).toBe('draft');
  await render(<QuizStatusControl quiz={{ ...quiz, status: 'archived' }} onChanged={vi.fn()} />);
  expect(host.querySelector('button')).toBeNull(); expect(host.textContent).toContain('Archivovaný');
});
it('preserves the rendered status and does not reload after a failed mutation', async () => {
  const changed = vi.fn(); vi.mocked(updateQuizMetadata).mockRejectedValueOnce(new Error('stale'));
  await render(<QuizStatusControl quiz={quiz} onChanged={changed} />);
  await act(async () => button('Označit jako připravený').click());
  expect(changed).not.toHaveBeenCalled(); expect(host.querySelector('.quiz-status')?.textContent).toBe('Koncept');
  expect(host.querySelector('[role=alert]')?.textContent).toContain('Načtěte aktuální kvíz');
});
it('hides status editing without quiz.edit and respects disabled pending work', async () => {
  access.denied = ['quiz.edit']; await render(<QuizStatusControl quiz={quiz} onChanged={vi.fn()} />);
  expect(host.querySelector('button')).toBeNull();
  access.denied = []; await render(<QuizStatusControl quiz={quiz} disabled onChanged={vi.fn()} />);
  expect(button('Označit jako připravený').disabled).toBe(true); expect(updateQuizMetadata).not.toHaveBeenCalled();
});
it('starts directly from detail without reading editorial readiness and guards duplicate clicks', async () => {
  const router = await render(<QuizDetailPage />);
  expect(host.querySelector('a[href$="/readiness"]')?.textContent).toBe('Zkontrolovat připravenost');
  await act(async () => { button('Spustit kvíz').click(); button('Spustit kvíz').click(); });
  expect(createLiveSession).toHaveBeenCalledExactlyOnceWith('quiz'); expect(getEditorQuiz).not.toHaveBeenCalled();
  expect(router.state.location.pathname).toBe('/admin/live/session');
});
it('keeps optional check findings from gating start or demanding acknowledgement', async () => {
  const router = await render(<QuizPreflightPage />, '/admin/quizzes/quiz/readiness');
  expect(host.querySelector('[data-preflight-status]')?.getAttribute('data-preflight-status')).toBe('BLOCKED');
  expect(host.textContent).toContain('Kontrola je dobrovolná');
  expect(button('Spustit kvíz').disabled).toBe(false); expect(host.querySelector('[role=alertdialog]')).toBeNull();
  await act(async () => button('Spustit kvíz').click());
  expect(getEditorQuiz).toHaveBeenCalledTimes(1); expect(router.state.location.pathname).toBe('/admin/live/session');
});
it('keeps technical launch failure visible and stays on detail', async () => {
  vi.mocked(createLiveSession).mockRejectedValueOnce(new FirebaseError('functions/failed-precondition', 'Kvíz nemá uložené slidy.'));
  const router = await render(<QuizDetailPage />);
  await act(async () => button('Spustit kvíz').click());
  expect(router.state.location.pathname).toBe('/admin/quizzes/quiz');
  expect(host.textContent).toContain('Kvíz nemá přehratelné stránky');
  expect(host.textContent).not.toContain('Kvíz nemá uložené slidy');
  expect(button('Spustit kvíz').disabled).toBe(false);
});
it('does not offer launch without event.live permission', async () => {
  access.denied = ['event.live']; await render(<QuizDetailPage />);
  expect(button('Spustit kvíz')).toBeUndefined(); expect(createLiveSession).not.toHaveBeenCalled();
});
