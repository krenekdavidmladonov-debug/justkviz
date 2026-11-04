import { createHash } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import { validOwnedMedia } from '@filmovy-kviz/quiz-domain';
import { mediaSignature } from '../media/model.js';
import { MAX_DRIVE_FILE_BYTES, type DriveFileReference } from './files.js';
import { withDriveAccess, type DriveRuntimeDependencies } from './runtime.js';
import { driveImageBytes } from './image-byte-cache.js';

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function invalid(): never { throw new HttpsError('failed-precondition', 'Soukromé médium na Disku není dostupné.'); }
/** Only call with authoritative asset metadata after the gateway's reader/publication checks. */
function validatedAsset(asset: Record<string, unknown>, quizId: string) {
  const drive = object(asset.drive), file = object(drive.file);
  if (asset.quizId !== quizId || asset.status !== 'ready' || !validOwnedMedia(asset.kind, asset.contentType, asset.size)
    || typeof drive.ownerUid !== 'string' || !Number.isSafeInteger(drive.connectionGeneration) || (drive.connectionGeneration as number) < 0
    || typeof drive.accountPermissionId !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/u.test(drive.accountPermissionId)
    || typeof file.id !== 'string' || !/^[a-zA-Z0-9_-]{5,200}$/u.test(file.id)
    || typeof file.folderId !== 'string' || !/^[a-zA-Z0-9_-]{5,200}$/u.test(file.folderId)
    || typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(file.sha256)
    || typeof file.md5Checksum !== 'string' || !/^[a-f0-9]{32}$/u.test(file.md5Checksum)
    || asset.sha256 !== file.sha256 || asset.generation !== 'drive:' + file.sha256
    || file.size !== asset.size || file.mimeType !== asset.contentType || (file.size as number) > MAX_DRIVE_FILE_BYTES) invalid();
  const reference: DriveFileReference = { id: file.id, folderId: file.folderId, mimeType: file.mimeType as string,
    size: file.size as number, md5Checksum: file.md5Checksum, sha256: file.sha256 };
  return { binding: { ownerUid: drive.ownerUid, quizId, accountPermissionId: drive.accountPermissionId }, reference };
}

/** Revalidation still checks current owner, connection, folder and file ACLs; only byte transfer is skipped. */
export async function verifyDriveAsset(asset: Record<string, unknown>, quizId: string, dependencies?: DriveRuntimeDependencies): Promise<void> {
  const { binding, reference } = validatedAsset(asset, quizId);
  await withDriveAccess(binding, async access => {
    await access.files.verify(access.accessToken, access.account, reference);
  }, dependencies);
}

export async function readDriveAsset(asset: Record<string, unknown>, quizId: string, dependencies?: DriveRuntimeDependencies): Promise<Buffer> {
  const { binding, reference } = validatedAsset(asset, quizId);
  const imageKey = asset.kind === 'image' ? JSON.stringify([binding, reference]) : undefined;
  const cached = imageKey ? driveImageBytes.get(imageKey) : undefined;
  const verified = await withDriveAccess(binding, async access => {
    if (cached) {
      // Byte identity is immutable; current owner, connection, folder/file ACLs still gate every hit.
      await access.files.verify(access.accessToken, access.account, reference);
      return cached;
    }
    const bytes = await access.files.download(access.accessToken, access.account, reference);
    if (bytes.length !== reference.size || createHash('sha256').update(bytes).digest('hex') !== reference.sha256
      || createHash('md5').update(bytes).digest('hex') !== reference.md5Checksum || !mediaSignature(bytes, reference.mimeType)) invalid();
    return bytes;
  }, dependencies);
  // Do not retain a download rejected by the final current-owner/connection checkpoint.
  if (imageKey && !cached) driveImageBytes.put(imageKey, verified);
  return verified;
}
