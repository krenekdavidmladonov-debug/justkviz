// @vitest-environment happy-dom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { LiveControlPage } from '../apps/web/src/routes/admin/LiveControlPage';
import { subscribeLiveControl, subscribeLiveControlSlides } from '../apps/web/src/features/live/liveRepository';
import type { LiveControlSlide, LiveControlState } from '../apps/web/src/features/live/types';

const access = vi.hoisted(() => ({ manage: false }));
vi.mock('../apps/web/src/auth/AuthProvider', () => ({ useAuth: () => ({ can: (permission: string) => permission === 'event.manage' && access.manage }) }));

const invoke = vi.hoisted(() => vi.fn<(name: string, payload: Record<string, unknown>) => Promise<{ data: { revision: number } }>>());
vi.mock('firebase/functions', () => ({ httpsCallable: (_functions: unknown, name: string) => (payload: Record<string, unknown>) => invoke(name, payload) }));
vi.mock('../apps/web/src/services/firebase/client', () => ({ getFirebaseServices: () => ({ functions: {} }) }));
vi.mock('../apps/web/src/features/events/localEventMediaApi', () => ({ localEventMediaAvailable: () => false }));
vi.mock('../apps/web/src/features/live/liveRepository', () => ({
  subscribeLiveControl: vi.fn(), subscribeLiveControlSlides: vi.fn(), subscribePublicLiveState: () => () => {},
}));

