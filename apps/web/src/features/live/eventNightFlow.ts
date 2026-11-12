import { visibleSlidePosition, type FinalRevealState } from '@filmovy-kviz/quiz-domain';
import type { LiveControlSlide } from './types';

/** A derived presentation step, never an edit of an event's frozen questions. */
export function entersFinale(slides: readonly LiveControlSlide[], position: number, direction: 1 | -1): boolean {
  const target = visibleSlidePosition(slides, position, direction);
  if (direction === -1) return slides.find(slide => slide.position === position)?.kind.toLowerCase() === 'end';
  return target === undefined
    ? slides.some(slide => slide.position === position && slide.kind.toLowerCase() !== 'end')
    : slides.find(slide => slide.position === target)?.kind.toLowerCase() === 'end';
}

export function nextFinaleStep(state: FinalRevealState): { action: 'page' | 'reveal' | 'table'; page?: number } | undefined {
  if (!state.visible) return undefined;
  if (state.mode === 'table') return state.pageCount > 1 ? { action: 'page', page: (state.page + 1) % state.pageCount } : undefined;
  if (state.page + 1 < state.pageCount) return { action: 'page', page: state.page + 1 };
  return { action: state.revealedCount < state.totalGroups ? 'reveal' : 'table' };
}
