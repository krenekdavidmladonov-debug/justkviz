import { HttpsError } from 'firebase-functions/v2/https';
import { isObject, requiredId } from '../events/validation.js';

export function parseScoreRequest(data: unknown) {
  const fields = ['eventId', 'snapshotId', 'teamId', 'roundId', 'requestId', 'expectedRevision', 'halfPoints', 'reason'];
  if (!isObject(data) || Object.keys(data).some(key => !fields.includes(key))) {
    throw new HttpsError('invalid-argument', 'Unsupported score request.');
  }
  const ids = Object.fromEntries(['eventId', 'snapshotId', 'teamId', 'roundId', 'requestId'].map(field => {
    const id = requiredId(data, field);
    if (Buffer.byteLength(id, 'utf8') > 500 || id === '.' || id === '..') throw new HttpsError('invalid-argument', 'Invalid identifier.');
    return [field, id];
  })) as Record<'eventId' | 'snapshotId' | 'teamId' | 'roundId' | 'requestId', string>;
  if (!Number.isSafeInteger(data.expectedRevision) || (data.expectedRevision as number) < 0
    || (data.expectedRevision as number) >= Number.MAX_SAFE_INTEGER) {
    throw new HttpsError('invalid-argument', 'Invalid expected revision.');
  }
  if (data.halfPoints !== null && (!Number.isSafeInteger(data.halfPoints) || (data.halfPoints as number) < 0)) {
    throw new HttpsError('invalid-argument', 'Points must be safe non-negative integer half-point units or null.');
  }
  if (typeof data.reason !== 'string' || data.reason.length > 300 || /[\p{Cc}\p{Cf}]/u.test(data.reason)) {
    throw new HttpsError('invalid-argument', 'Reason must be at most 300 characters.');
  }
  return { ...ids, expectedRevision: data.expectedRevision as number, halfPoints: data.halfPoints as number | null, reason: data.reason.trim() };
}

// Two writes per changed team (score and history), plus one receipt and the event.
// Keep a bounded margin below Firestore's transaction write limit.
export const MAX_ROUND_SCORE_CHANGES = 200;
export function parseRoundScoreRequest(data: unknown) {
  const fields = ['eventId', 'snapshotId', 'roundId', 'requestId', 'scores'];
  if (!isObject(data) || Object.keys(data).some(key => !fields.includes(key))
    || !Array.isArray(data.scores) || data.scores.length === 0 || data.scores.length > MAX_ROUND_SCORE_CHANGES) {
    throw new HttpsError('invalid-argument', 'A round save requires 1–200 changed team scores.');
  }
  const scores = data.scores.map(value => {
    if (!isObject(value) || Object.keys(value).some(key => !['teamId', 'expectedRevision', 'halfPoints', 'reason'].includes(key))) {
      throw new HttpsError('invalid-argument', 'Unsupported team score.');
    }
    const input = parseScoreRequest({ eventId: data.eventId, snapshotId: data.snapshotId, roundId: data.roundId, requestId: data.requestId, ...value });
    return { teamId: input.teamId, expectedRevision: input.expectedRevision, halfPoints: input.halfPoints, reason: input.reason };
  }).sort((a, b) => a.teamId < b.teamId ? -1 : a.teamId > b.teamId ? 1 : 0);
  if (new Set(scores.map(score => score.teamId)).size !== scores.length) throw new HttpsError('invalid-argument', 'A team may occur only once.');
  const first = parseScoreRequest({ eventId: data.eventId, snapshotId: data.snapshotId, roundId: data.roundId, requestId: data.requestId, ...scores[0] });
  return { eventId: first.eventId, snapshotId: first.snapshotId, roundId: first.roundId, requestId: first.requestId, scores };
}
