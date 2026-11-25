// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RefereePage } from '../apps/web/src/routes/referee/RefereePage';
import { historyReferee, readReferee, writeRefereeRound, type RefereeEvent } from '../apps/web/src/features/referee/api';
import { applyRefereeRead } from '../apps/web/src/features/referee/sync';
import { forgetReferee } from '../apps/web/src/features/referee/sharing';
import type { RoundScoreResponse } from '../apps/web/src/features/scoring/api';

vi.mock('../apps/web/src/features/referee/api', () => ({ readReferee: vi.fn(), writeRefereeRound: vi.fn(), historyReferee: vi.fn().mockResolvedValue([]) }));
vi.mock('../apps/web/src/features/referee/sharing', async importOriginal => ({
  ...await importOriginal<typeof import('../apps/web/src/features/referee/sharing')>(),
  consumeRefereeAccess: () => ({ credential: { eventId: 'event', accessId: 'synthetic-access', key: 'synthetic-key' }, reason: null }), forgetReferee: vi.fn(), rememberReferee: vi.fn(),
}));
vi.mock('../apps/web/src/features/scoring/api', () => ({ saveRoundScores: vi.fn(), loadHistory: vi.fn() }));
let host: HTMLDivElement, root: Root;
let visibilityState: DocumentVisibilityState;
const confirm = vi.fn<(message?: string) => boolean>();
function fixture(): RefereeEvent {
  return { eventId: 'event', title: 'Filmový večer', label: 'Rozhodčí', expiresAt: '2026-11-23T13:00:00.000Z', snapshotId: 'snapshot',
    rounds: [{ id: 'r1', title: 'První kolo', questionCount: 10 }, { id: 'r2', title: 'Druhé kolo', questionCount: 5 }],
    teams: [{ id: 'a', name: 'Alfa' }, { id: 'c', name: 'Gama' }, { id: 'b', name: 'Beta' }],
    scores: [{ teamId: 'a', roundId: 'r1', halfPoints: 0, revision: 1 }, { teamId: 'b', roundId: 'r1', halfPoints: null, revision: 2 }, { teamId: 'c', roundId: 'r2', halfPoints: 5, revision: 1 }] };
}
const points = (team: string) => host.querySelector<HTMLInputElement>('input[aria-label="Body — ' + team + '"]')!;
async function input(team: string, value: string) {
  const element = points(team);
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); });
}
async function click(label: string) { await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === label)!.click()); }
async function select(id: string) { await act(async () => { const element = host.querySelector('select')!; element.value = id; element.dispatchEvent(new Event('change', { bubbles: true })); }); }
async function poll() { await act(async () => { await vi.advanceTimersByTimeAsync(5000); }); }
async function render(data = fixture()) {
  vi.mocked(readReferee).mockResolvedValue(data);
  const router = createMemoryRouter([{ path: '/referee/:eventId', element: <RefereePage /> }, { path: '/elsewhere', element: <p>Jiná stránka</p> }], { initialEntries: ['/referee/event'] });
  await act(async () => root.render(<RouterProvider router={router} />)); return router;
}
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-23T12:00:00Z')); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  visibilityState = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibilityState);
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true); window.confirm = confirm.mockReset().mockReturnValue(false);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('round-first referee workflow', () => {
  it('shows all teams for the selected round with one save and distinguishes zero from missing', async () => {
    await render();
    expect(host.querySelector('select')!.value).toBe('r1'); expect(host.querySelector('h2')!.textContent).toBe('První kolo');
    expect(points('Alfa').value).toBe('0'); expect(points('Beta').value).toBe(''); expect(points('Gama').value).toBe('');
    expect([...host.querySelectorAll('[data-team-id]')].map(team => team.getAttribute('data-team-id'))).toEqual(['a', 'c', 'b']);
    expect([...host.querySelectorAll('button')].filter(button => button.textContent === 'Uložit body celého kola')).toHaveLength(1);
    expect(host.textContent).toContain('1 / 3 týmů má uložené body');
    await select('r2'); expect(points('Gama').value).toBe('2,5'); expect(points('Alfa').value).toBe('');
  });
  it('sends changed teams in one request and displays acknowledged values immediately', async () => {
    await render(); await input('Beta', '2,5'); await input('Gama', '0');
    expect(writeRefereeRound).not.toHaveBeenCalled();
    vi.mocked(writeRefereeRound).mockResolvedValue({ scores: [{ teamId: 'b', revision: 3, halfPoints: 5 }, { teamId: 'c', revision: 1, halfPoints: 0 }] });
    await click('Uložit body celého kola');
    expect(writeRefereeRound).toHaveBeenCalledTimes(1);
    expect(writeRefereeRound).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ roundId: 'r1', scores: [
      { teamId: 'c', expectedRevision: 0, halfPoints: 0, reason: '' }, { teamId: 'b', expectedRevision: 2, halfPoints: 5, reason: '' },
    ] }));
    expect(host.textContent).toContain('Body kola jsou uložené. Potvrzeno serverem.');
    expect(host.textContent).toContain('3 / 3 týmů má uložené body');
    expect(readReferee).toHaveBeenCalledTimes(2);
  });
  it('warns on scores above the selected snapshot round count and saves only after confirmation', async () => {
    await render();
    const warning = 'Víc bodů než otázek v kole (10) – opravdu?';
    await input('Beta', '10'); await input('Gama', '10,5');
    expect(points('Beta').closest('.round-score-team')?.textContent).not.toContain(warning);
    expect(points('Gama').closest('.round-score-team')?.textContent).toContain(warning);
    await click('Uložit body celého kola');
    expect(confirm).toHaveBeenCalledExactlyOnceWith(warning + '\n\nGama');
    expect(writeRefereeRound).not.toHaveBeenCalled();
    expect(points('Gama').value).toBe('10,5');
    confirm.mockReturnValueOnce(true);
    vi.mocked(writeRefereeRound).mockResolvedValue({ scores: [
      { teamId: 'c', revision: 1, halfPoints: 21 }, { teamId: 'b', revision: 3, halfPoints: 20 },
    ] });
    await click('Uložit body celého kola');
    expect(writeRefereeRound).toHaveBeenCalledTimes(1);
    expect(host.textContent).not.toContain(warning);
    await select('r2'); await input('Beta', '5,5');
    expect(points('Beta').closest('.round-score-team')?.textContent).toContain('Víc bodů než otázek v kole (5) – opravdu?');
  });
  it('reports each invalid score at its team field and focuses the first in registration order', async () => {
    await render(); await input('Beta', '2,25'); await input('Gama', '-1');
    await click('Uložit body celého kola');
    for (const name of ['Beta', 'Gama']) {
      const field = points(name);
      expect(field.getAttribute('aria-invalid')).toBe('true');
      const feedback = document.getElementById(field.getAttribute('aria-describedby')!);
      expect(feedback?.parentElement).toBe(field.closest('.round-score-team'));
      expect(feedback?.textContent).toContain('Zadejte nezáporné body');
    }
    expect(document.activeElement).toBe(points('Gama'));
    expect(points('Alfa').getAttribute('aria-invalid')).toBeNull();
    expect(writeRefereeRound).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    await input('Gama', '2,5'); await click('Uložit body celého kola');
    expect(points('Gama').getAttribute('aria-invalid')).toBeNull();
    expect(document.activeElement).toBe(points('Beta'));
  });
  it('preserves a conflicted whole-round draft and protects round changes, navigation and unload', async () => {
    const router = await render(); await input('Beta', '4,5'); await input('Gama', '1');
    const data = fixture(); data.scores.push({ teamId: 'b', roundId: 'r1', halfPoints: 4, revision: 3 });
    data.scores = data.scores.filter(score => !(score.teamId === 'b' && score.revision === 2));
    vi.mocked(readReferee).mockResolvedValue(data); await poll();
    expect(points('Beta').value).toBe('4,5'); expect(host.textContent).toContain('Aktuálně uloženo: 2 body');
    await click('Uložit body celého kola'); expect(writeRefereeRound).not.toHaveBeenCalled();
    await select('r2'); expect(host.querySelector('select')!.value).toBe('r1');
    const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true);
    await act(async () => router.navigate('/elsewhere')); expect(router.state.location.pathname).toBe('/referee/event');
  });
  it('blocks round switches and navigation until the whole transaction is confirmed', async () => {
    const router = await render(); await input('Beta', '1');
    let finish!: (value: RoundScoreResponse) => void;
    vi.mocked(writeRefereeRound).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await click('Uložit body celého kola'); const confirm = vi.fn(() => true); window.confirm = confirm;
    expect(host.querySelector('select')!.disabled).toBe(true); expect(points('Gama').disabled).toBe(true);
    await act(async () => router.navigate('/elsewhere')); expect(router.state.location.pathname).toBe('/referee/event'); expect(confirm).not.toHaveBeenCalled();
    await act(async () => finish({ scores: [{ teamId: 'b', revision: 3, halfPoints: 2 }] }));
    expect(host.querySelector('select')!.disabled).toBe(false); await select('r2'); expect(host.querySelector('select')!.value).toBe('r2');
  });
  it('preserves and replays exactly the same round intent after a lost response', async () => {
    await render(); await input('Beta', '0'); vi.mocked(writeRefereeRound).mockRejectedValueOnce({ code: 'functions/unavailable' });
    await click('Uložit body celého kola'); const first = vi.mocked(writeRefereeRound).mock.calls[0]![1];
    expect(points('Beta').value).toBe('0'); expect(points('Beta').disabled).toBe(false); expect(host.textContent).not.toContain('Potvrzeno serverem.');
    const data = fixture(); data.scores = data.scores.filter(score => score.teamId !== 'b'); data.scores.push({ teamId: 'b', roundId: 'r1', revision: 3, halfPoints: 0 });
    vi.mocked(readReferee).mockResolvedValue(data); await poll();
    vi.mocked(writeRefereeRound).mockResolvedValue({ scores: [{ teamId: 'b', revision: 3, halfPoints: 0 }] });
    await click('Uložit body celého kola'); expect(vi.mocked(writeRefereeRound).mock.calls[1]![1]).toEqual(first); expect(host.textContent).toContain('Potvrzeno serverem.');
  });
  it('disables verified work offline and stops polling after capability revocation', async () => {
    await render(); await act(async () => window.dispatchEvent(new Event('offline'))); expect(points('Alfa').disabled).toBe(true);
    await act(async () => window.dispatchEvent(new Event('online'))); expect(points('Alfa').disabled).toBe(false);
    await input('Beta', '4,5');
    vi.mocked(readReferee).mockRejectedValue({ code: 'functions/permission-denied', details: { refereeAccess: 'revoked' } }); await poll();
    expect(forgetReferee).toHaveBeenCalledWith('event', expect.anything()); expect(host.textContent).toContain('Organizátor tento přístup odebral.'); expect(points('Alfa').disabled).toBe(true);
    expect(points('Beta').value).toBe('4,5');
    const calls = vi.mocked(readReferee).mock.calls.length; await poll(); expect(readReferee).toHaveBeenCalledTimes(calls);
  });
  it.each(['unavailable', 'internal', 'aborted', 'resource-exhausted', 'deadline-exceeded', 'failed-precondition', 'permission-denied', 'network-request-failed'])('keeps access and drafts through 15 minutes of %s errors and recovers', async code => {
    await render(); await input('Beta', '4,5');
    vi.mocked(readReferee).mockRejectedValue({ code: 'functions/' + code });
    await act(async () => { await vi.advanceTimersByTimeAsync(15 * 60000); });
    expect(readReferee).toHaveBeenCalledTimes(181);
    expect(forgetReferee).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('zkouším znovu');
    expect(points('Beta').value).toBe('4,5'); expect(points('Beta').disabled).toBe(false);
    vi.mocked(readReferee).mockResolvedValue(fixture()); await poll();
    expect(host.querySelector('[role="alert"]')).toBeNull(); expect(points('Beta').value).toBe('4,5');
  });
  it.each([
    ['expired', 'Platnost odkazu vypršela.'], ['not-found', 'Odkaz je neplatný nebo byl nahrazen novým.'],
    ['issuer-inactive', 'správce, který ho vydal, už nemá oprávnění.'], ['event-closed', 'Akce už není otevřená pro zápis bodů.'],
  ])('shows the specific terminal reason %s and retains drafts', async (reason, message) => {
    await render(); await input('Beta', '2,5');
    if (reason === 'expired') vi.setSystemTime(new Date(fixture().expiresAt));
    vi.mocked(readReferee).mockRejectedValue({ code: 'functions/permission-denied', details: { refereeAccess: reason } }); await poll();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(message);
    expect(forgetReferee).toHaveBeenCalledWith('event', expect.anything()); expect(points('Beta').value).toBe('2,5'); expect(points('Beta').disabled).toBe(true);
  });
  it('keeps access after nonaccepted-team history and write errors, including unclassified denial', async () => {
    await render(); await input('Beta', '2,5');
    const message = 'Tým už není na soupisce přijatých týmů.';
    vi.mocked(historyReferee).mockRejectedValueOnce({ code: 'functions/failed-precondition', message }); await click('Historie změn');
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(message);
    expect(forgetReferee).not.toHaveBeenCalled(); expect(points('Beta').disabled).toBe(false);
    vi.mocked(writeRefereeRound).mockRejectedValueOnce({ code: 'functions/permission-denied' }); await click('Uložit body celého kola');
    expect(forgetReferee).not.toHaveBeenCalled(); expect(points('Beta').value).toBe('2,5');
    await poll(); expect(points('Beta').disabled).toBe(false);
  });
  it('leaves revision conflicts to the form without showing a page banner', async () => {
    await render(); await input('Beta', '2,5');
    vi.mocked(writeRefereeRound).mockRejectedValueOnce({ code: 'functions/aborted' });
    await click('Uložit body celého kola');
    expect(host.querySelector('.referee-page > [role="alert"]')).toBeNull();
    expect(host.textContent).not.toContain('Spojení se serverem se nepodařilo ověřit');
    expect(points('Beta').value).toBe('2,5'); expect(points('Beta').disabled).toBe(false);
    expect(forgetReferee).not.toHaveBeenCalled();
    await poll(); expect(readReferee).toHaveBeenCalledTimes(2);
  });
  it('shows server validation errors without losing access or drafts', async () => {
    await render(); await input('Beta', '2,5');
    const message = 'Body patří k jiné akci než odkaz rozhodčího.';
    vi.mocked(writeRefereeRound).mockRejectedValueOnce({ code: 'functions/invalid-argument', message });
    await click('Uložit body celého kola');
    expect(host.querySelector('.referee-page > [role="alert"]')?.textContent).toBe(message);
    expect(points('Beta').value).toBe('2,5'); expect(points('Beta').disabled).toBe(false);
    expect(forgetReferee).not.toHaveBeenCalled();
  });
  it('explains voluntary access termination and stops polling', async () => {
    await render(); await click('Ukončit přístup v tomto panelu');
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Přístup v tomto panelu byl ukončen. Pro pokračování znovu otevřete odkaz nebo QR od organizátora.');
    expect(forgetReferee).toHaveBeenCalledWith('event', expect.anything());
    expect(host.querySelector('form')).toBeNull();
    await poll(); expect(readReferee).toHaveBeenCalledTimes(1);
  });
  it('shows an empty roster without an empty scoring form', async () => {
    await render({ ...fixture(), teams: [], scores: [] }); expect(host.textContent).toContain('Na soupisce zatím nejsou žádné týmy'); expect(host.querySelector('form')).toBeNull();
  });
  it('validates every changed team before sending and requires each correction reason', async () => {
    await render(); await input('Alfa', '3'); await input('Beta', '0.25');
    await click('Uložit body celého kola'); expect(writeRefereeRound).not.toHaveBeenCalled();
    await input('Beta', '0'); await click('Uložit body celého kola'); expect(writeRefereeRound).not.toHaveBeenCalled();
    const reason = host.querySelector<HTMLInputElement>('[data-team-id="a"] .round-score-reason input')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(reason, 'Přepočet'); reason.dispatchEvent(new Event('input', { bubbles: true })); });
    vi.mocked(writeRefereeRound).mockResolvedValue({ scores: [{ teamId: 'a', revision: 2, halfPoints: 6 }, { teamId: 'b', revision: 3, halfPoints: 0 }] });
    await click('Uložit body celého kola');
    expect(writeRefereeRound).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ scores: [
      { teamId: 'a', expectedRevision: 1, halfPoints: 6, reason: 'Přepočet' }, { teamId: 'b', expectedRevision: 2, halfPoints: 0, reason: '' },
    ] }));
  });
  it('requires an explicit clear intent, reason and confirmation to replace a saved zero with null', async () => {
    await render(); await input('Alfa', ''); await click('Uložit body celého kola');
    expect(writeRefereeRound).not.toHaveBeenCalled(); expect(host.textContent).toContain('Zadejte nezáporné body');
    await click('Vrátit na nezadáno'); await click('Uložit body celého kola'); expect(writeRefereeRound).not.toHaveBeenCalled();
    const reason = host.querySelector<HTMLInputElement>('[data-team-id="a"] .round-score-reason input')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(reason, 'Chybný tým'); reason.dispatchEvent(new Event('input', { bubbles: true })); });
    await click('Uložit body celého kola'); expect(writeRefereeRound).not.toHaveBeenCalled();
    window.confirm = vi.fn(() => true); vi.mocked(writeRefereeRound).mockResolvedValue({ scores: [{ teamId: 'a', revision: 2, halfPoints: null }] });
    await click('Uložit body celého kola');
    expect(writeRefereeRound).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ scores: [{ teamId: 'a', expectedRevision: 1, halfPoints: null, reason: 'Chybný tým' }] }));
    expect(points('Alfa').value).toBe('');
  });
  it('ignores a read started before a confirmed round write', async () => {
    await render(); let finishRead!: (value: RefereeEvent) => void;
    vi.mocked(readReferee).mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
    await poll(); await input('Beta', '0');
    vi.mocked(writeRefereeRound).mockResolvedValue({ scores: [{ teamId: 'b', revision: 3, halfPoints: 0 }] });
    await click('Uložit body celého kola');
    await act(async () => finishRead({ ...fixture(), scores: [{ teamId: 'a', roundId: 'r1', revision: 1, halfPoints: 0 }] }));
    expect(points('Beta').value).toBe('0'); expect(host.textContent).toContain('2 / 3 týmů má uložené body');
  });
});

