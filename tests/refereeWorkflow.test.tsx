// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RefereePage } from '../apps/web/src/routes/referee/RefereePage';
import { readReferee, writeRefereeRound, type RefereeEvent } from '../apps/web/src/features/referee/api';
import { forgetReferee } from '../apps/web/src/features/referee/sharing';
import type { RoundScoreResponse } from '../apps/web/src/features/scoring/api';

vi.mock('../apps/web/src/features/referee/api', () => ({ readReferee: vi.fn(), writeRefereeRound: vi.fn(), historyReferee: vi.fn().mockResolvedValue([]) }));
vi.mock('../apps/web/src/features/referee/sharing', () => ({ consumeRefereeCredential: () => ({ eventId: 'event', accessId: 'synthetic-access', key: 'synthetic-key' }), forgetReferee: vi.fn() }));
vi.mock('../apps/web/src/features/scoring/api', () => ({ saveRoundScores: vi.fn(), loadHistory: vi.fn() }));
let host: HTMLDivElement, root: Root;
const confirm = vi.fn<(message?: string) => boolean>();
function fixture(): RefereeEvent {
  return { eventId: 'event', title: 'Filmový večer', label: 'Rozhodčí', snapshotId: 'snapshot',
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
  vi.clearAllMocks(); vi.useFakeTimers(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
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
    expect(readReferee).toHaveBeenCalledTimes(1);
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
    expect(points('Beta').value).toBe('0'); expect(points('Beta').disabled).toBe(true); expect(host.textContent).not.toContain('Potvrzeno serverem.');
    const data = fixture(); data.scores = data.scores.filter(score => score.teamId !== 'b'); data.scores.push({ teamId: 'b', roundId: 'r1', revision: 3, halfPoints: 0 });
    vi.mocked(readReferee).mockResolvedValue(data); await poll();
    vi.mocked(writeRefereeRound).mockResolvedValue({ scores: [{ teamId: 'b', revision: 3, halfPoints: 0 }] });
    await click('Uložit body celého kola'); expect(vi.mocked(writeRefereeRound).mock.calls[1]![1]).toEqual(first); expect(host.textContent).toContain('Potvrzeno serverem.');
  });
  it('disables verified work offline and stops polling after capability revocation', async () => {
    await render(); await act(async () => window.dispatchEvent(new Event('offline'))); expect(points('Alfa').disabled).toBe(true);
    await act(async () => window.dispatchEvent(new Event('online'))); expect(points('Alfa').disabled).toBe(false);
    vi.mocked(readReferee).mockRejectedValue({ code: 'functions/permission-denied' }); await poll();
    expect(forgetReferee).toHaveBeenCalledWith('event'); expect(host.textContent).toContain('Přístup vypršel / byl odebrán'); expect(points('Alfa').disabled).toBe(true);
    const calls = vi.mocked(readReferee).mock.calls.length; await poll(); expect(readReferee).toHaveBeenCalledTimes(calls);
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
