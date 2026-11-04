import { assertEventOperational } from '../events/guards.js';
import { createHash } from 'node:crypto';
import { runAccessTransaction } from '../access/authorization.js';
import { getFirestore, Timestamp, FieldValue, type Transaction } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { isObject } from '../events/validation.js';
import { parseScoreRequest, parseRoundScoreRequest } from './validation.js';

export type ScoreInput = ReturnType<typeof parseScoreRequest>;
export type ScoreActor = { key: string; audit: { actorUid: string } | { actorAccessId: string; actorLabel: string } };
export const scoreHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Authorization is rechecked inside the transaction, including idempotent receipts.
export async function commitScore(input: ScoreInput, authorize: (transaction: Transaction) => Promise<ScoreActor>) {
  const db = getFirestore();
  const eventRef = db.collection('events').doc(input.eventId);
  const scoreId = scoreHash([input.teamId, input.roundId]);
  const scoreRef = eventRef.collection('scores').doc(scoreId);
  const fingerprint = scoreHash(input);
  return runAccessTransaction(db, async transaction => {
    const actor = await authorize(transaction);
    const event: Record<string, unknown> | undefined = (await transaction.get(eventRef)).data();
    if (!event) throw new HttpsError('not-found', 'Event was not found.');
    const operationRef = eventRef.collection('scoreOperations').doc(scoreHash([actor.key, input.eventId, 'saveEventScore', input.requestId]));
    const operation: Record<string, unknown> | undefined = (await transaction.get(operationRef)).data();
    if (operation) {
      if (operation.fingerprint !== fingerprint) throw new HttpsError('already-exists', 'Request ID was used with different content.');
      return operation.response as { scoreId: string; revision: number; halfPoints: number | null };
    }
    assertEventOperational(event);
    if (!['ready', 'live', 'finalizing'].includes(event.lifecycleStatus as string)) throw new HttpsError('failed-precondition', 'This event cannot be scored.');
    if (!isObject(event.quizAssignment) || event.quizAssignment.snapshotId !== input.snapshotId || !isObject(event.scoring) || event.scoring.unitScale !== 2 || typeof event.scoring.started !== 'boolean') throw new HttpsError('failed-precondition', 'The event snapshot or scoring configuration changed.');
    const snapshotRef = db.collection('quizSnapshots').doc(input.snapshotId);
    const snapshot = await transaction.get(snapshotRef);
    const round = await transaction.get(snapshotRef.collection('rounds').doc(input.roundId));
    const team = (await transaction.get(eventRef.collection('registrations').doc(input.teamId))).data();
    const current: Record<string, unknown> | undefined = (await transaction.get(scoreRef)).data();
    if (!snapshot.exists || !round.exists) throw new HttpsError('not-found', 'Snapshot round was not found.');
    if (!team || team.eventId !== input.eventId) throw new HttpsError('not-found', 'Team was not found in this event.');
    if (team.status !== 'accepted') throw new HttpsError('failed-precondition', 'Only accepted teams can be scored.');
    const revision = (current?.revision ?? 0) as number, previous = (current?.halfPoints ?? null) as number | null;
    if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER || (previous !== null && (!Number.isSafeInteger(previous) || previous < 0)) || (current && (current.teamId !== input.teamId || current.roundId !== input.roundId || current.snapshotId !== input.snapshotId))) throw new HttpsError('failed-precondition', 'Stored score is malformed.');
    if (revision !== input.expectedRevision) throw new HttpsError('aborted', 'Score changed in another client.', { revision, halfPoints: previous });
    if ((previous !== null || input.halfPoints === null) && input.reason === '') throw new HttpsError('invalid-argument', 'A correction or clearing requires a reason.');
    if (previous === input.halfPoints) throw new HttpsError('failed-precondition', 'Score is unchanged.');
    const now = Timestamp.now(), response = { scoreId, revision: revision + 1, halfPoints: input.halfPoints };
    transaction.set(scoreRef, { teamId: input.teamId, roundId: input.roundId, snapshotId: input.snapshotId, halfPoints: input.halfPoints, revision: response.revision, updatedAt: now,
      ...('actorUid' in actor.audit ? { updatedBy: actor.audit.actorUid } : { updatedByAccessId: actor.audit.actorAccessId, actorLabel: actor.audit.actorLabel }) });
    transaction.create(scoreRef.collection('history').doc(String(response.revision)), { revision: response.revision, previousHalfPoints: previous, halfPoints: input.halfPoints, ...actor.audit, createdAt: now, reason: input.reason });
    transaction.create(operationRef, { fingerprint, response, ...actor.audit, createdAt: now });
    if (!event.scoring.started) {
      if (!Number.isSafeInteger(event.revision) || (event.revision as number) >= Number.MAX_SAFE_INTEGER) throw new HttpsError('failed-precondition', 'Invalid event revision.');
      transaction.update(eventRef, { 'scoring.started': true, revision: (event.revision as number) + 1, updatedAt: now,
        ...('actorUid' in actor.audit ? { updatedBy: actor.audit.actorUid } : { updatedBy: FieldValue.delete(), updatedByAccessId: actor.audit.actorAccessId }) });
    }
    return response;
  });
}