it('removes cancelled referee teams after polling while preserving remaining unsaved points', async () => {
  await render();
  await input('Beta', '1');
  const next = fixture();
  next.teams = next.teams.filter(team => team.id !== 'a');
  next.scores = next.scores.filter(score => score.teamId !== 'a');
  vi.mocked(readReferee).mockResolvedValue(next);
  await poll();
  expect(points('Alfa')).toBeNull();
  expect(points('Beta').value).toBe('1');
  expect(points('Beta').disabled).toBe(false);
  vi.mocked(writeRefereeRound).mockResolvedValue({ scores: [{ teamId: 'b', revision: 3, halfPoints: 2 }] });
  await click('Uložit body celého kola');
  expect(writeRefereeRound).toHaveBeenCalledExactlyOnceWith(expect.anything(), expect.objectContaining({ scores: [{ teamId: 'b', expectedRevision: 2, halfPoints: 2, reason: '' }] }));
});


async function visibility(value: DocumentVisibilityState) {
  await act(async () => { visibilityState = value; document.dispatchEvent(new Event('visibilitychange')); });
}

describe('referee incremental synchronization', () => {
  it('merges changed cells and unchanged metadata without replacing other rounds or drafts', async () => {
    await render({ ...fixture(), sync: 'full', cursor: 'first' });
    await input('Beta', '4');
    vi.mocked(readReferee).mockResolvedValueOnce({ sync: 'delta', cursor: 'second', scores: [
      { teamId: 'b', roundId: 'r1', halfPoints: 2, revision: 3 },
      { teamId: 'c', roundId: 'r1', halfPoints: 0, revision: 1 },
    ] });
    await poll();
    expect(vi.mocked(readReferee).mock.calls.at(-1)?.[1]).toBe('first');
    expect(points('Beta').value).toBe('4');
    expect(points('Alfa').value).toBe('0');
    expect(points('Gama').value).toBe('0');
    expect(host.textContent).toContain('Aktuálně uloženo:');
    vi.mocked(readReferee).mockResolvedValueOnce({ sync: 'unchanged', cursor: 'third', scores: [], title: 'Nový název' });
    await poll();
    expect(vi.mocked(readReferee).mock.calls.at(-1)?.[1]).toBe('second');
    expect(host.textContent).toContain('Nový název');
    expect(points('Beta').value).toBe('4');
    expect(points('Gama').value).toBe('0');
  });

  it('accepts legacy full responses and reuses unchanged score arrays and metadata', () => {
    const previous = fixture();
    expect(applyRefereeRead(null, previous)).toBe(previous);
    expect(applyRefereeRead(previous, { sync: 'unchanged', cursor: 'next', scores: [] })).toBe(previous);
    const renamed = applyRefereeRead(previous, { sync: 'unchanged', cursor: 'next', scores: [], title: 'Nový název' });
    expect(renamed.title).toBe('Nový název');
    expect(renamed.scores).toBe(previous.scores);
  });
  it('does no hidden polling, retains drafts and catches up immediately on visibility', async () => {
    await render({ ...fixture(), sync: 'full', cursor: 'first' });
    await input('Beta', '3');
    await visibility('hidden');
    await act(async () => { await vi.advanceTimersByTimeAsync(120000); });
    expect(readReferee).toHaveBeenCalledTimes(1);
    vi.mocked(readReferee).mockResolvedValueOnce({ sync: 'delta', cursor: 'second', scores: [{ teamId: 'c', roundId: 'r1', halfPoints: 8, revision: 1 }] });
    await visibility('visible');
    expect(readReferee).toHaveBeenCalledTimes(2);
    expect(points('Beta').value).toBe('3');
    expect(points('Gama').value).toBe('4');
  });

  it('waits for first visibility when the page is initially hidden', async () => {
    visibilityState = 'hidden';
    await render();
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    expect(readReferee).not.toHaveBeenCalled();
    await visibility('visible');
    expect(readReferee).toHaveBeenCalledTimes(1);
    expect(points('Beta').disabled).toBe(false);
  });

  it.each(['resolve', 'reject'])('starts a fresh read immediately on return and ignores the old read %s', async outcome => {
    await render({ ...fixture(), sync: 'full', cursor: 'first' });
    let finish!: (value: RefereeEvent) => void, fail!: (error: unknown) => void;
    vi.mocked(readReferee).mockImplementationOnce(() => new Promise((resolve, reject) => { finish = resolve; fail = reject; }));
    await poll();
    await visibility('hidden');
    vi.mocked(readReferee).mockResolvedValueOnce({ sync: 'delta', cursor: 'third', scores: [{ teamId: 'c', roundId: 'r1', halfPoints: 6, revision: 1 }] });
    await visibility('visible');
    expect(readReferee).toHaveBeenCalledTimes(3);
    expect(vi.mocked(readReferee).mock.calls.at(-1)?.[1]).toBe('first');
    expect(points('Gama').value).toBe('3');
    await act(async () => {
      if (outcome === 'resolve') finish({ ...fixture(), sync: 'full', cursor: 'second' });
      else fail({ code: 'functions/permission-denied', details: { refereeAccess: 'revoked' } });
    });
    expect(points('Gama').value).toBe('3');
    expect(forgetReferee).not.toHaveBeenCalled();
    vi.mocked(readReferee).mockResolvedValueOnce({ sync: 'unchanged', cursor: 'fourth', scores: [] });
    await poll();
    expect(vi.mocked(readReferee).mock.calls.at(-1)?.[1]).toBe('third');
  });

  it('waits for an active save on visibility return and immediately catches up after acknowledgement', async () => {
    await render({ ...fixture(), sync: 'full', cursor: 'first' });
    await input('Beta', '3');
    let finish!: (value: RoundScoreResponse) => void;
    vi.mocked(writeRefereeRound).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await click('Uložit body celého kola');
    await visibility('hidden');
    await visibility('visible');
    expect(readReferee).toHaveBeenCalledTimes(1);
    vi.mocked(readReferee).mockResolvedValueOnce({ sync: 'delta', cursor: 'second', scores: [{ teamId: 'c', roundId: 'r1', halfPoints: 8, revision: 1 }] });
    await act(async () => finish({ scores: [{ teamId: 'b', halfPoints: 6, revision: 3 }] }));
    expect(readReferee).toHaveBeenCalledTimes(2);
    expect(vi.mocked(readReferee).mock.calls.at(-1)?.[1]).toBe('first');
    expect(points('Beta').value).toBe('3');
    expect(points('Gama').value).toBe('4');
  });
  it('refreshes with the previous cursor after saving, including a write acknowledged while hidden', async () => {
    await render({ ...fixture(), sync: 'full', cursor: 'first' });
    await input('Beta', '3');
    let finish!: (value: RoundScoreResponse) => void;
    vi.mocked(writeRefereeRound).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await click('Uložit body celého kola');
    await visibility('hidden');
    await act(async () => finish({ scores: [{ teamId: 'b', halfPoints: 6, revision: 3 }] }));
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(readReferee).toHaveBeenCalledTimes(1);
    vi.mocked(readReferee).mockResolvedValueOnce({ sync: 'delta', cursor: 'second', scores: [{ teamId: 'c', roundId: 'r1', halfPoints: 8, revision: 1 }] });
    await visibility('visible');
    expect(vi.mocked(readReferee).mock.calls.at(-1)?.[1]).toBe('first');
    expect(points('Beta').value).toBe('3');
    expect(points('Gama').value).toBe('4');
  });

  it('retains the old draft disabled when an incremental session changes epoch', async () => {
    await render({ ...fixture(), scoringEpoch: 0, sync: 'full', cursor: 'first' });
    await input('Beta', '3');
    vi.mocked(readReferee).mockResolvedValue({ ...fixture(), scoringEpoch: 1, sync: 'full', cursor: 'new-epoch' });
    await poll();
    expect(points('Beta').value).toBe('3');
    expect(points('Beta').disabled).toBe(true);
    await poll();
    expect(vi.mocked(readReferee).mock.calls.at(-1)).toHaveLength(1);
    expect(points('Beta').disabled).toBe(true);
    expect(writeRefereeRound).not.toHaveBeenCalled();
  });
});


