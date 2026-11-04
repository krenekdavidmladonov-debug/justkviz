import { Timestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getFirebaseServices } from '../../services/firebase/client';
import { quizMediaBlobCache } from '../media/mediaBlobCache';

let epoch = 0;
const stops = new Set<() => void>();
export function invalidatePrivateAccess() { epoch++; quizMediaBlobCache.clear(); stops.forEach(stop => stop()); stops.clear(); }
function decode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.$timestamp === 'number' && Object.keys(record).length === 1) return Timestamp.fromMillis(record.$timestamp);
    return Object.fromEntries(Object.entries(record).map(([k, v]) => [k, decode(v)]));
  }
  return value;
}
export async function accessCall<T>(name: string, data: Record<string, unknown> = {}): Promise<T> {
  const current = epoch;
  try {
    const result = await httpsCallable<Record<string, unknown>, T>(getFirebaseServices().functions, name)(data);
    if (current !== epoch) throw new Error('Přihlášení nebo oprávnění se změnilo.');
    return decode(result.data) as T;
  } catch (failure) {
    const code = failure && typeof failure === 'object' && 'code' in failure && typeof failure.code === 'string' ? failure.code : 'unknown';
    if (failure instanceof Error) {
      failure.message = `${failure.message} (${name}: ${code})`;
      throw failure;
    }
    throw Object.assign(new Error(`Požadavek nelze dokončit. (${name}: ${code})`, { cause: failure }), { code });
  }
}
export const privateRead = <T,>(operation: string, data: Record<string, unknown> = {}) => accessCall<T>('readAccessData', { operation, ...data });
export interface PrivateDocument { id: string; data: Record<string, unknown> }
/** Bounded polling avoids downloading contact/answer documents to redact them in a browser. */
export function watchPrivate<T>(operation: string, data: Record<string, unknown>, receive: (value: T) => void, fail: (error: Error) => void, interval = 2000) {
  let stopped = false, timer: ReturnType<typeof setTimeout>;
  const stop = () => { stopped = true; clearTimeout(timer); stops.delete(stop); };
  stops.add(stop);
  const poll = async () => {
    try {
      const result = await privateRead<T>(operation, data);
      if (!stopped) receive(result);
    } catch (error) {
      if (!stopped) { fail(error instanceof Error ? error : new Error('Obsah nelze načíst.')); stop(); }
    }
    if (!stopped) timer = setTimeout(() => void poll(), interval);
  };
  void poll();
  return stop;
}
