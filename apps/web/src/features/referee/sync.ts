import type { RefereeEvent, RefereeRead } from './api';

/** The caller owns the cursor; unchanged authorizations reuse the score array. */
export function applyRefereeRead(previous: RefereeEvent | null, response: RefereeRead): RefereeEvent {
  if (response.sync !== 'delta' && response.sync !== 'unchanged') return response as RefereeEvent;
  if (!previous) throw new Error('Nejprve je potřeba načíst celý přehled bodování.');
  const { scores: changes, cursor, sync, ...metadata } = response;
  void cursor; void sync;
  if (!changes.length) {
    return Object.entries(metadata).every(([key, value]) => previous[key as keyof RefereeEvent] === value)
      ? previous : { ...previous, ...metadata };
  }
  const scores = new Map(previous.scores.map(score => [JSON.stringify([score.teamId, score.roundId]), score]));
  for (const score of changes) scores.set(JSON.stringify([score.teamId, score.roundId]), score);
  return { ...previous, ...metadata, scores: [...scores.values()] };
}
