import type { CollectionReference, QueryDocumentSnapshot, Transaction } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

export async function snapshotRoundQuestionCounts(tx: Transaction, slides: CollectionReference, rounds: readonly QueryDocumentSnapshot[]) {
  const counts = new Map<string, number>();
  const missing = new Set<string>();
  for (const round of rounds) {
    const count: unknown = round.get('questionCount');
    if (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0) counts.set(round.id, count);
    else { counts.set(round.id, 0); missing.add(round.id); }
  }
  if (missing.size) {
    // Older snapshots may carry counts only in their frozen slides.
    const questions = await tx.get(slides.where('isQuestion', '==', true).select('roundId').limit(401));
    if (questions.size > 400) throw new HttpsError('resource-exhausted', 'Kvíz je příliš velký.');
    for (const question of questions.docs) {
      const roundId: unknown = question.get('roundId');
      if (typeof roundId === 'string' && missing.has(roundId)) counts.set(roundId, counts.get(roundId)! + 1);
    }
  }
  return counts;
}
