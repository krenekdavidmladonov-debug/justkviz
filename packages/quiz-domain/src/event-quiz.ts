import { eventDisposition } from './event-management.js';

export interface ScoringRoundShape { readonly id: string; readonly questionCount: number }
export interface EventQuizChangeState {
  readonly hasActiveSession: boolean;
  readonly hasPresentedQuestion: boolean;
  readonly hasUnknownQuestionHistory?: boolean;
  readonly scoreDocumentCount: number;
  readonly snapshotRounds: readonly ScoringRoundShape[];
}

/** Missing generations belong to the original, pre-reset scoring generation. */
export function eventScoringEpoch(scoring: unknown): number {
  const value = scoring && typeof scoring === 'object' ? (scoring as { epoch?: unknown }).epoch : undefined;
  if (value === undefined) return 0;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value >= Number.MAX_SAFE_INTEGER) {
    throw new Error('Generace bodování není platná. Obnovte stránku nebo kontaktujte správce.');
  }
  return value;
}

export function eventQuizMutationProblem(event: { disposition?: unknown; lifecycleStatus?: unknown }, state: Pick<EventQuizChangeState, 'hasActiveSession' | 'hasPresentedQuestion' | 'hasUnknownQuestionHistory'>, action: 'version' | 'reset'): string | null {
  if (event.lifecycleStatus === 'completed') return action === 'version'
    ? 'Akce je dokončená, verzi kvízu už nelze měnit.' : 'Akce je dokončená, body už nelze smazat.';
  if (event.lifecycleStatus === 'cancelled') return 'Akce je zrušená. Nejprve ji vraťte do přípravy.';
  if (eventDisposition(event) !== 'active') return 'Akce je v archivu nebo v koši. Nejprve ji vraťte do aktivních akcí.';
  if (!['draft', 'scheduled', 'ready', 'live', 'finalizing'].includes(String(event.lifecycleStatus))) return 'Stav akce není platný. Obnovte stránku.';
  if (action === 'reset' && state.hasActiveSession) return 'Moderování je otevřené. Nejprve ho ukončete tlačítkem Ukončit kvíz.';
  if (action === 'version' && state.hasActiveSession && state.hasPresentedQuestion) return 'Kvíz právě běží a sál už viděl otázky. Verzi nelze změnit. Nejprve ukončete moderování tlačítkem Ukončit kvíz.';
  if (action === 'version' && state.hasActiveSession && state.hasUnknownQuestionHistory) return 'Starší moderování neobsahuje údaje o zobrazených otázkách. Nejprve ho ukončete tlačítkem Ukončit kvíz.';
  return null;
}

/** IDs and the number of actual question slides define score compatibility. */
export function compatibleScoringRounds(previous: readonly ScoringRoundShape[], next: readonly ScoringRoundShape[]): boolean {
  const valid = (rows: readonly ScoringRoundShape[]) => new Set(rows.map(row => row.id)).size === rows.length
    && rows.every(row => typeof row.id === 'string' && row.id.length > 0 && Number.isSafeInteger(row.questionCount) && row.questionCount >= 0);
  return valid(previous) && valid(next) && previous.length === next.length
    && previous.every(row => next.some(other => other.id === row.id && other.questionCount === row.questionCount));
}

export function scoringRoundsFromSlides(slides: readonly { readonly roundId?: string; readonly isQuestion: boolean }[], roundIds: readonly string[] = []): ScoringRoundShape[] {
  const counts = new Map<string, number>(roundIds.map(id => [id, 0]));
  for (const slide of slides) if (slide.roundId) counts.set(slide.roundId, (counts.get(slide.roundId) ?? 0) + (slide.isQuestion ? 1 : 0));
  return [...counts].map(([id, questionCount]) => ({ id, questionCount }));
}
