import { eventDisposition } from '@filmovy-kviz/quiz-domain';
import { eventCapacity, isPastEvent } from '../events/eventPresentation';
import type { EventRecord } from '../events/types';
import type { QuizSummary } from '../quizzes/types';

export function dashboardEvents(events: readonly EventRecord[], now = Date.now()) {
  const visible = events.filter(event => !['trash', 'deleting'].includes(eventDisposition(event)));
  const upcoming = visible.filter(event => event.registrationPublished && !isPastEvent(event, now))
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const preparing = visible.filter(event => !event.registrationPublished && eventDisposition(event) === 'active'
    && ['draft', 'scheduled', 'ready'].includes(event.lifecycleStatus))
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const historical = visible.filter(event => event.registrationPublished && isPastEvent(event, now))
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
  const totals = upcoming.reduce((sum, event) => {
    const capacity = eventCapacity(event);
    return { teams: sum.teams + event.acceptedTeams, freeTeams: sum.freeTeams + (capacity.freeTeams ?? 0) };
  }, { teams: 0, freeTeams: 0 });
  return { upcoming, preparing, historical, totals };
}

export function dashboardDrafts(quizzes: readonly QuizSummary[], limit: number) {
  return quizzes.filter(quiz => quiz.status === 'draft' && quiz.disposition !== 'trash')
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).slice(0, limit);
}

export const eventLifecycleLabels: Record<EventRecord['lifecycleStatus'], string> = {
  draft: 'Koncept', scheduled: 'Naplánováno', ready: 'Připraveno', live: 'Probíhá', finalizing: 'Uzavírání',
  completed: 'Dokončeno', cancelled: 'Zrušeno', archived: 'Archivováno',
};
