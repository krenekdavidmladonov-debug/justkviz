import { describe, expect, test } from 'vitest';
import { dashboardDrafts, dashboardEvents } from '../apps/web/src/features/dashboard/dashboardModel';
import type { EventRecord } from '../apps/web/src/features/events/types';
import type { QuizSummary } from '../apps/web/src/features/quizzes/types';

const now = Date.parse('2026-10-16T12:00:00Z');
const event = (id: string, patch: Partial<EventRecord> = {}): EventRecord => ({
  id, title: id, startsAt: new Date('2026-10-17T18:00:00Z'), timeZone: 'Europe/Prague', venue: { name: '', publicLocation: '' },
  lifecycleStatus: 'ready', registrationPublished: true, registrationStatus: 'open', teamCapacity: 10, peopleCapacity: 40,
  acceptedTeams: 2, acceptedPeople: 7, teamSizeMin: 2, teamSizeMax: 6, revision: 1,
  scoring: { unitScale: 2, rankingMode: 'dense', started: false }, ...patch,
});
describe('dashboard calendar and canonical counters', () => {
  test('keeps readiness independent of publication, omits trash and orders upcoming dates', () => {
    const result = dashboardEvents([event('later', { startsAt: new Date('2026-10-20T18:00:00Z') }), event('ready-hidden', { registrationPublished: false }),
      event('first'), event('trashed', { disposition: 'trash' }), event('deleting', { disposition: 'deleting' }),
      event('completed', { lifecycleStatus: 'completed' }), event('cancelled', { lifecycleStatus: 'cancelled' }),
      event('old', { startsAt: new Date('2026-10-15T18:00:00Z') }), event('live', { startsAt: new Date('2026-10-15T18:00:00Z'), lifecycleStatus: 'live' })], now);
    expect(result.upcoming.map(item => item.id)).toEqual(['live', 'first', 'later']);
    expect(result.preparing.map(item => item.id)).toEqual(['ready-hidden']);
    expect(result.historical.map(item => item.id)).toEqual(['completed', 'cancelled', 'old']);
  });
  test('totals use accepted team counters and expose only team capacity', () => {
    const first = event('one', { acceptedTeams: 2, acceptedPeople: 9 });
    const second = event('two', { acceptedTeams: 4, acceptedPeople: 11 });
    expect(dashboardEvents([first, second], now).totals).toEqual({ teams: 6, freeTeams: 14 });
    // The server decrements these canonical counters when a registration is cancelled.
    expect(dashboardEvents([{ ...first, acceptedTeams: 1, acceptedPeople: 5 }, second], now).totals)
      .toEqual({ teams: 5, freeTeams: 15 });
  });
  test('offers only real drafts, sorted by their update timestamp, with a strict item limit', () => {
    const quiz = (id: string, days: number, status: QuizSummary['status'] = 'draft') => ({ id, title: id, status, updatedAt: new Date(now + days * 86400000) } as QuizSummary);
    const quizzes = [quiz('old', -5), quiz('ready', 1, 'ready'), quiz('new', 0), { ...quiz('trash', 2), disposition: 'trash' as const }];
    expect(dashboardDrafts(quizzes, 1).map(item => item.id)).toEqual(['new']);
    expect(dashboardDrafts(quizzes, 3).map(item => item.id)).toEqual(['new', 'old']);
    expect(quizzes[0]?.id).toBe('old');
  });
});
