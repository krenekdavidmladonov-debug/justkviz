import { HttpsError } from 'firebase-functions/v2/https';
import { DriveImportService, type DriveImportFiles, type DriveImportProcessor } from './imports.js';
import { firestoreDriveImportStore } from './import-store.js';
import { requireRealDriveRuntime } from './config.js';
import { withDriveAccess } from './runtime.js';
import type { DriveImportTarget } from './import-model.js';

export function requireDriveMediaImportRuntime(): void {
  requireRealDriveRuntime();
  if (process.env.DRIVE_CONNECTION_ENABLED !== 'true' || process.env.DRIVE_MEDIA_ENABLED !== 'true') {
    throw new HttpsError('failed-precondition', 'Automatické ukládání médií zatím není zapnuté.');
  }
}
export function driveMediaImportService(ownerUid: string, target: DriveImportTarget, processor: DriveImportProcessor | null): DriveImportService {
  const files: DriveImportFiles = {
    generateId: connection => withDriveAccess({ ownerUid, quizId: target.quizId, connectionGeneration: connection.generation,
      accountPermissionId: connection.accountPermissionId, folderId: connection.folderId }, access => access.files.generateId(access.accessToken)),
    upload: (connection, input) => withDriveAccess({ ownerUid, quizId: target.quizId, connectionGeneration: connection.generation,
      accountPermissionId: connection.accountPermissionId, folderId: connection.folderId }, access => access.files.upload(access.accessToken, { ...input, account: access.account })),
  };
  return new DriveImportService(ownerUid, firestoreDriveImportStore(), processor, files, Date.now, 500_000);
}
