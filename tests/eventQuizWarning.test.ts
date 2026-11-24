import { describe, expect, it } from 'vitest';
import { needsEventQuiz } from '../apps/web/src/features/events/EventQuizWarning';
import { eventFormRecord } from './browser/events-form-ux.data';

const now = Date.parse('2030-03-30T12:00:00Z');
const day = 86400000;
const event = (delta = day) => ({ ...eventFormRecord(), startsAt: new Date(now + delta) });
describe('upcoming event without a quiz', () => {
  it('includes the exact seven-day boundary across daylight saving, but never the past', () => {
    for (const delta of [0, 1, day, 7 * day]) expect(needsEventQuiz(event(delta), now)).toBe(true);
    for (const delta of [-1, -day, 7 * day + 1]) expect(needsEventQuiz(event(delta), now)).toBe(false);
    expect(needsEventQuiz({ ...event(), startsAt: new Date(NaN) }, now)).toBe(false);
  });
  it('only warns for active preparation and an absent assignment', () => {
    for (const lifecycleStatus of ['draft', 'scheduled', 'ready'] as const) expect(needsEventQuiz({ ...event(), lifecycleStatus }, now)).toBe(true);
    for (const lifecycleStatus of ['live', 'finalizing', 'completed', 'cancelled', 'archived'] as const) expect(needsEventQuiz({ ...event(), lifecycleStatus }, now)).toBe(false);
    for (const disposition of ['archived', 'trash', 'deleting'] as const) expect(needsEventQuiz({ ...event(), disposition }, now)).toBe(false);
    expect(needsEventQuiz({ ...event(), quizAssignment: { quizId: 'quiz', quizRevision: 1, snapshotId: 'snapshot', quizTitle: 'Kvíz', roundCount: 1, questionCount: 1, lockedAt: new Date(now) } }, now)).toBe(false);
  });
});
