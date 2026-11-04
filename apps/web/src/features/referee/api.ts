import { httpsCallable } from 'firebase/functions';
import { getFirebaseServices } from '../../services/firebase/client';
import type { Score, ScoreHistory } from '../scoring/model';
import type { ScoreRequest, RoundScoreRequest, RoundScoreResponse } from '../scoring/api';
export interface Access { accessId: string; label: string; expiresAt: string; version: number; status: 'active' | 'expired' | 'revoked' }
export interface Credential { eventId: string; accessId: string; key: string }
export interface RefereeEvent { eventId: string; title: string; label: string; snapshotId: string; rounds: { id: string; title: string }[]; teams: { id: string; name: string }[]; scores: (Score & { teamId: string; roundId: string })[] }
export async function refereeCall<T>(name: string, data: unknown): Promise<T> { return (await httpsCallable<unknown, T>(getFirebaseServices().functions, name)(data)).data; }
export const readReferee = (c: Credential) => refereeCall<RefereeEvent>('readRefereeEvent', c);
export const writeReferee = (c: Credential, score: ScoreRequest) => refereeCall<Score>('saveRefereeScore', { credential: c, score });
export const writeRefereeRound = (c: Credential, score: RoundScoreRequest) => refereeCall<RoundScoreResponse>('saveRefereeScore', { credential: c, score });
export const historyReferee = (c: Credential, teamId: string, roundId: string) => refereeCall<ScoreHistory[]>('readRefereeHistory', { ...c, teamId, roundId });
