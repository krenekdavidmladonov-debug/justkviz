import { eventDisposition } from '@filmovy-kviz/quiz-domain';
import type { EventRecord } from './types';

/** Seven elapsed days, including the boundary; elapsed starts are never upcoming. */
export function needsEventQuiz(event: Pick<EventRecord, 'startsAt' | 'lifecycleStatus' | 'disposition' | 'quizAssignment'>, now = Date.now()): boolean {
  const remaining = event.startsAt.getTime() - now;
  return eventDisposition(event) === 'active'
    && ['draft', 'scheduled', 'ready'].includes(event.lifecycleStatus)
    && !event.quizAssignment && Number.isFinite(remaining)
    && remaining >= 0 && remaining <= 7 * 24 * 60 * 60 * 1000;
}

export function EventQuizWarning({ event, now }: { readonly event: EventRecord; readonly now?: number }) {
  if (!needsEventQuiz(event, now)) return null;
  return <p className="event-quiz-warning"><strong>Chybí kvíz</strong><span>Akce začíná do 7 dní. Přiřaďte kvíz v detailu akce.</span></p>;
}
