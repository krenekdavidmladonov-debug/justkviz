import { eventQuizMutationProblem, eventScoringEpoch } from '@filmovy-kviz/quiz-domain';
import { FieldValue, getFirestore, Timestamp, type DocumentReference, type QueryDocumentSnapshot, type Transaction } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { accessActor, runAccessTransaction, securedOnCall } from '../access/authorization.js';
import { expectedRevision, isObject, requiredId } from '../events/validation.js';
import { loadEventQuizState } from '../events/quiz-state.js';
import { scoreHash } from './core.js';

/** Read the complete event-owned tree before queuing any writes, including orphan history parents. */
export async function scoreResetPlan(tx: Transaction, event: Record<string, unknown>, scores: readonly QueryDocumentSnapshot[], parents: readonly DocumentReference[]) {
  const scoring = event.scoring;
  if (!isObject(scoring) || scoring.unitScale !== 2 || scoring.rankingMode !== 'dense' || typeof scoring.started !== 'boolean') throw new HttpsError('failed-precondition', 'Konfigurace bodování není platná.');
  let epoch: number;
  try { epoch = eventScoringEpoch(scoring); }
  catch { throw new HttpsError('failed-precondition', 'Generace bodování není platná. Kontaktujte správce.'); }
  if (epoch >= Number.MAX_SAFE_INTEGER - 1) throw new HttpsError('resource-exhausted', 'Generaci bodování už nelze zvýšit. Kontaktujte správce.');
  const owned = new Map([...parents, ...scores.map(row => row.ref)].map(ref => [ref.path, ref]));
  const histories = await Promise.all([...owned.values()].map(ref => tx.get(ref.collection('history'))));
  return { scoreCount: scores.length, historyCount: histories.reduce((sum, rows) => sum + rows.size, 0),
    refs: [...histories.flatMap(rows => rows.docs.map(row => row.ref)), ...owned.values()],
    scoring: { unitScale: 2, rankingMode: 'dense', started: false, epoch: epoch + 1 } };
}
export function applyScoreReset(tx: Transaction, plan: Awaited<ReturnType<typeof scoreResetPlan>>): void {
  for (const ref of plan.refs) tx.delete(ref);
}

export const resetEventScores = securedOnCall('resetEventScores', { region: 'europe-west1', cors: true, timeoutSeconds: 120 }, async request => {
  if (!isObject(request.data) || Object.keys(request.data).some(key => !['eventId', 'expectedRevision', 'requestId', 'confirm'].includes(key)) || request.data.confirm !== 'SMAZAT') {
    throw new HttpsError('invalid-argument', 'Pro smazání všech bodů napište přesně SMAZAT.');
  }
  const actor = accessActor(request.auth), eventId = requiredId(request.data, 'eventId'), requestId = requiredId(request.data, 'requestId'), expected = expectedRevision(request.data);
  if (!Number.isSafeInteger(expected) || expected < 1 || expected >= Number.MAX_SAFE_INTEGER || requestId.length > 150) throw new HttpsError('invalid-argument', 'Neplatná revize nebo identifikátor požadavku.');
  const db = getFirestore(), ref = db.doc('events/' + eventId), key = scoreHash(['resetEventScores', actor.uid, eventId, requestId]);
  const receiptRef = ref.collection('eventOperations').doc(key), fingerprint = scoreHash([expected, 'SMAZAT']);
  // listDocuments also finds missing score parents with a retained history subcollection.
  // New ordinary score writes always create their parent; the transactional query below rereads those.
  const parents = await ref.collection('scores').listDocuments();
  return runAccessTransaction(db, async tx => {
    const event = (await tx.get(ref)).data();
    if (!event) throw new HttpsError('not-found', 'Akce není dostupná.');
    const receipt = (await tx.get(receiptRef)).data();
    if (receipt) {
      if (receipt.fingerprint !== fingerprint) throw new HttpsError('already-exists', 'Tento požadavek už měl jiný obsah.');
      return receipt.response as { eventId: string; revision: number; scoringEpoch: number; deletedScoreCount: number; deletedHistoryCount: number };
    }
    if (event.revision !== expected) throw new HttpsError('aborted', 'Akce se změnila. Obnovte detail a zkontrolujte počet bodů před potvrzením.');
    const { state, scores } = await loadEventQuizState(tx, ref, event);
    const problem = eventQuizMutationProblem(event, state, 'reset');
    if (problem) throw new HttpsError('failed-precondition', problem);
    const plan = await scoreResetPlan(tx, event, scores.docs, parents);
    const now = Timestamp.now(), revision = expected + 1;
    const response = { eventId, revision, scoringEpoch: plan.scoring.epoch, deletedScoreCount: plan.scoreCount, deletedHistoryCount: plan.historyCount };
    applyScoreReset(tx, plan);
    tx.update(ref, { scoring: plan.scoring, liveSessionId: FieldValue.delete(), lastEndedSessionId: FieldValue.delete(), revision, updatedAt: now, updatedBy: actor.uid });
    tx.create(receiptRef, { fingerprint, response, at: now });
    tx.create(db.doc('eventAudit/' + key), { eventId, actorUid: actor.uid, action: 'reset-scores', revision, scoringEpoch: plan.scoring.epoch,
      deletedScoreCount: plan.scoreCount, deletedHistoryCount: plan.historyCount, at: now });
    return response;
  });
});
