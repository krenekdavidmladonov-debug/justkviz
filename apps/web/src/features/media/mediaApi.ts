import { privateRead, type PrivateDocument } from '../access/api';
import { httpsCallable } from 'firebase/functions';
import { ref, uploadBytesResumable } from 'firebase/storage';
import { parseQuizAsset, validOwnedMedia, ownedMediaLimits, type OwnedMediaKind } from '@filmovy-kviz/quiz-domain';
import { getFirebaseServices } from '../../services/firebase/client';
import { quizMediaEndpoint } from '../../services/firebase/mediaEndpoint';
import { getFirebaseAuth } from '../../services/firebase/auth';
import { quizMediaBlobCache } from './mediaBlobCache';
export async function listQuizMedia(quizId: string, kind: OwnedMediaKind): Promise<{ reference: string; size: number }[]> {
  const result = await privateRead<PrivateDocument[]>('mediaAssets', { quizId });
  return result.flatMap(doc => { const d = doc.data; return d.status === 'ready' && d.quizId === quizId && d.kind === kind && typeof d.generation === 'string' && validOwnedMedia(d.kind, d.contentType, d.size) ? [{ reference: 'quiz-asset:' + quizId + '/' + doc.id, size: d.size as number }] : []; });
}
export async function uploadQuizMedia(quizId: string, kind: OwnedMediaKind, file: File, options: { signal: AbortSignal; onProgress: (percent: number) => void }): Promise<string> {
  const contentType = file.type === 'audio/x-wav' ? 'audio/wav' : file.type;
  if (!validOwnedMedia(kind, contentType, file.size)) throw new Error('Použijte PNG/JPEG/WebP do 10 MiB nebo MP3, WAV či MP4 do 25 MiB.');
  const services = getFirebaseServices();
  const check = () => { if (options.signal.aborted) throw new Error('Nahrávání bylo zrušeno.'); };
  check();
  try {
    const begin = (await httpsCallable<object, { assetId: string; path: string }>(services.functions, 'beginQuizMediaUpload', { timeout: 30000 })({ quizId, requestId: crypto.randomUUID(), kind, contentType, size: file.size })).data;
    check();
    const task = uploadBytesResumable(ref(services.storage, begin.path), file, { contentType });
    const transferTimeout = window.setTimeout(() => { task.cancel(); }, 120000);
    const cancel = () => { task.cancel(); }; options.signal.addEventListener('abort', cancel, { once: true });
    try { await new Promise<void>((resolve, reject) => task.on('state_changed', snapshot => options.onProgress(Math.round(snapshot.bytesTransferred * 100 / snapshot.totalBytes)), reject, resolve)); }
    finally { window.clearTimeout(transferTimeout); options.signal.removeEventListener('abort', cancel); }
    check();
    const ready = (await httpsCallable<object, { reference: string }>(services.functions, 'finalizeQuizMediaUpload', { timeout: 30000 })({ quizId, assetId: begin.assetId })).data;
    check();
    if (parseQuizAsset(ready.reference)?.quizId !== quizId) throw new Error('Neplatná odpověď serveru.');
    return ready.reference;
  } catch (error) {
    check();
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    if (code.includes('failed-precondition')) throw new Error('Server odmítl obsah souboru. Ověřte skutečný formát, velikost a zkuste jiný soubor.', { cause: error });
    if (code.includes('permission-denied') || code.includes('unauthorized')) throw new Error('Nahrávání není povoleno. Je potřeba admin oprávnění a dostupné úložiště.', { cause: error });
    throw new Error('Přenos nebo ověření média selhalo. Rozepsaný obsah zůstal zachovaný. Zkuste nahrát znovu.', { cause: error });
  }
}
type QuizMediaReadFailure = 'access-denied' | 'not-found' | 'invalid-media' | 'load-failed'
  | 'gateway-throttled' | 'gateway-error' | 'gateway-unavailable' | 'network-error' | 'offline';

class QuizMediaReadError extends Error {
  constructor(message: string, readonly reason: QuizMediaReadFailure) { super(message); }
}

export function quizMediaReadFailure(error: unknown): QuizMediaReadFailure {
  return error instanceof QuizMediaReadError ? error.reason : 'load-failed';
}

function quizMediaHttpFailure(status: number): QuizMediaReadFailure {
  if (status === 401 || status === 403) return 'access-denied';
  if (status === 404 || status === 410) return 'not-found';
  if (status === 429) return 'gateway-throttled';
  if (status === 502 || status === 503 || status === 504) return 'gateway-unavailable';
  if (status >= 500 && status <= 599) return 'gateway-error';
  return 'load-failed';
}

