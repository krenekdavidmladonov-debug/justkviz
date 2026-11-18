import { doc, getDocFromServer, Timestamp } from 'firebase/firestore';
import { getFirebaseFirestore } from '../../services/firebase/firestore';
import type { ResultRow } from '../leaderboard/types';

export interface PublicEventResults {
  readonly eventId:string; readonly title:string; readonly startsAt:Date; readonly timeZone:string;
  readonly venueName:string; readonly publicLocation:string; readonly lifecycleStatus:'completed'; readonly rows:readonly ResultRow[];
}
const object = (value:unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
export function mapPublicEventResults(eventId:string, value:unknown): PublicEventResults {
  if (!object(value) || value.eventId !== eventId || value.lifecycleStatus !== 'completed' || !(value.startsAt instanceof Timestamp)
    || !['title', 'timeZone', 'venueName', 'publicLocation'].every(key => typeof value[key] === 'string')
    || !Array.isArray(value.rows) || value.rows.length === 0 || value.rows.length > 1000) throw new Error('Neplatné veřejné výsledky.');
  let rank = 0, previous = Number.POSITIVE_INFINITY;
  const rows = value.rows.map(row => {
    if (!object(row) || typeof row.teamName !== 'string' || !row.teamName.trim() || !Number.isSafeInteger(row.halfPoints) || Number(row.halfPoints) < 0 || Number(row.halfPoints) > previous) throw new Error('Neplatné veřejné pořadí.');
    const halfPoints = Number(row.halfPoints);
    if (halfPoints !== previous) rank++;
    if (row.rank !== rank) throw new Error('Neplatné veřejné pořadí.');
    previous = halfPoints;
    return { rank, teamName:row.teamName, halfPoints };
  });
  return { eventId, title:String(value.title), startsAt:value.startsAt.toDate(), timeZone:String(value.timeZone), venueName:String(value.venueName), publicLocation:String(value.publicLocation), lifecycleStatus:'completed', rows };
}
/** Anonymous single-document safe projection. Never reads sessions, scores or registrations. */
export async function getPublicEventResults(eventId:string): Promise<PublicEventResults | null> {
  try {
    const snapshot = await getDocFromServer(doc(getFirebaseFirestore(), 'publicEventResults', eventId));
    return snapshot.exists() ? mapPublicEventResults(eventId, snapshot.data()) : null;
  } catch (error) {
    if (object(error) && error.code === 'permission-denied') return null;
    throw error;
  }
}
