import { httpsCallable } from 'firebase/functions';
import { getFirebaseAppContext } from '../../services/firebase/app';
import { getFirebaseAuth } from '../../services/firebase/auth';
import { getFirebaseServices } from '../../services/firebase/client';
import { parseLocalEventMediaManifest, type LocalEventMediaManifest } from './localEventMediaBackupFile';

const projectId = 'demo-filmovy-kviz-v2';

export function localEventMediaAvailable(): boolean {
  return import.meta.env.VITE_FIREBASE_USE_EMULATORS === 'true'
    && import.meta.env.VITE_FIREBASE_PROJECT_ID === projectId
    && ['127.0.0.1', 'localhost', '[::1]'].includes(window.location.hostname)
    && getFirebaseAppContext().app.options.projectId === projectId;
}

export interface LocalEventMediaScope {
  readonly eventId: string;
  readonly snapshotId: string;
  readonly quizRevision: number;
  readonly actorId: string;
}

function currentUser(scope: LocalEventMediaScope, signal: AbortSignal) {
  signal.throwIfAborted();
  const user = localEventMediaAvailable() ? getFirebaseAuth().currentUser : null;
  if (!user || user.uid !== scope.actorId) throw new Error('Local media authorization changed.');
  return user;
}

export async function readLocalEventMediaManifest(scope: LocalEventMediaScope, signal: AbortSignal): Promise<LocalEventMediaManifest> {
  currentUser(scope, signal);
  const request = httpsCallable<{ eventId: string }, unknown>(getFirebaseServices().functions, 'readLocalEventMediaManifest', { timeout: 15_000 });
  const response = await request({ eventId: scope.eventId });
  currentUser(scope, signal);
  const manifest = parseLocalEventMediaManifest(response.data);
  if (!manifest || manifest.eventId !== scope.eventId || manifest.snapshotId !== scope.snapshotId
    || manifest.quizRevision !== scope.quizRevision || Date.now() >= manifest.validUntilMs) {
    throw new Error('Local media manifest is unavailable.');
  }
  return manifest;
}

export function sameLocalEventMediaManifest(first: LocalEventMediaManifest, second: LocalEventMediaManifest): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
}

export async function downloadLocalEventMedia(
  scope: LocalEventMediaScope, manifest: LocalEventMediaManifest, signal: AbortSignal,
): Promise<Blob> {
  const media = manifest.media;
  if (!media) throw new Error('Local media is unavailable.');
  const user = currentUser(scope, signal);
  const token = await user.getIdToken();
  currentUser(scope, signal);

  const url = new URL('http://127.0.0.1:5001/' + projectId + '/europe-west1/readQuizMedia');
  url.searchParams.set('reference', media.reference);
  url.searchParams.set('snapshotId', manifest.snapshotId);
  const response = await fetch(url, {
    headers: { Authorization: 'Bearer ' + token },
    cache: 'no-store', redirect: 'error', credentials: 'omit', signal,
  });
  if (response.status !== 200 || response.headers.get('ETag') !== media.etag
    || response.headers.get('Cache-Control') !== 'no-store'
    || response.headers.get('Content-Type') !== media.contentType
    || response.headers.get('Content-Length') !== String(media.size) || !response.body) {
    await response.body?.cancel();
    throw new Error('Local media download does not match its manifest.');
  }

  const reader = response.body.getReader();
  const bytes = new Uint8Array(media.size);
  let offset = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > bytes.byteLength) {
        await reader.cancel();
        throw new Error('Local media download exceeds its manifest.');
      }
      bytes.set(value, offset);
      offset += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  currentUser(scope, signal);
  if (offset !== media.size) throw new Error('Local media download is incomplete.');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const sha256 = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
  if (sha256 !== media.sha256) throw new Error('Local media download hash does not match its manifest.');
  return new Blob([bytes], { type: media.contentType });
}