function transferFailure(error: unknown, signal: AbortSignal): unknown {
  if (signal.aborted) return error;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return new QuizMediaReadError('Médium není dostupné.', 'offline');
  }
  // Fetch reports an unreadable response (including CORS) as a network error.
  return error instanceof TypeError ? new QuizMediaReadError('Médium není dostupné.', 'network-error') : error;
}

// Browser cache URLs belong to one in-memory access epoch and one concrete credential/session.
// They are never persisted as application state or shared with another identity.
let cacheEpoch = -1;
const accessNamespaces = new Map<string, string>();
const pinnedImages = new Map<string, string>();

export async function readQuizMediaBlob(
  reference: string, signal: AbortSignal, sessionId?: string, snapshotId?: string,
  onTiming?: (stage: import('../presentation/mediaTiming').AssetTransferTiming) => void,
): Promise<Blob> {
  if (!parseQuizAsset(reference)) throw new Error('Invalid asset reference');
  const url = quizMediaEndpoint(); url.searchParams.set('reference', reference);
  const headers: Record<string, string> = {};
  let accessScope = 'public:' + (sessionId ?? '');
  if (sessionId) url.searchParams.set('sessionId', sessionId);
  else {
    if (snapshotId) url.searchParams.set('snapshotId', snapshotId);
    const user = getFirebaseAuth().currentUser;
    if (!user) throw new QuizMediaReadError('Přihlášení je vyžadováno.', 'access-denied');
    const token = await user.getIdToken();
    headers.Authorization = 'Bearer ' + token;
    accessScope = 'private:' + token;
  }
  if (cacheEpoch !== quizMediaBlobCache.epoch) {
    cacheEpoch = quizMediaBlobCache.epoch; accessNamespaces.clear(); pinnedImages.clear();
  }
  let namespace = accessNamespaces.get(accessScope);
  if (!namespace) { namespace = crypto.randomUUID().replaceAll('-', ''); accessNamespaces.set(accessScope, namespace); }
  url.searchParams.set('cacheScope', namespace);
  const key = accessScope + ':' + url.href;
  const pinned = pinnedImages.get(key);
  if (pinned) url.searchParams.set('pin', pinned);
  return quizMediaBlobCache.read(key, signal, async (cached, requestSignal) => {
    const requestHeaders = { ...headers, ...(!pinned && cached?.etag ? { 'If-None-Match': cached.etag } : {}) };
    onTiming?.('asset-request');
    const response = await fetch(url, { headers: requestHeaders, signal: requestSignal, cache: 'default' })
      .catch((error: unknown) => { throw transferFailure(error, requestSignal); });
    onTiming?.('asset-headers');
    if (response.status === 304) {
      if (!cached?.etag) throw new Error('Médium není dostupné.');
      return { blob: cached.blob, etag: cached.etag };
    }
    if (!response.ok) {
      throw new QuizMediaReadError('Médium není dostupné.', quizMediaHttpFailure(response.status));
    }
    const contentType = response.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase() ?? '';
    const kind: OwnedMediaKind = contentType.startsWith('image/') ? 'image' : contentType === 'video/mp4' ? 'video' : 'audio';
    const declaredSize = response.headers.get('Content-Length');
    if (!validOwnedMedia(kind, contentType, 1) || (declaredSize !== null && !validOwnedMedia(kind, contentType, Number(declaredSize)))) {
      void response.body?.cancel(); throw new QuizMediaReadError('Neplatný typ nebo velikost média.', 'invalid-media');
    }
    if (!response.body) throw new Error('Médium není dostupné.');
    const reader = response.body.getReader(), chunks: Uint8Array<ArrayBuffer>[] = []; let size = 0;
    try {
      while (true) {
        const chunk = await reader.read().catch((error: unknown) => { throw transferFailure(error, requestSignal); });
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > ownedMediaLimits[kind]) { await reader.cancel(); throw new QuizMediaReadError('Médium přesahuje povolenou velikost.', 'invalid-media'); }
        chunks.push(new Uint8Array(chunk.value));
      }
    } finally { reader.releaseLock(); }
    if (!validOwnedMedia(kind, contentType, size) || (declaredSize !== null && Number(declaredSize) !== size)) throw new QuizMediaReadError('Neplatná velikost média.', 'invalid-media');
    onTiming?.('asset-body');
    const etag = response.headers.get('ETag');
    if (contentType.startsWith('image/') && etag && /^"[a-f0-9]{64}"$/u.test(etag)
      && response.headers.get('Cache-Control') === 'private,max-age=31536000,immutable') {
      pinnedImages.set(key, etag.slice(1, -1));
    }
    return { blob: new Blob(chunks, { type: contentType }), ...(etag && etag.length <= 200 ? { etag } : {}) };
  });
}
