import { getFirestore, type DocumentReference, type Transaction } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { scoringRoundsFromSlides, type EventQuizChangeState } from '@filmovy-kviz/quiz-domain';
import { eventSessions } from '../live/event-lifecycle.js';
import { isObject } from './validation.js';

/** One authoritative read model for the UI preview and the mutation transaction. */
export async function loadEventQuizState(tx: Transaction, ref: DocumentReference, event: Record<string, unknown>) {
  const sessions = await eventSessions(tx, ref.id);
  const scores = await tx.get(ref.collection('scores'));
  let snapshotRounds: EventQuizChangeState['snapshotRounds'] = [];
  if (isObject(event.quizAssignment)) {
    const snapshotId = event.quizAssignment.snapshotId;
    if (typeof snapshotId !== 'string' || !snapshotId || snapshotId.includes('/')) throw new HttpsError('failed-precondition', 'Vazba připraveného kvízu není platná.');
    const snapshot = getFirestore().doc('quizSnapshots/' + snapshotId);
    const rounds = await tx.get(snapshot.collection('rounds').limit(401));
    if (rounds.size > 400) throw new HttpsError('resource-exhausted', 'Kvíz má příliš mnoho kol.');
    const questions = await tx.get(snapshot.collection('slides').where('isQuestion', '==', true).select('roundId').limit(401));
    if (questions.size > 400) throw new HttpsError('resource-exhausted', 'Kvíz má příliš mnoho otázek.');
    snapshotRounds = scoringRoundsFromSlides(questions.docs.map(row => ({ isQuestion: true, ...(typeof row.get('roundId') === 'string' ? { roundId: row.get('roundId') as string } : {}) })), rounds.docs.map(row => row.id));
  }
  const active = sessions.filter(row => row.session.status !== 'ended');
  const state: EventQuizChangeState = { hasActiveSession: active.length > 0,
    hasPresentedQuestion: active.some(row => row.session.hasPresentedQuestion === true),
    hasUnknownQuestionHistory: active.some(row => row.session.hasPresentedQuestion === undefined),
    scoreDocumentCount: scores.size, snapshotRounds };
  return { state, sessions, scores };
}
