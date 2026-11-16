// @vitest-environment happy-dom
import React, { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { DemoFinalePreview } from '../apps/web/src/features/final-reveal/DemoFinalePreview';

const boundary = vi.hoisted(() => ({ services: vi.fn(), activePlayers: 0, playerMounts: 0, playerProps: vi.fn() }));
vi.mock('../apps/web/src/services/firebase/client', () => ({ getFirebaseServices: boundary.services }));
vi.mock('../apps/web/src/features/presentation/YouTubePlayer', () => ({ YouTubePlayer: (props: { source: string; command: string; onFinished?: () => void }) => {
  boundary.playerProps(props);
  useEffect(() => { boundary.activePlayers++; boundary.playerMounts++; return () => { boundary.activePlayers--; }; }, []);
  return <div data-demo-audio-source={props.source} data-command={props.command} />;
} }));

let host: HTMLDivElement, root: Root, mounted: boolean;
const closed = vi.fn();
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2030-10-20T18:00:00Z')); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn()); boundary.services.mockReset(); boundary.playerProps.mockReset(); boundary.activePlayers = 0; boundary.playerMounts = 0; closed.mockReset();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); mounted = true;
});
afterEach(async () => { if (mounted) await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function render() {
  function Parent() { const [open, setOpen] = useState(true); return open ? <DemoFinalePreview onClose={() => { closed(); setOpen(false); }} /> : <p>Náhled uzavřen</p>; }
  await act(async () => root.render(<Parent />));
}
const advance = async (duration: number) => act(async () => { await vi.advanceTimersByTimeAsync(duration); });
const button = (name: string) => [...host.querySelectorAll('button')].find(item => item.textContent === name)!;
const click = async (name: string) => act(async () => button(name).click());
async function reachWinner() { await advance(50); for (let index = 0; index < 6; index++) await click('Další krok'); }

 test('uses actual animations and reveals every sample rank exclusively through clicks without cloud calls', async () => {
  await render(); expect(host.textContent).toContain('NÁHLED · UKÁZKOVÉ ÚDAJE');
  expect(host.querySelector('dialog')?.open).toBe(true); expect(document.activeElement?.textContent).toBe('Zavřít náhled');
  await advance(50); expect(host.querySelector('.sm-intro')).not.toBeNull(); expect(host.querySelector('.sm-animate')).not.toBeNull();
  expect(button('Pozastavit')).toBeUndefined(); expect(button('Pokračovat')).toBeUndefined();
  await advance(120000); expect(host.querySelector('.sm-intro')).not.toBeNull();
  for (const rank of [6, 5, 4, 3, 2]) {
    await click('Další krok'); expect(host.querySelector('.sm-feature-number')?.textContent).toBe(`${rank}.`);
    await advance(120000); expect(host.querySelector('.sm-feature-number')?.textContent).toBe(`${rank}.`);
  }
  await click('Další krok'); expect(host.querySelector('.sm-winner-names')?.textContent).toBe('Filmoví nadšenci');
  await advance(120000); expect(host.querySelector('.sm-winner-names')?.textContent).toBe('Filmoví nadšenci'); expect(boundary.activePlayers).toBe(0);
  await click('Další krok'); expect(host.querySelector('[aria-label="Konečné pořadí"]')).not.toBeNull();
  expect(host.querySelectorAll('.sm-final-table .sm-row')).toHaveLength(6); expect(button('Další krok').disabled).toBe(true);
  expect(boundary.services).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});

 test('restarts with a fresh animated intro and remains there until the next click', async () => {
  await render(); await advance(50); const firstCue = host.querySelector('[data-show-cue]')?.getAttribute('data-show-cue');
  await click('Další krok'); expect(host.querySelector('.sm-feature-number')?.textContent).toBe('6.');
  await click('Přehrát znovu'); expect(host.querySelector('.sm-intro')).not.toBeNull(); expect(host.querySelector('.sm-animate')).not.toBeNull();
  expect(host.querySelector('[data-show-cue]')?.getAttribute('data-show-cue')).not.toBe(firstCue);
  await advance(120000); expect(host.querySelector('.sm-intro')).not.toBeNull(); expect(vi.getTimerCount()).toBe(0);
});

 test('keeps the same winner music player running through the table, until its own end or close', async () => {
  await render(); await act(async () => host.querySelector<HTMLInputElement>('.demo-finale-music input')!.click());
  await reachWinner(); expect(boundary.activePlayers).toBe(1); expect(boundary.playerMounts).toBe(1);
  const player = host.querySelector('[data-demo-audio-source]'); expect(player?.getAttribute('data-demo-audio-source')).toContain('04854XqcfCY');
  await click('Další krok'); expect(host.querySelector('[aria-label="Konečné pořadí"]')).not.toBeNull();
  expect(host.querySelector('[data-demo-audio-source]')).toBe(player); expect(boundary.activePlayers).toBe(1); expect(boundary.playerMounts).toBe(1);
  expect(player?.getAttribute('data-command')).toBe('play');
  const props = boundary.playerProps.mock.lastCall?.[0] as { onFinished?: () => void };
  await act(async () => props.onFinished?.()); expect(player?.getAttribute('data-command')).toBe('stop');
  await click('Zavřít náhled'); expect(closed).toHaveBeenCalledOnce(); expect(boundary.activePlayers).toBe(0); expect(vi.getTimerCount()).toBe(0);
});

 test('stops optional winner music on restart or when the music checkbox is cleared', async () => {
  await render(); await act(async () => host.querySelector<HTMLInputElement>('.demo-finale-music input')!.click());
  await reachWinner(); expect(boundary.activePlayers).toBe(1);
  await act(async () => host.querySelector<HTMLInputElement>('.demo-finale-music input')!.click()); expect(boundary.activePlayers).toBe(0);
  await act(async () => host.querySelector<HTMLInputElement>('.demo-finale-music input')!.click()); expect(boundary.activePlayers).toBe(1);
  await click('Přehrát znovu'); expect(boundary.activePlayers).toBe(0); expect(host.querySelector('.sm-intro')).not.toBeNull();
  expect(boundary.services).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});

 test('contains keyboard events and returns focus to the opener after native Escape cancellation', async () => {
  const opener = document.createElement('button'); document.body.append(opener); opener.focus();
  const globalKey = vi.fn(); document.addEventListener('keydown', globalKey);
  try {
    await render(); const dialog = host.querySelector('dialog')!;
    await act(async () => dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })));
    expect(globalKey).not.toHaveBeenCalled(); expect(boundary.services).not.toHaveBeenCalled();
    await act(async () => dialog.dispatchEvent(new Event('cancel', { cancelable: true })));
    expect(closed).toHaveBeenCalledOnce(); expect(document.activeElement).toBe(opener); expect(vi.getTimerCount()).toBe(0);
  } finally { document.removeEventListener('keydown', globalKey); opener.remove(); }
});

 test('unmounting before the initial frame cancels all future work', async () => {
  await render(); await act(async () => root.unmount()); mounted = false;
  expect(vi.getTimerCount()).toBe(0); await advance(120000); expect(boundary.services).not.toHaveBeenCalled(); expect(boundary.activePlayers).toBe(0);
});
