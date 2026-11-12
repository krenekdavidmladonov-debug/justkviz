// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RefereePage } from '../apps/web/src/routes/referee/RefereePage';
import { historyReferee, readReferee, writeRefereeRound, type Credential, type RefereeEvent } from '../apps/web/src/features/referee/api';
import type { RoundScoreResponse } from '../apps/web/src/features/scoring/api';
import type { ScoreHistory } from '../apps/web/src/features/scoring/model';

vi.mock('../apps/web/src/features/referee/api', () => ({ readReferee: vi.fn(), writeRefereeRound: vi.fn(), historyReferee: vi.fn() }));
vi.mock('../apps/web/src/features/scoring/api', () => ({ saveRoundScores: vi.fn(), loadHistory: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const storageKey = (id: string) => `referee-access-v1:${id}`;
const credential = (id: string): Credential => ({ eventId: id, accessId: `access-${id}`, key: id.repeat(43) });
const view = (id: string): RefereeEvent => ({ eventId: id, title: `Event ${id}`, label: 'Synthetic referee', snapshotId: `snapshot-${id}`, rounds: [{ id: 'round', title: `Round ${id}` }], teams: [{ id: `team-${id}`, name: `Team ${id}` }], scores: [] });
let host: HTMLDivElement;
let root: Root;
let router: ReturnType<typeof createMemoryRouter>;
const read = vi.mocked(readReferee), write = vi.mocked(writeRefereeRound), history = vi.mocked(historyReferee);
const confirmMock = vi.fn(() => false);

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  confirmMock.mockReset().mockReturnValue(false);
  vi.stubGlobal('confirm', confirmMock);
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  sessionStorage.clear();
  for (const id of ['a', 'b']) sessionStorage.setItem(storageKey(id), JSON.stringify(credential(id)));
  window.history.replaceState({}, '', '/referee/a');
  read.mockReset().mockImplementation(c => Promise.resolve(view(c.eventId)));
  write.mockReset().mockImplementation((c) => Promise.resolve({ scores: [{ teamId: `team-${c.eventId}`, revision: 1, halfPoints: 2 }] }));
  history.mockReset().mockResolvedValue([]);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); router?.dispose(); host.remove(); sessionStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function render() {
  router = createMemoryRouter([{ path: '/referee/:eventId', element: <RefereePage /> }], { initialEntries: ['/referee/a'] });
  await act(async () => root.render(<RouterProvider router={router} />));
}
async function navigate(id: string) { await act(async () => { await router.navigate(`/referee/${id}`); }); }
async function input(id: string, value = '1') {
  const field = host.querySelector<HTMLInputElement>(`input[aria-label="Body — Team ${id}"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function click(label: string) { await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === label)!.click()); }
const teamInput = (id: string) => host.querySelector<HTMLInputElement>(`input[aria-label="Body — Team ${id}"]`);

it('loads B credentials and event state after clean same-route navigation, and submits matching event/credential IDs', async () => {
  await render(); await navigate('b');
  expect(read).toHaveBeenLastCalledWith(credential('b'));
  expect(host.textContent).toContain('Event b');
  expect(teamInput('a')).toBeNull();
  expect(teamInput('b')?.disabled).toBe(false);
  await input('b'); await click('Uložit body celého kola');
  expect(write).toHaveBeenCalledWith(credential('b'), expect.objectContaining({ eventId: 'b', snapshotId: 'snapshot-b', roundId: 'round' }));
  expect(sessionStorage.getItem(storageKey('b'))).toBe(JSON.stringify(credential('b')));
});

it('does not render A roster when the next event has no credential', async () => {
  await render(); await navigate('missing');
  expect(host.textContent).toContain('Přístup vypršel / byl odebrán');
  expect(host.querySelector('form')).toBeNull();
  expect(host.textContent).not.toContain('Event a');
  expect(read).toHaveBeenCalledTimes(1);
});

for (const outcome of ['resolve', 'reject'] as const) {
  it(`ignores an old A poll ${outcome} after loading event B`, async () => {
    const old = deferred<RefereeEvent>(); read.mockReturnValueOnce(old.promise);
    await render(); await navigate('b');
    await act(async () => { if (outcome === 'resolve') old.resolve(view('a')); else old.reject({ code: 'functions/permission-denied' }); });
    expect(host.textContent).toContain('Event b');
    expect(host.querySelector('[role=alert]')).toBeNull();
    expect(sessionStorage.getItem(storageKey('b'))).toBe(JSON.stringify(credential('b')));
  });
}

it('ignores stale A history failure after A → B → A and preserves the newly loaded A credential', async () => {
  const old = deferred<ScoreHistory[]>(); history.mockReturnValueOnce(old.promise);
  await render(); await click('Historie změn');
  await navigate('b'); await navigate('a');
  await act(async () => old.reject({ code: 'functions/permission-denied' }));
  expect(host.querySelector('[role=alert]')).toBeNull();
  expect(teamInput('a')?.disabled).toBe(false);
  expect(sessionStorage.getItem(storageKey('a'))).toBe(JSON.stringify(credential('a')));
  await input('a'); await click('Uložit body celého kola');
  expect(write).toHaveBeenCalledWith(credential('a'), expect.objectContaining({ eventId: 'a' }));
});

it('does not show history data from A in B after a late successful history response', async () => {
  const old = deferred<ScoreHistory[]>(); history.mockReturnValueOnce(old.promise);
  await render(); await click('Historie změn'); await navigate('b');
  await act(async () => old.resolve([{ revision: 1, halfPoints: 2, previousHalfPoints: null, actorLabel: 'Old A actor', createdAt: '2026-11-02', reason: 'Old A history' }]));
  expect(teamInput('b')?.disabled).toBe(false);
  expect(host.textContent).not.toContain('Old A actor');
  expect(host.textContent).not.toContain('Old A history');
});

it('does not consume B fragment credentials until dirty navigation is confirmed', async () => {
  await render(); await input('a', '2');
  const replacement = { ...credential('b'), key: 'z'.repeat(43) };
  window.history.replaceState({}, '', `/referee/b#access=${replacement.accessId}&key=${replacement.key}`);
  await navigate('b');
  expect(router.state.location.pathname).toBe('/referee/a');
  expect(teamInput('a')?.value).toBe('2');
  expect(read).toHaveBeenCalledTimes(1);
  expect(sessionStorage.getItem(storageKey('b'))).toBe(JSON.stringify(credential('b')));
  expect(window.location.hash).toContain(replacement.key);
  confirmMock.mockReturnValue(true);
  await navigate('b');
  expect(router.state.location.pathname).toBe('/referee/b');
  expect(read).toHaveBeenLastCalledWith(replacement);
  expect(teamInput('b')?.value).toBe('');
  expect(sessionStorage.getItem(storageKey('b'))).toBe(JSON.stringify(replacement));
  expect(window.location.hash).toBe('');
});

it('blocks pending navigation without confirmation, then permits B only after A write is acknowledged', async () => {
  const pending = deferred<RoundScoreResponse>(); write.mockReturnValueOnce(pending.promise);
  await render(); await input('a'); await click('Uložit body celého kola');
  confirmMock.mockReturnValue(true);
  await navigate('b');
  expect(router.state.location.pathname).toBe('/referee/a');
  expect(confirmMock).not.toHaveBeenCalled();
  expect(read).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve({ scores: [{ teamId: 'team-a', halfPoints: 2, revision: 1 }] }));
  await navigate('b');
  expect(read).toHaveBeenLastCalledWith(credential('b'));
  expect(teamInput('b')?.value).toBe('');
  expect(host.textContent).not.toContain('Potvrzeno serverem.');
});

it('keeps revocation effective for the current scope', async () => {
  history.mockRejectedValueOnce({ code: 'functions/permission-denied' });
  await render(); await click('Historie změn');
  expect(sessionStorage.getItem(storageKey('a'))).toBeNull();
  expect(host.textContent).toContain('Přístup vypršel / byl odebrán');
  expect(teamInput('a')?.disabled).toBe(true);
});