const slides: LiveControlSlide[] = ['question', 'question', 'end'].map((kind, index) => ({
  id: `slide-${index}`, position: index + 1, kind, isQuestion: kind === 'question',
  title: `Snímek ${index + 1}`, text: '', options: [], media: [], presentation: {},
}));
function session(sessionId: string): LiveControlState {
  return {
    sessionId, quizId: `quiz-${sessionId}`, quizTitle: `Kvíz ${sessionId}`, revision: 10,
    slideCount: slides.length, status: 'active', currentSlidePosition: 1, answerRevealed: false,
    presentationMode: 'slide', mediaCommand: 'idle', mediaPlaybackState: 'idle', mediaGeneration: 0, introGeneration: 0,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

let host: HTMLDivElement, root: Root;
const records = new Map<string, LiveControlState>();
const path = (id: string) => `/admin/live/${id}`;
const next = () => host.querySelector<HTMLButtonElement>('button[title^="Další"]')!;
const previous = () => host.querySelector<HTMLButtonElement>('button[title^="Předchozí"]')!;
async function mount() {
  const router = createMemoryRouter([{ path: '/admin/live/:sessionId', element: <LiveControlPage /> }], { initialEntries: [path('A')] });
  await act(async () => root.render(<RouterProvider router={router} />));
  return router;
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('BroadcastChannel', undefined);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  access.manage = false;
  records.set('A', session('A'));
  records.set('B', { ...session('B'), revision: 11 });
  vi.mocked(subscribeLiveControl).mockImplementation((id, value) => { value(records.get(id) ?? null); return () => {}; });
  vi.mocked(subscribeLiveControlSlides).mockImplementation((_id, value) => { value(slides); return () => {}; });
  invoke.mockReset().mockResolvedValue({ data: { revision: 12 } });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

test('a late finale hide cannot dispatch the follow-up Previous after switching sessions', async () => {
  records.set('A', { ...session('A'), eventId: 'event-A', snapshotId: 'snapshot-A', currentSlidePosition: 3,
    finalReveal: { versionId: 'a'.repeat(64), visible: true, mode: 'table', rank: null, revealedCount: 1, totalGroups: 1, page: 0, pageCount: 1 },
  });
  const hide = deferred<{ data: { revision: number } }>();
  invoke.mockReturnValueOnce(hide.promise);
  const router = await mount();
  await act(async () => previous().click());
  expect(invoke).toHaveBeenCalledExactlyOnceWith('controlFinalReveal', expect.objectContaining({ action: 'hide', sessionId: 'A', expectedRevision: 10 }));

  await act(async () => { await router.navigate(path('B')); });
  expect(host.querySelector('h1')?.textContent).toBe('Kvíz B');
  await act(async () => hide.resolve({ data: { revision: 11 } }));
  expect(invoke).toHaveBeenCalledTimes(1);
});

test('an unresolved write in A neither blocks B nor clears its busy controls on settlement', async () => {
  const a = deferred<{ data: { revision: number } }>();
  const b = deferred<{ data: { revision: number } }>();
  invoke.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  const router = await mount();
  await act(async () => next().click());
  expect(invoke).toHaveBeenCalledExactlyOnceWith('goToSlide', { sessionId: 'A', expectedRevision: 10, direction: 1 });

  await act(async () => { await router.navigate(path('B')); });
  expect(next().disabled).toBe(false);
  await act(async () => next().click());
  expect(invoke).toHaveBeenLastCalledWith('goToSlide', { sessionId: 'B', expectedRevision: 11, direction: 1 });
  expect(next().disabled).toBe(true);
  await act(async () => a.resolve({ data: { revision: 11 } }));
  expect(next().disabled).toBe(true);
  await act(async () => b.resolve({ data: { revision: 12 } }));
  expect(next().disabled).toBe(false);
});

test('a late finale preview cannot start the old finale or unlock the new preview', async () => {
  for (const id of ['A', 'B']) {
    records.set(id, { ...records.get(id)!, eventId: `event-${id}`, snapshotId: `snapshot-${id}`, currentSlidePosition: 2 });
  }
  type PreviewReply = { data: { revision: number; complete: boolean; sessionRevision: number } };
  const a = deferred<PreviewReply>();
  const b = deferred<PreviewReply>();
  invoke.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  const router = await mount();
  await act(async () => next().click());
  await act(async () => { await router.navigate(path('B')); });
  await act(async () => next().click());
  expect(invoke.mock.calls).toEqual([
    ['previewFinalResults', { sessionId: 'A', eventId: 'event-A' }],
    ['previewFinalResults', { sessionId: 'B', eventId: 'event-B' }],
  ]);
  await act(async () => a.resolve({ data: { revision: 10, complete: true, sessionRevision: 10 } }));
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(next().disabled).toBe(true);
  await act(async () => b.resolve({ data: { revision: 11, complete: true, sessionRevision: 11 } }));
  expect(invoke).toHaveBeenLastCalledWith('controlFinalReveal', expect.objectContaining({ action: 'start', sessionId: 'B', expectedRevision: 11 }));
});

test('one click and one shortcut before React rerenders only dispatch one Next', async () => {
  await mount();
  await act(async () => {
    next().click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  });
  expect(invoke).toHaveBeenCalledExactlyOnceWith('goToSlide', { sessionId: 'A', expectedRevision: 10, direction: 1 });
});

test('a standard moderator ends a bound quiz without completing its event', async () => {
  records.set('A', { ...session('A'), eventId: 'event-A', snapshotId: 'snapshot-A' });
  await mount();
  const end = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Ukončit kvíz')!;
  await act(async () => end.click());
  expect(invoke).toHaveBeenCalledExactlyOnceWith('endLiveSession', { sessionId: 'A', expectedRevision: 10 });
  expect(host.textContent).toContain('Akci dokončí správce');
  expect(host.textContent).not.toContain('Dokončit akci a ukončit kvíz');
});

test('ending a standalone rehearsal keeps the existing presentation-only request', async () => {
  await mount();
  const end = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Ukončit kvíz')!;
  await act(async () => end.click());
  expect(invoke).toHaveBeenCalledExactlyOnceWith('endLiveSession', { sessionId: 'A', expectedRevision: 10 });
});

test('event managers explicitly choose event completion separately from ending the quiz', async () => {
  access.manage = true;
  records.set('A', { ...session('A'), eventId: 'event-A', snapshotId: 'snapshot-A' });
  await mount();
  const complete = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Dokončit akci a ukončit kvíz')!;
  expect(host.textContent).not.toContain('Akci dokončí správce');
  await act(async () => complete.click());
  expect(invoke).toHaveBeenCalledExactlyOnceWith('endLiveSession', { sessionId: 'A', expectedRevision: 10, completeEvent: true });
});

test('event managers can still end only the quiz', async () => {
  access.manage = true;
  records.set('A', { ...session('A'), eventId: 'event-A', snapshotId: 'snapshot-A' });
  await mount();
  const end = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Ukončit kvíz')!;
  await act(async () => end.click());
  expect(invoke).toHaveBeenCalledExactlyOnceWith('endLiveSession', { sessionId: 'A', expectedRevision: 10 });
});
