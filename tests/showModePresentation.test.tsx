// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ShowCue } from '../packages/quiz-domain/src/show-mode';
import { ShowModeRenderer } from '../apps/web/src/features/show-mode/ShowModeRenderer';
import { shouldAnimateShowCue } from '../apps/web/src/features/show-mode/useShowMotion';
import type { PublicLiveState } from '../apps/web/src/features/live/types';

vi.mock('../apps/web/src/features/media/AssetImage', () => ({ AssetImage: ({ source, alt }: { source: string; alt: string }) => <span data-asset-source={source}>{alt}</span> }));
const versionId = 'a'.repeat(64);
const row = (rank: number, teamName = 'Pelíšky') => ({ rank, teamName, halfPoints: 89 });
function cue(patch: Partial<ShowCue> = {}): ShowCue { return { id: 'b'.repeat(64), kind: 'third', motion: 'animate', intensity: 'subtle', topThree: true, winnerAnimation: true, startedAt: 100000, durationMs: 2000, ...patch }; }
function state(patch: Partial<PublicLiveState> = {}): PublicLiveState { return { sessionId: 'synthetic-show', quizTitle: 'Filmový večer', status: 'active', slidePosition: 8, options: [], media: [], presentation: {}, presentationMode: 'slide', renderMode: 'question', mediaCommand: 'idle', mediaPlaybackState: 'idle', mediaGeneration: 0, introGeneration: 0, answerRevealed: false, revision: 1, ...patch }; }
function group(patch: Partial<NonNullable<PublicLiveState['finalReveal']>> = {}): NonNullable<PublicLiveState['finalReveal']> { return { versionId, mode: 'group', rank: 3, page: 0, pageCount: 1, groupSize: 1, rows: [row(3)], presentationStyle: 'show', pageSize: 6, ...patch }; }
const mounted: Root[] = [];
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); });
afterEach(async () => { for (const root of mounted.splice(0)) await act(async () => root.unmount()); document.body.replaceChildren(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('approved show presentation', () => {
  test('interim uses only the server page and previous-publication movements', () => {
    const html = renderToStaticMarkup(<ShowModeRenderer state={state({ interimResults: { versionId, roundNumber: 3, page: 1, pageCount: 2, presentationStyle: 'show', pageSize: 6, rows: [{ ...row(6, 'Klub rváčů'), movement: 2 }, row(7, 'Poslední skauti')] }, interimBackdrop: { renderMode: 'question', slideKind: 'question', title: 'Filmové dvojice', text: 'Syntetická otázka', options: ['A', 'B'] } })} />);
    expect(html).toContain('Průběžné výsledky'); expect(html).toContain('Filmové dvojice'); expect(html).toContain('Klub rváčů'); expect(html).toContain('↑ 2'); expect(html).toContain('44,5'); expect(html).toContain('Strana 2 / 2');
    expect(html).not.toContain('SPRÁVNÁ ODPOVĚĎ'); expect(html).not.toContain('VÍTĚZOVÉ');
  });
  test('final third place contains only its group and explicitly supplied lower history', () => {
    const html = renderToStaticMarkup(<ShowModeRenderer state={state({ finalReveal: group({ history: { page: 0, pageCount: 2, pageSize: 6, rows: [row(4, 'Obvyklí podezřelí'), row(5, 'Krotitelé otazníků')] } }) })} />);
    expect(html).toContain('Pelíšky'); expect(html).toContain('Obvyklí podezřelí'); expect(html).toContain('Strana 1 / 2'); expect(html).not.toContain('Až naprší'); expect(html).not.toContain('Páni kluci');
  });
  test('one through six long co-winners retain every complete name and page indication', () => {
    for (let count = 1; count <= 6; count++) {
      const names = Array.from({ length: count }, (_, index) => `Společný vítěz ${index + 1} s opravdu dlouhým názvem týmu a filmovým příběhem`);
      const html = renderToStaticMarkup(<ShowModeRenderer state={state({ finalReveal: group({ rank: 1, groupSize: count > 5 ? 10 : count, pageCount: count > 5 ? 2 : 1, rows: names.map(name => row(1, name)) }) })} />);
      for (const name of names) expect(html).toContain(name);
      expect(html).toContain(`sm-count-${count}`); expect(html).toContain('VÍTĚZOVÉ DNEŠNÍHO VEČERA');
      if (count > 5) expect(html).toContain('Strana 1 / 2');
      else expect(html).not.toContain('Strana 1 / 1');
      expect(html).not.toContain('POSTUPNÉ ODHALOVÁNÍ');
      expect(html).not.toContain('sm-trophy');
      expect(html).not.toContain('sm-celebration');
    }
  });
  test('template title, subtitle, colors and custom logo survive the show renderer', () => {
    const html = renderToStaticMarkup(<ShowModeRenderer state={state({ finalReveal: group({ mode: 'intro', rank: null, groupSize: 0, rows: [] }), title: 'Naše finále', subtitle: 'Naše zakončení', design: { backgroundColor: '#123456', textColor: '#eee', accentColor: '#fedcba', logoImage: 'https://example.test/logo.png', backgroundImage: 'https://example.test/bg.png' } })} />);
    for (const value of ['Naše finále', 'Naše zakončení', '#123456', '#fedcba', 'https://example.test/logo.png', 'https://example.test/bg.png']) expect(html).toContain(value);
  });
  test('lower bulk and completed table use their supplied page; normal slides use children', () => {
    for (const mode of ['lower', 'table'] as const) expect(renderToStaticMarkup(<ShowModeRenderer state={state({ finalReveal: group({ mode, rank: null, groupSize: 0, rows: [row(7, 'Už odhalení')] }) })} />)).toContain('Už odhalení');
    expect(renderToStaticMarkup(<ShowModeRenderer state={state()}><div>Původní slide</div></ShowModeRenderer>)).toBe('<div>Původní slide</div>');
  });
});

describe('motion follows fresh authoritative cues only', () => {
  const previous = { sessionId: 's', revision: 3, cueId: 'a'.repeat(64) }, next = { sessionId: 's', revision: 4, cueId: 'b'.repeat(64) };
  test('fresh transition can animate, first load, reconnect/remount, old cue and repeats cannot', () => {
    expect(shouldAnimateShowCue(previous, next, cue(), 100001, false)).toBe(true);
    for (const [prior, observed, sound, now, reduced] of [
      [undefined, next, cue(), 100001, false], [previous, { ...next, sessionId: 'another' }, cue(), 100001, false],
      [{ ...previous, cueId: cue().id }, next, cue(), 100001, false], [previous, { ...next, revision: 3 }, cue(), 100001, false],
      [previous, next, cue(), 103000, false], [previous, next, cue(), 99000, false], [previous, next, cue(), 100001, true],
      [previous, next, cue({ motion: 'static' }), 100001, false], [previous, next, cue({ intensity: 'none' }), 100001, false],
      [previous, next, cue({ topThree: false }), 100001, false], [previous, next, cue({ kind: 'winners', winnerAnimation: false }), 100001, false],
    ] as const) expect(shouldAnimateShowCue(prior, observed, sound, now, reduced)).toBe(false);
  });
  test('mounted renderer skips first cue, animates a fresh update and stops on server skip without audio', async () => {
    vi.useFakeTimers(); vi.setSystemTime(100001);
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host); mounted.push(root);
    const first = state({ finalReveal: group(), showCue: cue() });
    await act(async () => root.render(<ShowModeRenderer state={first} />));
    expect(host.querySelector('.sm-static')).not.toBeNull();
    const fresh = { ...first, revision: 2, showCue: cue({ id: 'c'.repeat(64) }) };
    await act(async () => root.render(<ShowModeRenderer state={fresh} />));
    expect(host.querySelector('.sm-animate')).not.toBeNull();
    await act(async () => root.render(<ShowModeRenderer state={{ ...fresh, revision: 3, showCue: { ...fresh.showCue, motion: 'static' } }} />));
    expect(host.querySelector('.sm-static')).not.toBeNull(); expect(play).not.toHaveBeenCalled();
    await act(async () => root.render(<ShowModeRenderer state={state({ revision: 4 })}><span>Stejný slide</span></ShowModeRenderer>));
    await act(async () => root.render(<ShowModeRenderer state={{ ...fresh, revision: 5 }} />));
    expect(host.querySelector('.sm-static')).not.toBeNull();
  });
});
