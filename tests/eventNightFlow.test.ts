import { describe, expect, test } from 'vitest';
import { entersFinale, nextFinaleStep } from '../apps/web/src/features/live/eventNightFlow';
import type { LiveControlSlide } from '../apps/web/src/features/live/types';
import type { FinalRevealState } from '../packages/quiz-domain/src/index';

const slides = ['question', 'recap', 'end'].map((kind, index): LiveControlSlide => ({ id: String(index), position: index + 1, kind, isQuestion: kind === 'question', title: '', text: '', options: [], media: [], presentation: {} }));
const initial: FinalRevealState = { versionId: 'a'.repeat(64), visible: true, mode: 'intro', rank: null, revealedCount: 0, totalGroups: 3, page: 0, pageCount: 1, presentationStyle: 'show', pageSize: 6 };
describe('event finale is the step before the closing slide', () => {
  test('only intercepts crossing the final boundary, including previous from closing slide', () => {
    expect(entersFinale(slides, 1, 1)).toBe(false);
    expect(entersFinale(slides, 2, 1)).toBe(true);
    expect(entersFinale(slides, 3, -1)).toBe(true);
    expect(entersFinale(slides, 2, -1)).toBe(false);
    expect(entersFinale(slides, 3, 1)).toBe(false);
  });
  test('legacy quiz without an end slide still gets finale before session ending', () => {
    expect(entersFinale(slides.slice(0, 2), 2, 1)).toBe(true);
  });
  test('every tied group page is shown before the next rank', () => {
    expect(nextFinaleStep(initial)).toEqual({ action: 'reveal' });
    expect(nextFinaleStep({ ...initial, mode: 'group', rank: 2, revealedCount: 2, pageCount: 3 })).toEqual({ action: 'page', page: 1 });
    expect(nextFinaleStep({ ...initial, mode: 'group', rank: 2, revealedCount: 2, page: 2, pageCount: 3 })).toEqual({ action: 'reveal' });
  });
  test('table only follows the winner and paginates without changing ranks', () => {
    expect(nextFinaleStep({ ...initial, mode: 'group', rank: 1, revealedCount: 3 })).toEqual({ action: 'table' });
    expect(nextFinaleStep({ ...initial, mode: 'table', revealedCount: 3 })).toBeUndefined();
    expect(nextFinaleStep({ ...initial, mode: 'table', revealedCount: 3, page: 1, pageCount: 2 })).toEqual({ action: 'page', page: 0 });
    expect(nextFinaleStep({ ...initial, visible: false })).toBeUndefined();
  });
});
