// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { loadRounds, watchRoster, watchScores, watchScoringEvent } from '../apps/web/src/features/scoring/api';
import { AdminEventScoringPage } from '../apps/web/src/routes/admin/AdminEventScoringPage';

vi.mock('../apps/web/src/auth/AuthProvider', () => ({ useAuth: () => ({ can: (permission: string) => permission === 'event.score' }) }));

vi.mock('../apps/web/src/features/scoring/api', () => ({
  loadRounds: vi.fn<typeof loadRounds>(async () => [{ id: 'r1', title: 'První' }, { id: 'r2', title: 'Druhé' }]),
  watchScoringEvent: vi.fn<typeof watchScoringEvent>((_id, receive) => { receive('s', true, 'Akce'); return () => undefined; }),
  watchRoster: vi.fn<typeof watchRoster>((_id, receive) => { receive([{ id: 't', name: 'Tým', accepted: true }]); return () => undefined; }),
  watchScores: vi.fn<typeof watchScores>((_id, receive) => { receive({}); return () => undefined; }),
  saveScore: vi.fn(), loadHistory: vi.fn(),
}));
let host: HTMLDivElement, root: Root;
let router: ReturnType<typeof createMemoryRouter>;
beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.confirm = vi.fn(() => false);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); router.dispose(); host.remove(); });

async function openScoring(eventId: string) {
  router = createMemoryRouter([
    { path: '/admin/events/:eventId/scoring', element: <AdminEventScoringPage /> },
    { path: '/admin/events/:eventId', element: <p>Detail</p> },
  ], { initialEntries: [`/admin/events/${eventId}/scoring`] });
  await act(async () => root.render(<RouterProvider router={router} />));
}

it('protects unsaved values on round changes, route navigation and browser unload', async () => {
  await openScoring('e');
  const input = host.querySelector('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '2,5');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const select = host.querySelector('select')!;
  await act(async () => { select.value = 'r2'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(select.value).toBe('r1'); expect(input.value).toBe('2,5');
  const unload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true);
  await act(async () => router.navigate('/admin/events/e'));
  expect(router.state.location.pathname).toBe('/admin/events/e/scoring');
  expect(input.value).toBe('2,5');
  await act(async () => router.navigate('/admin/events/b/scoring'));
  expect(router.state.location.pathname).toBe('/admin/events/e/scoring');
  expect(input.value).toBe('2,5');
  window.confirm = vi.fn(() => true);
  await act(async () => { select.value = 'r2'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(select.value).toBe('r2'); expect(host.querySelector('input')!.value).toBe('');
  await act(async () => router.navigate('/admin/events/e'));
  expect(router.state.location.pathname).toBe('/admin/events/e');
});

it('scopes scoring to the new event before any of its subscriptions resolve', async () => {
  const stopA = vi.fn();
  vi.mocked(loadRounds).mockImplementation(async snapshotId => [{ id: 'r', title: 'Kolo ' + snapshotId }]);
  vi.mocked(watchScoringEvent).mockImplementation((eventId, receive) => {
    if (eventId === 'a') receive('snímek A', true, 'Večer A');
    return eventId === 'a' ? stopA : () => undefined;
  });
  vi.mocked(watchRoster).mockImplementation((eventId, receive) => {
    if (eventId === 'a') receive([{ id: 't', name: 'Tým A', accepted: true }]);
    return eventId === 'a' ? stopA : () => undefined;
  });
  const scoreKey = JSON.stringify(['t', 'r']);
  vi.mocked(watchScores).mockImplementation((eventId, receive) => {
    if (eventId === 'a') receive({ [scoreKey]: { halfPoints: 3, revision: 1 } });
    return eventId === 'a' ? stopA : () => undefined;
  });
  await openScoring('a');
  expect(host.textContent).toContain('Večer A');
  expect(host.textContent).toContain('Tým A');
  expect(host.querySelector('input')?.value).toBe('1,5');
  await act(async () => router.navigate('/admin/events/b/scoring'));

  const assertWaiting = () => {
    expect(router.state.location.pathname).toBe('/admin/events/b/scoring');
    expect(host.textContent).toContain('Načítám bodování akce…');
    expect(host.textContent).not.toContain('Večer A');
    expect(host.textContent).not.toContain('Tým A');
    expect(host.querySelector('form')).toBeNull();
  };
  assertWaiting();
  expect(stopA).toHaveBeenCalledTimes(3);
  const receiveEventA = vi.mocked(watchScoringEvent).mock.calls[0]![1];
  const receiveRosterA = vi.mocked(watchRoster).mock.calls[0]![1];
  const receiveScoresA = vi.mocked(watchScores).mock.calls[0]![1];
  await act(async () => {
    receiveEventA('snímek A', true, 'Pozdní večer A');
    receiveRosterA([{ id: 't', name: 'Pozdní tým A', accepted: true }]);
    receiveScoresA({ [scoreKey]: { halfPoints: 20, revision: 2 } });
  });
  assertWaiting();

  const [eventB, receiveEventB] = vi.mocked(watchScoringEvent).mock.calls[1]!;
  const [rosterEventB, receiveRosterB] = vi.mocked(watchRoster).mock.calls[1]!;
  const [scoresEventB, receiveScoresB] = vi.mocked(watchScores).mock.calls[1]!;
  expect([eventB, rosterEventB, scoresEventB]).toEqual(['b', 'b', 'b']);
  await act(async () => {
    receiveEventB('snímek B', true, 'Večer B');
    receiveRosterB([{ id: 't', name: 'Tým B', accepted: true }]);
    receiveScoresB({ [scoreKey]: { halfPoints: 9, revision: 1 } });
  });
  expect(host.textContent).toContain('Večer B');
  expect(host.textContent).toContain('Tým B');
  expect(host.textContent).toContain('Kolo snímek B');
  expect(host.querySelector('input')?.value).toBe('4,5');
  expect(vi.mocked(loadRounds).mock.calls).toEqual([['snímek A'], ['snímek B']]);

  const draft = host.querySelector('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(draft, '6');
    draft.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => receiveEventB('nový snímek B', true, 'Večer B'));
  expect(host.textContent).toContain('Připravený kvíz akce se změnil.');
  expect(host.textContent).toContain('Kolo snímek B');
  expect(host.querySelector('input')).toBe(draft);
  expect(draft.value).toBe('6');
  expect(draft.disabled).toBe(true);
  expect(vi.mocked(loadRounds).mock.calls).toEqual([['snímek A'], ['snímek B']]);
});
