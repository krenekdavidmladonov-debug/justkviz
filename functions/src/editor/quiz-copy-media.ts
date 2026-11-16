import { createHash } from 'node:crypto';
import { type DocumentSnapshot, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { parseQuizAsset, quizAssetReference, validOwnedMedia } from '@filmovy-kviz/quiz-domain';
import type { QuizCopyStorageSource } from '../media/quiz-copy-storage.js';
import { verifiedOriginalYoutubeSource } from '../media/original-source.js';
import { hasQuizScopedMedia } from './model.js';

const sha256 = /^[a-f0-9]{64}$/u;
const storageGeneration = /^[1-9]\d*$/u;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const maximumAssets = 256;
const maximumBytes = 512 * 1024 * 1024;

export function unavailableQuizCopyMedia() {
  return new HttpsError('failed-precondition', 'Některá média zdrojového kvízu nejsou dostupná v ověřené podobě.', 'quiz-copy-media-unavailable');
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// Keep the private original YouTube selector for an attached clip. The copied
// image always uses its own bytes, including when the old web image has changed.
function copyProvenance(record: Record<string, unknown>) {
  if (!plainRecord(record.driveImportProvenance)) return undefined;
  const clip = record.driveImportProvenance.mediaSource;
  const youtube = verifiedOriginalYoutubeSource(record);
  if (!youtube || !plainRecord(clip) || !plainRecord(clip.source) || clip.source.type !== 'youtube') return undefined;
  return { mediaSource: { field: 'mediaSource', importJobId: clip.importJobId, source: {
    type: 'youtube', videoId: clip.source.videoId,
  } } };
}

export function rebindQuizCopyMedia(record: Record<string, unknown>, sourceId: string, targetId: string, assetIds: Set<string>): Record<string, unknown> {
  function rebind(value: unknown): unknown {
    const asset = parseQuizAsset(value);
    if (asset) {
      if (asset.quizId !== sourceId) throw unavailableQuizCopyMedia();
      assetIds.add(asset.assetId);
      return quizAssetReference(targetId, asset.assetId);
    }
    if (Array.isArray(value)) return value.map(rebind);
    if (plainRecord(value)) {
      if (value.storageBackend === 'drive' || (typeof value.generation === 'string' && value.generation.startsWith('drive:'))
        || (typeof value.quizId === 'string' && typeof value.assetId === 'string')) throw unavailableQuizCopyMedia();
      const entries = Object.entries(value).filter(([key]) => key !== 'driveImportProvenance');
      const provenance = copyProvenance(value);
      if (provenance) entries.push(['driveImportProvenance', provenance]);
      return Object.fromEntries(entries.map(([key, entry]) => [key, rebind(entry)]));
    }
    if (hasQuizScopedMedia(value)) throw unavailableQuizCopyMedia();
    return value;
  }
  return rebind(record) as Record<string, unknown>;
}

type AssetSnapshot = { readonly source: QuizCopyStorageSource; readonly version: string };
type DriveConnectionPin = { readonly generation: number; readonly account: string };

function quizCopyAsset(snapshot: DocumentSnapshot, quizId: string, actorUid: string): AssetSnapshot {
  const asset: unknown = snapshot.data();
  const version = snapshot.updateTime;
  if (!version || !plainRecord(asset) || asset.quizId !== quizId || asset.assetId !== snapshot.id || asset.status !== 'ready'
    || !validOwnedMedia(asset.kind, asset.contentType, asset.size) || typeof asset.generation !== 'string') throw unavailableQuizCopyMedia();

  const source = { quizId, assetId: snapshot.id, kind: asset.kind, contentType: asset.contentType as string,
    size: asset.size as number, generation: asset.generation };
  if (asset.storageBackend === 'drive' || asset.drive !== undefined || asset.generation.startsWith('drive:')) {
    if (asset.storageBackend !== 'drive' || !plainRecord(asset.drive) || typeof asset.sha256 !== 'string'
      || !sha256.test(asset.sha256) || asset.generation !== 'drive:' + asset.sha256) throw unavailableQuizCopyMedia();
    if (asset.drive.ownerUid !== actorUid) throw new HttpsError('permission-denied', 'Soukromé médium může zkopírovat vlastník jeho připojení k Disku.', 'quiz-copy-drive-owner-required');
    return { source: { ...source, sha256: asset.sha256, raw: asset }, version: `${version.seconds}:${version.nanoseconds}` };
  }
  if ((asset.storageBackend !== undefined && asset.storageBackend !== 'storage') || !storageGeneration.test(asset.generation)
    || !Number.isSafeInteger(Number(asset.generation))
    || (asset.sha256 !== undefined && (typeof asset.sha256 !== 'string' || !sha256.test(asset.sha256)))) throw unavailableQuizCopyMedia();
  return { source: { ...source, ...(typeof asset.sha256 === 'string' ? { sha256: asset.sha256 } : {}) },
    version: `${version.seconds}:${version.nanoseconds}` };
}

async function driveConnectionPin(transaction: Transaction, db: Firestore, actorUid: string, assets: readonly AssetSnapshot[]): Promise<DriveConnectionPin | null> {
  const drive = assets.flatMap(({ source }) => source.raw ? [source.raw.drive] : []);
  if (!drive.length) return null;
  const stored: unknown = (await transaction.get(db.doc(`driveConnections/${actorUid}`))).data();
  if (!plainRecord(stored) || typeof stored.generation !== 'number' || !Number.isSafeInteger(stored.generation) || stored.generation < 0
    || stored.reauthorizationRequired || stored.revokingUntil || !stored.refreshToken || !plainRecord(stored.account)) {
    throw unavailableQuizCopyMedia();
  }
  const account = stored.account.permissionId;
  if (typeof account !== 'string' || drive.some(binding => !plainRecord(binding) || binding.accountPermissionId !== account)) throw unavailableQuizCopyMedia();
  return { generation: stored.generation, account };
}

export async function readQuizCopyMedia(
  transaction: Transaction, db: Firestore, sourceId: string, actorUid: string, assetIds: Set<string>,
) {
  if (assetIds.size > maximumAssets) throw new HttpsError('resource-exhausted', 'Kvíz obsahuje příliš mnoho souborů pro jednu kopii.');
  const refs = [...assetIds].sort().map(id => db.doc(`quizzes/${sourceId}/mediaAssets/${id}`));
  const assets = refs.length ? (await transaction.getAll(...refs)).map(snapshot => quizCopyAsset(snapshot, sourceId, actorUid)) : [];
  if (assets.reduce((bytes, { source }) => bytes + source.size, 0) > maximumBytes) {
    throw new HttpsError('resource-exhausted', 'Celková velikost médií překračuje 512 MiB.');
  }
  return {
    assets: assets.map(({ source }) => source),
    mediaFingerprint: digest(assets.map(({ source, version }) => [source.assetId, source.generation, source.sha256 ?? null, version])),
    driveConnection: await driveConnectionPin(transaction, db, actorUid, assets),
  };
}

export function quizCopyAssetBinding(fingerprint: string, mediaFingerprint: string, assetId: string) {
  return digest([fingerprint, mediaFingerprint, assetId]);
}
