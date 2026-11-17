import { MAX_ROUND_HALF_POINTS } from '@filmovy-kviz/quiz-domain';

export interface ScoreRound { id: string; title: string; questionCount?: number }
export interface Score { readonly revision: number; readonly halfPoints: number | null }
export interface ScoreHistory extends Score {
  readonly previousHalfPoints: number | null; readonly actorUid?: string; readonly actorLabel?: string; readonly createdAt: string; readonly reason: string;
}
export const emptyScore: Score = { revision: 0, halfPoints: null };

// Parse decimal digits exactly: converting a large fractional Number first could round it.
export function parsePoints(text: string): number {
  const match = /^(\d+)(?:[.,]([05])0*)?$/u.exec(text.trim());
  if (!match) throw new Error('Zadejte nezáporné body po půlbodech, například 0 nebo 2,5.');
  const units = BigInt(match[1]!) * 2n + (match[2] === '5' ? 1n : 0n);
  if (units > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Hodnota je mimo bezpečný číselný rozsah.');
  return Number(units);
}
export function parseRoundPoints(text: string): number {
  const units = parsePoints(text);
  if (units > MAX_ROUND_HALF_POINTS) throw new Error('Zadejte nejvýše 1000 bodů.');
  return units;
}
export function pointsText(units: number | null): string {
  if (units === null) return '';
  const value = BigInt(units);
  return String(value / 2n) + (value % 2n ? ',5' : '');
}
export function pointUnit(units: number): string {
  if (units % 2) return 'bodu';
  if (units === 2) return 'bod';
  return units >= 4 && units <= 8 ? 'body' : 'bodů';
}
export function scoreLabel(units: number | null): string { return units === null ? 'Nezadáno' : pointsText(units) + ' ' + pointUnit(units); }
