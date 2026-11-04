import { createHash } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import { mapEditorSlide, parseQuizAsset, scopeAllows, youtubeVideoId, type Membership } from '@filmovy-kviz/quiz-domain';
import type { DriveFileReference } from './files.js';

export const driveImportFields = ['mediaSource', 'questionImage', 'answerImage', 'backgroundImage'] as const;
export type DriveImportField = typeof driveImportFields[number];
export type DriveImportKind = 'image' | 'audio' | 'video';
export type DriveImportSource =
  | { type: 'youtube'; kind: 'audio' | 'video'; videoId: string; startSeconds: number; endSeconds: number }
  | { type: 'owned-image'; kind: 'image'; reference: string; generation: string; contentType: string; size: number }
  | { type: 'https-image'; kind: 'image'; url: string };
export interface DriveImportTarget { quizId: string; slideId: string; field: DriveImportField }
export interface DriveImportLocator extends DriveImportTarget { jobId: string }
export interface DriveImportConnection { ownerUid: string; connected: boolean; revision: number; generation: number; folderId: string; accountPermissionId: string }
export interface DriveImportOutput { contentType: string; size: number; sha256: string; md5Checksum: string; durationSeconds?: number }
export interface DriveImportJob extends DriveImportLocator {
  execution?: 'cloud' | 'local';
  /** Server-only equality selector: exhausted/invalid failures must not fill the bounded retry queue. */
  localRetry?: boolean;
  schemaVersion: 1; ownerUid: string; membershipVersion: number; connectionRevision: number; connectionGeneration: number;
  folderId: string; accountPermissionId: string; authValidAfter: number; source: DriveImportSource; sourceFingerprint: string; sourceQuizRevision: number;
  status: 'queued' | 'processing' | 'ready' | 'failed' | 'stale'; createdAt: number; updatedAt: number; attempt: number;
  lease?: { id: string; expiresAt: number }; fileId?: string; output?: DriveImportOutput; assetId?: string;
  errorCode?: 'processing-failed' | 'invalid-output' | 'artifact-changed' | 'source-changed' | 'connection-changed' | 'membership-changed';
}
export interface DriveImportAsset {
  quizId: string; assetId: string; kind: DriveImportKind; contentType: string; size: number; status: 'ready';
  storageBackend: 'drive'; generation: string; sha256: string; createdBy: string; createdAt: number; readyAt: number; importJobId: string;
  drive: { ownerUid: string; accountPermissionId: string; connectionGeneration: number; file: DriveFileReference };
  privateProvenance: { source: DriveImportSource; sourceFingerprint: string; sourceQuizRevision: number; field: DriveImportField };
}
export interface SourceAsset {
  quizId: string; kind: string; status: string; contentType: string; size: number; generation: string;
  storageBackend?: string; importJobId?: string; drive?: { ownerUid: string };
}
export interface DriveImportAttachment {
  field: DriveImportField; reference: string; expectedQuizRevision: number;
  clipStartSeconds?: number; clipEndSeconds?: number;
  privateProvenance: DriveImportAsset['privateProvenance'] & { importJobId: string };
}
export interface DriveImportView {
  /** Adapter must freshly validate Auth on EVERY transaction attempt, including worker transactions. */
  freshIdentity: boolean; member: Membership; authValidAfter?: number;
  connection?: DriveImportConnection;
  quiz?: { id: string; revision: number; createdBy: string; active: boolean };
  slide?: Record<string, unknown>;
  readJob(id: string): Promise<DriveImportJob | undefined>;
  readAsset(id: string): Promise<SourceAsset | undefined>;
  writeJob(job: DriveImportJob): void;
  /** Must create immutably. A ready job replay must never overwrite an asset. */
  createAsset(asset: DriveImportAsset): void;
  /** Same transaction: field/timing + derived question + parent revision/audit; preserve every other field. */
  attachMedia(attachment: DriveImportAttachment): void;
}
export interface DriveImportStore {
  /** All reads precede buffered writes; this is one Firestore transaction, never a browser-backed store. */
  run<T>(ownerUid: string, target: DriveImportTarget, handler: (view: DriveImportView) => Promise<T>): Promise<T>;
}
export interface DriveImportStatus { jobId: string; status: DriveImportJob['status']; execution?: 'local'; reference?: string; errorCode?: DriveImportJob['errorCode'] }

