import { createHash } from 'node:crypto';
import { mapEditorSlide, parseQuizAsset, quizAssetReference, validOwnedMedia, youtubeVideoId } from '@filmovy-kviz/quiz-domain';
import type { DriveImportSource } from '../drive/import-model.js';

type YoutubeClipSource = Extract<DriveImportSource, { type: 'youtube' }>;
export interface SnapshotClipAssetCandidate { readonly id: string; readonly data: unknown; readonly job?: unknown }
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const matches = (value: unknown, pattern: RegExp): value is string => typeof value === 'string' && pattern.test(value);
const id = /^[A-Za-z0-9_-]{1,150}$/u, fileId = /^[A-Za-z0-9_-]{5,200}$/u;
const sha256 = /^[a-f0-9]{64}$/u, md5 = /^[a-f0-9]{32}$/u;
const nonnegativeInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Derive only the frozen slide's current effective source, never a newer quiz slide or original-source hint. */
export function snapshotClipSource(rawSlide: Record<string, unknown>): YoutubeClipSource | undefined {
  try {
    const slide = mapEditorSlide('snapshot-clip', rawSlide);
    const kind = ['video', 'youtube'].includes(slide.kind) ? 'video' : ['audio', 'music'].includes(slide.kind) ? 'audio' : undefined;
    if (!kind || slide.mediaSource.length > 4096 || parseQuizAsset(slide.mediaSource)) return undefined;
    const videoId = youtubeVideoId(slide.mediaSource), startSeconds = slide.clipStartSeconds, endSeconds = slide.clipEndSeconds;
    if (!videoId || startSeconds === null || endSeconds === null || !Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)
      || startSeconds < 0 || endSeconds <= startSeconds || endSeconds - startSeconds > 180 || endSeconds > 86400) return undefined;
    // This order is the importer's canonical sourceFingerprint contract.
    return { type: 'youtube', kind, videoId, startSeconds, endSeconds };
  } catch { return undefined; }
}

/** Server-only equality selector for a bounded authoritative asset query. */
export function snapshotClipFingerprint(rawSlide: Record<string, unknown>): string | undefined {
  const source = snapshotClipSource(rawSlide);
  return source ? hash(source) : undefined;
}

function exactSource(value: unknown, expected: YoutubeClipSource): boolean {
  const source = object(value), keys = ['type', 'kind', 'videoId', 'startSeconds', 'endSeconds'] as const;
  return Object.keys(source).length === keys.length && keys.every(key => source[key] === expected[key]);
}

function verifiedCandidate(quizId: string, candidate: SnapshotClipAssetCandidate, source: YoutubeClipSource, fingerprint: string) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined;
  const asset = object(candidate.data), provenance = object(asset.privateProvenance), drive = object(asset.drive), file = object(drive.file);
  const job = object(candidate.job), output = object(job.output);
  if (!matches(candidate.id, sha256) || asset.assetId !== candidate.id || asset.quizId !== quizId || asset.status !== 'ready'
    || asset.storageBackend !== 'drive' || asset.kind !== source.kind || !validOwnedMedia(asset.kind, asset.contentType, asset.size)
    || !matches(asset.importJobId, sha256) || hash(['drive-asset-v1', asset.importJobId]) !== candidate.id
    || provenance.field !== 'mediaSource' || provenance.sourceFingerprint !== fingerprint || !exactSource(provenance.source, source)
    || !nonnegativeInteger(provenance.sourceQuizRevision)
    || !matches(asset.createdBy, id) || drive.ownerUid !== asset.createdBy || !nonnegativeInteger(drive.connectionGeneration)
    || !matches(drive.accountPermissionId, /^[A-Za-z0-9_-]{1,200}$/u)
    || !matches(file.id, fileId) || !matches(file.folderId, fileId) || !matches(file.sha256, sha256) || !matches(file.md5Checksum, md5)
    || asset.sha256 !== file.sha256 || asset.generation !== 'drive:' + file.sha256 || file.size !== asset.size || file.mimeType !== asset.contentType
    || job.schemaVersion !== 1 || job.status !== 'ready' || job.jobId !== asset.importJobId || job.assetId !== candidate.id
    || job.quizId !== quizId || job.field !== 'mediaSource' || !exactSource(job.source, source) || job.sourceFingerprint !== fingerprint
    || job.sourceQuizRevision !== provenance.sourceQuizRevision || job.ownerUid !== asset.createdBy || job.fileId !== file.id
    || job.folderId !== file.folderId || job.accountPermissionId !== drive.accountPermissionId || job.connectionGeneration !== drive.connectionGeneration
    || output.sha256 !== file.sha256 || output.md5Checksum !== file.md5Checksum || output.size !== asset.size || output.contentType !== asset.contentType
    || typeof output.durationSeconds !== 'number' || !Number.isFinite(output.durationSeconds) || output.durationSeconds <= 0 || output.durationSeconds > 180.3
    || Math.abs(output.durationSeconds - (source.endSeconds - source.startSeconds)) > 0.3) return undefined;
  return { id: candidate.id, durationSeconds: output.durationSeconds,
    provenance: { source, sourceFingerprint: fingerprint, sourceQuizRevision: provenance.sourceQuizRevision,
      field: 'mediaSource' as const, importJobId: asset.importJobId } };
}

/**
 * Resolve from a bounded server-read candidate set without mutating the immutable snapshot.
 * This private view changes media only; normal publication must still allowlist and reveal answers.
 * File availability/privacy remain the media gateway's responsibility at playback time.
 */
export function resolveSnapshotClip(quizId: string, rawSlide: Record<string, unknown>, candidates: readonly SnapshotClipAssetCandidate[]): Record<string, unknown> {
  const source = snapshotClipSource(rawSlide);
  if (!matches(quizId, id) || !source) return rawSlide;
  const fingerprint = hash(source);
  const verified = candidates.flatMap(candidate => {
    const result = verifiedCandidate(quizId, candidate, source, fingerprint);
    return result ? [result] : [];
  }).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)[0];
  if (!verified) return rawSlide;
  return { ...rawSlide, mediaSource: quizAssetReference(quizId, verified.id), clipStartSeconds: 0, clipEndSeconds: verified.durationSeconds,
    driveImportProvenance: { ...object(rawSlide.driveImportProvenance), mediaSource: verified.provenance } };
}