it('retains removed-team drafts as copyable readonly rows and saves only current teams', async () => {
  await render();
  await input('Alfa', '3');
  await input('Beta', '2');
  const next = fixture();
  next.teams = next.teams.filter(team => team.id !== 'a');
  next.scores = next.scores.filter(score => score.teamId !== 'a');
  vi.mocked(readReferee).mockResolvedValue(next);
  await poll();
  const retained = () => host.querySelector<HTMLInputElement>('.referee-removed-drafts input')!;
  expect(points('Alfa')).toBeNull();
  expect(retained().value).toBe('3');
  expect(retained().readOnly).toBe(true);
  expect(retained().disabled).toBe(false);
  expect(host.textContent).toContain('nebudou se ukládat');
  expect(points('Beta').value).toBe('2');
  vi.mocked(writeRefereeRound).mockResolvedValue({ scores: [{ teamId: 'b', halfPoints: 4, revision: 3 }] });
  await click('Uložit body celého kola');
  expect(writeRefereeRound).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ scores: [{ teamId: 'b', expectedRevision: 2, halfPoints: 4, reason: '' }] }));
  expect(retained().value).toBe('3');
  expect([...host.querySelectorAll('button')].find(button => button.textContent === 'Uložit body celého kola')!.disabled).toBe(true);
});

it('keeps removed drafts mounted even after the last team leaves the roster', async () => {
  await render();
  await input('Beta', '3');
  vi.mocked(readReferee).mockResolvedValue({ ...fixture(), teams: [], scores: [] });
  await poll();
  expect(host.textContent).toContain('Na soupisce zatím nejsou žádné týmy');
  expect(host.querySelector<HTMLInputElement>('.referee-removed-drafts input')?.value).toBe('3');
  expect([...host.querySelectorAll('button')].find(button => button.textContent === 'Uložit body celého kola')!.disabled).toBe(true);
  expect(writeRefereeRound).not.toHaveBeenCalled();
});