/** One round intent commits completely or not at all, using the existing score ledger. */
export async function commitRoundScores(input: ReturnType<typeof parseRoundScoreRequest>, authorize: (transaction: Transaction) => Promise<ScoreActor>) {
  const db = getFirestore(), eventRef = db.collection('events').doc(input.eventId);
  const fingerprint = scoreHash(input);
  return runAccessTransaction(db, async transaction => {
    const actor = await authorize(transaction);
    const event = (await transaction.get(eventRef)).data();
    if (!event) throw new HttpsError('not-found', 'Event was not found.');
    const operationRef = eventRef.collection('scoreOperations').doc(scoreHash([actor.key, input.eventId, 'saveEventRoundScores', input.requestId]));
    const operation = (await transaction.get(operationRef)).data();
    if (operation) {
      if (operation.fingerprint !== fingerprint) throw new HttpsError('already-exists', 'Request ID was used with different content.');
      return operation.response as { scores: { teamId: string; scoreId: string; revision: number; halfPoints: number | null }[] };
    }
    assertEventOperational(event);
    if (!['ready', 'live', 'finalizing'].includes(event.lifecycleStatus as string)) throw new HttpsError('failed-precondition', 'This event cannot be scored.');
    if (!isObject(event.quizAssignment) || event.quizAssignment.snapshotId !== input.snapshotId || !isObject(event.scoring) || event.scoring.unitScale !== 2 || typeof event.scoring.started !== 'boolean') throw new HttpsError('failed-precondition', 'The event snapshot or scoring configuration changed.');
    const snapshotRef = db.collection('quizSnapshots').doc(input.snapshotId);
    const [snapshot, round] = await transaction.getAll(snapshotRef, snapshotRef.collection('rounds').doc(input.roundId));
    if (!snapshot?.exists || !round?.exists) throw new HttpsError('not-found', 'Snapshot round was not found.');
    const records = input.scores.map(score => ({ input: score, scoreId: scoreHash([score.teamId, input.roundId]),
      teamRef: eventRef.collection('registrations').doc(score.teamId), scoreRef: eventRef.collection('scores').doc(scoreHash([score.teamId, input.roundId])) }));
    const documents = await transaction.getAll(...records.flatMap(row => [row.teamRef, row.scoreRef]));
    const rows = records.map((row, index) => {
      const team = documents[index * 2]!.data(), current = documents[index * 2 + 1]!.data();
      if (!team || team.eventId !== input.eventId) throw new HttpsError('not-found', 'Team was not found in this event.');
      if (team.status !== 'accepted') throw new HttpsError('failed-precondition', 'Only accepted teams can be scored.');
      const revision = (current?.revision ?? 0) as number, previous = (current?.halfPoints ?? null) as number | null;
      if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER || (previous !== null && (!Number.isSafeInteger(previous) || previous < 0)) || (current && (current.teamId !== row.input.teamId || current.roundId !== input.roundId || current.snapshotId !== input.snapshotId))) throw new HttpsError('failed-precondition', 'Stored score is malformed.');
      return { ...row, revision, previous };
    });
    const conflicts = rows.filter(row => row.revision !== row.input.expectedRevision).map(row => ({ teamId: row.input.teamId, revision: row.revision, halfPoints: row.previous }));
    if (conflicts.length) throw new HttpsError('aborted', 'Round scores changed in another client. No scores were saved.', { scores: conflicts });
    for (const row of rows) {
      if ((row.previous !== null || row.input.halfPoints === null) && row.input.reason === '') throw new HttpsError('invalid-argument', 'A correction or clearing requires a reason.');
      if (row.previous === row.input.halfPoints) throw new HttpsError('failed-precondition', 'Score is unchanged.');
    }
    const now = Timestamp.now(), response = { scores: rows.map(row => ({ teamId: row.input.teamId, scoreId: row.scoreId, revision: row.revision + 1, halfPoints: row.input.halfPoints })) };
    for (const [index, row] of rows.entries()) {
      const revision = response.scores[index]!.revision;
      transaction.set(row.scoreRef, { teamId: row.input.teamId, roundId: input.roundId, snapshotId: input.snapshotId, halfPoints: row.input.halfPoints, revision, updatedAt: now,
        ...('actorUid' in actor.audit ? { updatedBy: actor.audit.actorUid } : { updatedByAccessId: actor.audit.actorAccessId, actorLabel: actor.audit.actorLabel }) });
      transaction.create(row.scoreRef.collection('history').doc(String(revision)), { revision, previousHalfPoints: row.previous, halfPoints: row.input.halfPoints, ...actor.audit, createdAt: now, reason: row.input.reason });
    }
    transaction.create(operationRef, { fingerprint, response, ...actor.audit, createdAt: now });
    if (!event.scoring.started) {
      if (!Number.isSafeInteger(event.revision) || (event.revision as number) >= Number.MAX_SAFE_INTEGER) throw new HttpsError('failed-precondition', 'Invalid event revision.');
      transaction.update(eventRef, { 'scoring.started': true, revision: (event.revision as number) + 1, updatedAt: now,
        ...('actorUid' in actor.audit ? { updatedBy: actor.audit.actorUid } : { updatedBy: FieldValue.delete(), updatedByAccessId: actor.audit.actorAccessId }) });
    }
    return response;
  });
}
