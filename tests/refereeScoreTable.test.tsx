// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ScoreRow } from '../apps/web/src/features/scoring/ScoreRow';
import { loadHistory, saveScore } from '../apps/web/src/features/scoring/api';
import type { Score } from '../apps/web/src/features/scoring/model';

vi.mock('../apps/web/src/features/scoring/api', () => ({ saveScore: vi.fn(), loadHistory: vi.fn() }));
let host: HTMLDivElement, root: Root;
const onDirty = vi.fn();
const confirm = vi.fn(() => true);
const missing: Score = { halfPoints: null, revision: 0 };
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks();
  vi.mocked(saveScore).mockReset(); vi.mocked(loadHistory).mockReset().mockResolvedValue([]);
  confirm.mockReset().mockReturnValue(true); window.confirm = confirm;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function render(stored = missing, disabled = false) {
  await act(async () => root.render(<table><thead><tr><th>Kolo</th><th>Body</th><th>Uložení</th></tr></thead><ScoreRow eventId="e" snapshotId="s" teamId="team" roundId="round" name="Filmoví nadšenci" roundLabel="2. kolo — Soundtracky" layout="round-table" dirtyKey="round" stored={stored} disabled={disabled} onDirty={onDirty} /></table>));
}
async function input(label: string, value: string) {
  const field = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const points = () => host.querySelector<HTMLInputElement>('input[aria-label="Body — 2. kolo — Soundtracky"]');
async function click(label: string) { await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === label)!.click()); }
const reason = (value: string) => input('Důvod opravy — 2. kolo — Soundtracky', value);
const value = (text: string) => input('Body — 2. kolo — Soundtracky', text);

it('renders one compact three-cell round row and treats zero as an explicit saved value', async () => {
  await render();
  expect(host.querySelectorAll('tbody > tr')).toHaveLength(1);
  expect(host.querySelector('tbody')?.getAttribute('data-round-id')).toBe('round');
  expect(host.querySelector('tbody > tr')?.children).toHaveLength(3);
  expect(points()?.value).toBe('');
  expect(host.textContent).not.toContain('revize');
  expect(host.textContent).not.toContain('Historie');
  await value('0'); expect(onDirty).toHaveBeenLastCalledWith('round', true);
  vi.mocked(saveScore).mockResolvedValue({ halfPoints: 0, revision: 1 });
  await click('Uložit');
  expect(saveScore).toHaveBeenCalledWith(expect.objectContaining({ teamId: 'team', roundId: 'round', halfPoints: 0 }));
  expect(points()).toBeNull();
  expect(host.querySelector('.score-round-value')?.textContent).toBe('0');
  expect(host.textContent).toContain('Uloženo');
  expect(host.textContent).toContain('Potvrzeno serverem');
  expect(onDirty).toHaveBeenLastCalledWith('round', false);
});

it('locks existing points until explicit edit and requires a reason for the correction', async () => {
  await render({ halfPoints: 5, revision: 1 });
  expect(points()).toBeNull(); expect(host.textContent).not.toContain('Důvod opravy');
  await click('Upravit'); expect(points()?.value).toBe('2,5');
  await value('3'); await click('Uložit');
  expect(saveScore).not.toHaveBeenCalled(); expect(host.textContent).toContain('Doplňte stručný důvod');
  await reason('Opravený součet');
  vi.mocked(saveScore).mockResolvedValue({ halfPoints: 6, revision: 2 });
  await click('Uložit');
  expect(saveScore).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 1, halfPoints: 6, reason: 'Opravený součet' }));
  expect(points()).toBeNull(); expect(host.querySelector('.score-round-value')?.textContent).toBe('3');
});

it('preserves a draft through conflicts and requires an explicit decision before correcting the current score', async () => {
  await render(); await value('3');
  vi.mocked(saveScore).mockRejectedValueOnce({ code: 'functions/aborted', details: { revision: 2, halfPoints: 9 } });
  await click('Uložit');
  expect(points()?.value).toBe('3'); expect(host.textContent).toContain('4,5 bodů');
  await click('Uložit'); expect(saveScore).toHaveBeenCalledTimes(1);
  await click('Připravit opravu uložených bodů'); await reason('Překontrolováno');
  vi.mocked(saveScore).mockResolvedValue({ halfPoints: 6, revision: 3 });
  await click('Uložit');
  expect(saveScore).toHaveBeenLastCalledWith(expect.objectContaining({ expectedRevision: 2, halfPoints: 6 }));
});

it('reuses the original request after a lost response even if polling observes its committed value', async () => {
  await render(); await value('0');
  vi.mocked(saveScore).mockRejectedValueOnce({ code: 'functions/unavailable' }); await click('Uložit');
  const original = vi.mocked(saveScore).mock.calls[0]![0];
  await render({ halfPoints: 0, revision: 1 });
  expect(points()?.value).toBe('0'); expect(host.textContent).not.toContain('Potvrzeno serverem');
  vi.mocked(saveScore).mockResolvedValue({ halfPoints: 0, revision: 1 }); await click('Uložit');
  expect(vi.mocked(saveScore).mock.calls[1]![0]).toEqual(original);
  expect(host.textContent).toContain('Potvrzeno serverem');
});

it('rejects empty and quarter-point writes and requires a reason and team-round confirmation before clearing', async () => {
  await render(); await value(''); await click('Uložit'); await value('0.25'); await click('Uložit');
  expect(saveScore).not.toHaveBeenCalled();
  await render({ halfPoints: 0, revision: 1 });
  await click('Zahodit změny'); await click('Upravit'); await click('Vrátit na nezadáno');
  expect(saveScore).not.toHaveBeenCalled();
  await reason('Chybný tým');
  confirm.mockReturnValueOnce(false); await click('Vrátit na nezadáno');
  expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining('Filmoví nadšenci za kolo „2. kolo — Soundtracky“'));
  expect(saveScore).not.toHaveBeenCalled();
  vi.mocked(saveScore).mockResolvedValue({ halfPoints: null, revision: 2 }); await click('Vrátit na nezadáno');
  expect(saveScore).toHaveBeenCalledWith(expect.objectContaining({ halfPoints: null, reason: 'Chybný tým' }));
  expect(points()?.value).toBe(''); expect(host.querySelector('.score-round-saved')).toBeNull();
});

it('keeps pending work dirty and prevents duplicate writes while awaiting confirmation', async () => {
  let finish!: (score: Score) => void;
  vi.mocked(saveScore).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await render(); await value('1'); await click('Uložit');
  expect(onDirty).toHaveBeenLastCalledWith('round', true); expect(points()?.disabled).toBe(true);
  await click('Ukládám…'); expect(saveScore).toHaveBeenCalledTimes(1);
  await act(async () => finish({ halfPoints: 2, revision: 1 }));
  expect(onDirty).toHaveBeenLastCalledWith('round', false);
  expect(host.textContent).toContain('Uloženo');
});

it('loads history only through the expandable details without exposing technical revisions by default', async () => {
  await render({ halfPoints: 0, revision: 1 });
  expect(loadHistory).not.toHaveBeenCalled(); expect(host.querySelector('tr.score-round-details')).toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Podrobnosti — 2. kolo — Soundtracky"]')!.click());
  expect(host.querySelector('tr.score-round-details td')?.getAttribute('colspan')).toBe('3');
  await click('Historie změn'); expect(loadHistory).toHaveBeenCalledWith('e', 'team', 'round');
  expect(host.textContent).toContain('Žádné zápisy.');
});
