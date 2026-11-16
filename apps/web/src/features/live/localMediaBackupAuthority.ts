import { httpsCallable } from 'firebase/functions';
import { getFirebaseServices } from '../../services/firebase/client';
import { getFirebaseAuth } from '../../services/firebase/auth';
import { localEventMediaAvailable } from '../events/localEventMediaApi';
import {
  parseLocalEventMediaAsset, parseLocalEventMediaManifest,
  type LocalEventMediaAsset, type LocalEventMediaManifest,
} from '../events/localEventMediaBackupFile';
import type { PublicLiveState } from './types';

export interface LocalProjectorMediaAuthority {
  readonly schemaVersion: 1;
  readonly sessionId: string;
  readonly revision: number;
  readonly slidePosition: number;
  readonly mediaGeneration: number;
  readonly eventId: string;
  readonly snapshotId: string;
  readonly quizRevision: number;
  readonly validUntilMs: number;
  readonly expiresAtMs: number;
  readonly media: LocalEventMediaAsset;
}

export function localMediaBackupSupported(): boolean {
  return localEventMediaAvailable() && window.isSecureContext && typeof MessageChannel !== 'undefined'
    && typeof crypto.subtle?.digest === 'function' && /(?:Chrome|Chromium)\//u.test(navigator.userAgent);
}

export function parseLocalProjectorMediaAuthority(value: unknown): LocalProjectorMediaAuthority {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Neplatné potvrzení obrázku.');
  const data = value as Record<string, unknown>;
  const fields = ['schemaVersion', 'sessionId', 'revision', 'slidePosition', 'mediaGeneration', 'eventId', 'snapshotId', 'quizRevision', 'validUntilMs', 'expiresAtMs', 'media'];
  if (Object.keys(data).length !== fields.length || !fields.every(key => Object.hasOwn(data, key))
    || data.schemaVersion !== 1
    || !['sessionId', 'eventId', 'snapshotId'].every(key => typeof data[key] === 'string' && /^[A-Za-z0-9_-]{1,150}$/u.test(data[key]))
    || !['revision', 'slidePosition', 'mediaGeneration', 'quizRevision', 'validUntilMs', 'expiresAtMs'].every(key => Number.isSafeInteger(data[key]) && (data[key] as number) >= 0)
    || (data.expiresAtMs as number) <= Date.now() || (data.expiresAtMs as number) > Date.now() + 5_000
    || (data.expiresAtMs as number) > (data.validUntilMs as number)) throw new Error('Neplatné potvrzení obrázku.');
  const media = parseLocalEventMediaAsset(data.media);
  if (!media || media.size !== 84 || media.sha256 !== '11cfcd3c87baa4071b698ef6cfe28c4d359d9a3dbb7ad2cc9b7d5f683b725adc') throw new Error('Nepodporovaný obrázek.');
  return { ...data, media } as unknown as LocalProjectorMediaAuthority;
}

export async function readLocalProjectorMediaAuthority(state: PublicLiveState, reference: string, signal: AbortSignal): Promise<LocalProjectorMediaAuthority> {
  signal.throwIfAborted();
  if (!localMediaBackupSupported() || !navigator.onLine) throw new Error('Místní obrázek není dostupný.');
  const payload = { sessionId: state.sessionId, revision: state.revision, slidePosition: state.slidePosition, mediaGeneration: state.mediaGeneration, reference };
  const callable = httpsCallable< typeof payload, unknown>(getFirebaseServices().functions, 'readLocalProjectorMediaAuthority', { timeout: 5_000 });
  const result = await callable(payload);
  signal.throwIfAborted();
  const grant = parseLocalProjectorMediaAuthority(result.data);
  if (grant.sessionId !== state.sessionId || grant.revision !== state.revision || grant.slidePosition !== state.slidePosition
    || grant.mediaGeneration !== state.mediaGeneration || grant.media.reference !== reference) throw new Error('Potvrzení patří jinému snímku.');
  return grant;
}

export interface LocalMediaOperatorScope {
  readonly eventId: string;
  readonly snapshotId: string;
  readonly actorId: string;
}

export async function readOperatorLocalMediaManifest(scope: LocalMediaOperatorScope, signal: AbortSignal, reference?: string): Promise<LocalEventMediaManifest> {
  signal.throwIfAborted();
  const user = getFirebaseAuth().currentUser;
  if (!localMediaBackupSupported() || !navigator.onLine || user?.uid !== scope.actorId) throw new Error('Oprávnění zálohy není dostupné.');
  const callable = httpsCallable<Record<string, string>, unknown>(getFirebaseServices().functions,
    reference ? 'readLocalEventMediaAuthorization' : 'readLocalEventMediaManifest', { timeout: 5_000 });
  const result = await callable({ eventId: scope.eventId, ...(reference ? { reference } : {}) });
  signal.throwIfAborted();
  const manifest = parseLocalEventMediaManifest(result.data);
  if (getFirebaseAuth().currentUser?.uid !== scope.actorId || manifest.eventId !== scope.eventId || manifest.snapshotId !== scope.snapshotId
    || manifest.validUntilMs <= Date.now() || !manifest.media || (reference && manifest.media.reference !== reference)) throw new Error('Záloha není aktuální.');
  return manifest;
}