export const importDigest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const sourceFingerprint = (source: DriveImportSource): string => importDigest(source);
export function importId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,150}$/u.test(value)) throw new HttpsError('invalid-argument', 'Neplatný požadavek média.');
  return value;
}
export function importTarget(input: unknown, locator = false): DriveImportTarget | DriveImportLocator {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpsError('invalid-argument', 'Neplatný požadavek média.');
  const data = input as Record<string, unknown>;
  if (Object.keys(data).some(key => !['quizId', 'slideId', 'field', ...(locator ? ['jobId'] : [])].includes(key))
    || !driveImportFields.includes(data.field as DriveImportField)) throw new HttpsError('invalid-argument', 'Neplatný požadavek média.');
  const target = { quizId: importId(data.quizId), slideId: importId(data.slideId), field: data.field as DriveImportField };
  if (!locator) return target;
  if (typeof data.jobId !== 'string' || !/^[a-f0-9]{64}$/u.test(data.jobId)) throw new HttpsError('invalid-argument', 'Neplatný požadavek média.');
  return { ...target, jobId: data.jobId };
}
export function authorizeImport(view: DriveImportView, ownerUid: string, target: DriveImportTarget): void {
  const member = view.member;
  const required = ['users.manage', 'quiz.media.upload', 'quiz.media.attach', 'quiz.edit', 'quiz.read', 'quiz.answers.read'] as const;
  if (!view.freshIdentity || member.uid !== ownerUid || member.role !== 'owner' || member.status !== 'active'
    || !Number.isSafeInteger(member.version) || member.version < 1 || !Array.isArray(member.permissions) || !member.quizzes || !Array.isArray(member.quizzes.ids)
    || !required.every(permission => member.permissions.includes(permission))
    || !scopeAllows(member.quizzes, target.quizId, ownerUid, view.quiz?.createdBy)) throw new HttpsError('permission-denied', 'Příprava média není povolena.');
  if (!view.quiz || view.quiz.id !== target.quizId || !view.quiz.active || !view.slide
    || !Number.isSafeInteger(view.quiz.revision) || view.quiz.revision < 0) throw new HttpsError('failed-precondition', 'Zdroj média již není dostupný.');
}
export function connectedImport(view: DriveImportView, ownerUid: string): DriveImportConnection {
  const connection = view.connection;
  if (!connection || connection.ownerUid !== ownerUid || !connection.connected || !/^[A-Za-z0-9_-]{5,200}$/u.test(connection.folderId)
    || !/^[A-Za-z0-9_-]{1,200}$/u.test(connection.accountPermissionId)
    || !Number.isSafeInteger(connection.revision) || connection.revision < 0
    || !Number.isSafeInteger(connection.generation) || connection.generation < 0) throw new HttpsError('failed-precondition', 'Nejdříve připojte soukromou složku Disku.');
  return connection;
}
export function publicImportStatus(job: DriveImportJob): DriveImportStatus {
  return { jobId: job.jobId, status: job.status, ...(job.execution === 'local' ? { execution: 'local' as const } : {}), ...(job.status === 'ready' && job.assetId ? { reference: `quiz-asset:${job.quizId}/${job.assetId}` } : {}),
    ...(job.errorCode ? { errorCode: job.errorCode } : {}) };
}

/** Only the saved authoritative slide is mapped. URL safety at this layer is not SSRF approval. */
export async function deriveImportSource(view: DriveImportView, target: DriveImportTarget): Promise<DriveImportSource | { importJobId: string; assetId: string }> {
  let slide;
  try { slide = mapEditorSlide(target.slideId, view.slide!); } catch { throw new HttpsError('failed-precondition', 'Zdroj média není podporovaný.'); }
  const value = slide[target.field], owned = parseQuizAsset(value);
  if (owned) {
    if (owned.quizId !== target.quizId) throw new HttpsError('failed-precondition', 'Médium nepatří do tohoto kvízu.');
    const asset = await view.readAsset(owned.assetId);
    if (!asset || asset.quizId !== target.quizId || asset.status !== 'ready') throw new HttpsError('failed-precondition', 'Zdroj média není připravený.');
    if (asset.storageBackend === 'drive' && asset.importJobId && asset.drive?.ownerUid === view.member.uid) {
      const kind = target.field !== 'mediaSource' ? 'image' : ['audio', 'music'].includes(slide.kind) ? 'audio'
        : ['video', 'youtube'].includes(slide.kind) ? 'video' : undefined;
      if (asset.kind !== kind) throw new HttpsError('failed-precondition', 'Médium nepatří do této role.');
      return { importJobId: asset.importJobId, assetId: owned.assetId };
    }
    if (target.field === 'mediaSource' || asset.kind !== 'image' || !['image/png', 'image/jpeg', 'image/webp'].includes(asset.contentType)
      || !/^\d+$/u.test(asset.generation) || !Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > 10 * 1024 * 1024) {
      throw new HttpsError('failed-precondition', 'Zdroj média není podporovaný.');
    }
    return { type: 'owned-image', kind: 'image', reference: value, generation: asset.generation, contentType: asset.contentType, size: asset.size };
  }
  if (target.field !== 'mediaSource') {
    try {
      const url = new URL(value);
      if (value.length > 4096 || url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error();
      return { type: 'https-image', kind: 'image', url: url.href };
    } catch { throw new HttpsError('failed-precondition', 'Obrázek potřebuje ověřený zdroj nebo HTTPS odkaz.'); }
  }
  const videoId = youtubeVideoId(value), kind = ['video', 'youtube'].includes(slide.kind) ? 'video' : ['audio', 'music'].includes(slide.kind) ? 'audio' : undefined;
  const startSeconds = slide.clipStartSeconds, endSeconds = slide.clipEndSeconds;
  if (!videoId || !kind || startSeconds === null || endSeconds === null || !Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)
    || startSeconds < 0 || endSeconds <= startSeconds || endSeconds - startSeconds > 180 || endSeconds > 86400) throw new HttpsError('failed-precondition', 'Vyplňte platný zdroj a interval média.');
  return { type: 'youtube', kind, videoId, startSeconds, endSeconds };
}
