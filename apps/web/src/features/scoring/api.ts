import { collection, getDocsFromServer, onSnapshot, orderBy, query, Timestamp } from 'firebase/firestore';
import { privateRead, watchPrivate, type PrivateDocument } from '../access/api';
import { httpsCallable } from 'firebase/functions';
import { getFirebaseFirestore } from '../../services/firebase/firestore';
import { getFirebaseServices } from '../../services/firebase/client';
import type { Score, ScoreHistory } from './model';

export interface ScoreRequest {
  eventId: string; snapshotId: string; teamId: string; roundId: string; requestId: string;
  expectedRevision: number; halfPoints: number | null; reason: string;
}
export interface RoundScoreRequest {
  eventId: string; snapshotId: string; roundId: string; requestId: string;
  scores: { teamId: string; expectedRevision: number; halfPoints: number | null; reason: string }[];
}
export interface RoundScoreResponse { scores: (Score & { teamId: string })[] }
export async function saveRoundScores(request: RoundScoreRequest): Promise<RoundScoreResponse> {
  return (await httpsCallable<RoundScoreRequest, RoundScoreResponse>(getFirebaseServices().functions, 'saveEventScore')(request)).data;
}
export async function saveScore(request: ScoreRequest): Promise<Score> {
  return (await httpsCallable<ScoreRequest, Score>(getFirebaseServices().functions, 'saveEventScore')(request)).data;
}
export async function loadRounds(snapshotId: string) {
  const data = await privateRead<PrivateDocument[]>('snapshotRounds', { snapshotId });
  return data.map(item => ({ id: item.id, title: typeof item.data.title === 'string' ? item.data.title : 'Kolo' }));
}
export function watchScores(eventId: string, receive: (scores: Record<string, Score>) => void, fail: () => void) {
  return onSnapshot(collection(getFirebaseFirestore(), 'events', eventId, 'scores'), { includeMetadataChanges: true }, snapshot => {
    if (snapshot.metadata.fromCache) return;
    const scores: Record<string, Score> = {};
    for (const item of snapshot.docs) {
      const data = item.data();
      scores[JSON.stringify([data.teamId, data.roundId])] = { revision: data.revision as number, halfPoints: data.halfPoints as number | null };
    }
    receive(scores);
  }, fail);
}
export function watchRoster(eventId: string, receive: (teams: { id: string; name: string; accepted: boolean }[]) => void, fail: () => void) {
  return watchPrivate<PrivateDocument[]>('roster', { eventId }, rows => {
    receive(rows.map(item => ({ id: item.id, name: String(item.data.teamName), accepted: item.data.status === 'accepted' })));
  }, fail);
}
export function watchScoringEvent(eventId: string, receive: (snapshotId: string | null, allowed: boolean, title: string) => void, fail: () => void) {
  return watchPrivate<PrivateDocument>('event', { eventId }, result => {
    const data = result.data;
    const assignment = data?.quizAssignment as { snapshotId?: string } | undefined;
    receive(assignment?.snapshotId ?? null, ['ready', 'live', 'finalizing'].includes(data?.lifecycleStatus as string), typeof data?.title === 'string' ? data.title : 'Akce');
  }, fail);
}
export async function loadHistory(eventId: string, teamId: string, roundId: string): Promise<ScoreHistory[]> {
  // Derive the same collision-free pair key as the server.
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([teamId, roundId])));
  const key = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
  const result = await getDocsFromServer(query(collection(getFirebaseFirestore(), 'events', eventId, 'scores', key, 'history'), orderBy('revision', 'desc')));
  return result.docs.map(item => {
    const data = item.data();
    return { revision: data.revision as number, halfPoints: data.halfPoints as number | null,
      previousHalfPoints: data.previousHalfPoints as number | null, actorUid: typeof data.actorUid === 'string' ? data.actorUid : undefined, actorLabel: typeof data.actorLabel === 'string' ? data.actorLabel : undefined,
      reason: String(data.reason), createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate().toLocaleString('cs-CZ') : 'Neznámý čas' };
  });
}
