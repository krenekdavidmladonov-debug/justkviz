// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScoreRow } from '../apps/web/src/features/scoring/ScoreRow';
import { saveScore } from '../apps/web/src/features/scoring/api';
import type { Score } from '../apps/web/src/features/scoring/model';

vi.mock('../apps/web/src/features/scoring/api', () => ({ saveScore: vi.fn(), loadHistory: vi.fn().mockResolvedValue([]) }));
let host: HTMLDivElement, root: Root;
const onDirty = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  window.confirm = vi.fn(() => true);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
async function render(stored: Score = { revision: 0, halfPoints: null }) {
  await act(async () => root.render(<ScoreRow eventId="e" snapshotId="s" teamId="t" roundId="r" name="Test tým" stored={stored} disabled={false} onDirty={onDirty} />));
}
async function input(index: number, value: string) {
  const element = host.querySelectorAll('input')[index]!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function click(label: string) {
  const button = Array.from(host.querySelectorAll('button')).find(item => item.textContent === label)!;
  await act(async () => button.click());
}
describe('score entry UI', () => {
  it('requires explicit save, preserves typing across remote changes and requires a conflict decision', async () => {
    await render(); await input(0, '2,5');
    expect(saveScore).not.toHaveBeenCalled();
    await render({ revision: 1, halfPoints: 4 });
    expect(host.querySelector('input')!.value).toBe('2,5');
    expect(host.textContent).toContain('Aktuálně uloženo: 2 body');
    await click('Uložit'); expect(saveScore).not.toHaveBeenCalled();
    await click('Připravit opravu aktuální revize');
    await click('Uložit'); expect(saveScore).not.toHaveBeenCalled();
    await input(1, 'Přepočet');
    vi.mocked(saveScore).mockResolvedValue({ revision: 2, halfPoints: 5 });
    await click('Uložit');
    expect(saveScore).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 1, halfPoints: 5, reason: 'Přepočet' }));
    expect(host.textContent).toContain('Uložení potvrzeno serverem.');
  });
  it('retains draft and request ID after lost response, with no optimistic confirmation', async () => {
    await render(); await input(0, '0');
    vi.mocked(saveScore).mockRejectedValueOnce({ code: 'functions/unavailable' });
    await click('Uložit');
    const first = vi.mocked(saveScore).mock.calls[0]![0];
    expect(host.querySelector('input')!.value).toBe('0');
    expect(host.textContent).not.toContain('Uložení potvrzeno serverem.');
    await render({ revision: 1, halfPoints: 0 });
    // The stream may confirm a commit whose callable response was lost. Retry must still be possible.
    expect(host.textContent).toContain('Změněno');
    vi.mocked(saveScore).mockResolvedValue({ revision: 1, halfPoints: 0 });
    await click('Uložit');
    expect(vi.mocked(saveScore).mock.calls[1]![0]).toEqual(first);
    expect(host.textContent).toContain('Uložení potvrzeno serverem.');
  });
  it('rejects empty/quarter-point edits and requires reason and confirmation for clear', async () => {
    await render({ revision: 3, halfPoints: 0 });
    await input(0, ''); await click('Uložit'); expect(saveScore).not.toHaveBeenCalled();
    await input(0, '0.25'); await click('Uložit'); expect(saveScore).not.toHaveBeenCalled();
    await click('Vrátit na nezadáno'); expect(saveScore).not.toHaveBeenCalled();
    await input(1, 'Chybně zapsaný tým');
    window.confirm = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    await click('Vrátit na nezadáno'); expect(saveScore).not.toHaveBeenCalled();
    vi.mocked(saveScore).mockResolvedValue({ revision: 4, halfPoints: null });
    await click('Vrátit na nezadáno');
    expect(saveScore).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 3, halfPoints: null }));
    expect(host.textContent).toContain('Nezadáno');
  });
  it('keeps draft and reports current server value on an aborted write', async () => {
    await render(); await input(0, '3');
    vi.mocked(saveScore).mockRejectedValue({ code: 'functions/aborted', details: { revision: 2, halfPoints: 9 } });
    await click('Uložit');
    expect(host.querySelector('input')!.value).toBe('3');
    expect(host.textContent).toContain('4,5 bodu');
    expect(host.textContent).toContain('Konflikt');
  });
});
