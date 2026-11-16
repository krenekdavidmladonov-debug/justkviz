import { HttpsError } from 'firebase-functions/v2/https';

/** The disposition overlay leaves imported quiz status and content untouched. */
export function quizDisposition(data: Record<string, unknown>): 'active' | 'trash' {
  if (data.disposition === undefined || data.disposition === 'active') return 'active';
  if (data.disposition === 'trash') return 'trash';
  throw new HttpsError('failed-precondition', 'Stav kvízu není platný.');
}

export function assertQuizActive(data: Record<string, unknown> | undefined) {
  if (!data) throw new HttpsError('not-found', 'Kvíz není dostupný.');
  if (quizDisposition(data) !== 'active') throw new HttpsError('failed-precondition', 'Kvíz je v koši. Nejdříve ho obnovte.');
}

export function quizTrashRevision(data: Record<string, unknown>): number {
  const value = data.revision === undefined ? 0 : data.revision;
  if (!Number.isSafeInteger(value) || (value as number) < 0 || value === Number.MAX_SAFE_INTEGER) {
    throw new HttpsError('failed-precondition', 'Revize kvízu není platná.');
  }
  return value as number;
}
