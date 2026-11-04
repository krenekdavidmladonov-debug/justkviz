import type { DocumentReference, Transaction } from 'firebase-admin/firestore';
import { canHideInfoSlide } from '@filmovy-kviz/quiz-domain';
import { LiveSessionError } from './errors.js';

export function requestedNavigationDirection(data: unknown): 1 | -1 | undefined {
  if (data === null || Array.isArray(data) || typeof data !== 'object') return undefined;
  const request = data as Record<string, unknown>;
  if (request.direction === undefined) return undefined;
  if ((request.direction !== 1 && request.direction !== -1) || request.position !== undefined) {
    throw new LiveSessionError('invalid-argument', 'Use either position or direction (-1 or 1).');
  }
  return request.direction;
}

/** Read only navigation metadata in batches: a hidden run must not cause one
 * serial Firestore round trip per slide. The selected full slide is loaded and
 * validated separately before publication.
 */
export async function adjacentVisibleSlidePosition(
  transaction: Transaction, rootRef: DocumentReference, cursor: number, direction: 1 | -1,
): Promise<number | undefined> {
  const maximumScanned = 400;
  const batchSize = 32;
  for (let scanned = 0; scanned < maximumScanned;) {
    // The usual adjacent visible slide still costs a single document read.
    const limit = Math.min(scanned === 0 ? 1 : batchSize, maximumScanned - scanned);
    const candidates = await transaction.get(rootRef.collection('slides')
      .where('position', direction === 1 ? '>' : '<', cursor)
      .orderBy('position', direction === 1 ? 'asc' : 'desc')
      .select('position', 'kind', 'isQuestion', 'roundId', 'hidden').limit(limit));
    for (const document of candidates.docs) {
      const candidate = document.data();
      cursor = Number(candidate.position);
      scanned += 1;
      const information = { kind: String(candidate.kind), isQuestion: candidate.isQuestion === true,
        ...(typeof candidate.roundId === 'string' ? { roundId: candidate.roundId } : {}) };
      if (!(candidate.hidden === true && canHideInfoSlide(information))) return cursor;
    }
    if (candidates.size < limit) break;
  }
  return undefined;
}
