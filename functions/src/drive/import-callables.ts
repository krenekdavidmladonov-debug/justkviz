import { getFunctions } from 'firebase-admin/functions';
import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { authorize, freshIdentity } from '../access/authorization.js';
import { requireRealDriveRuntime } from './config.js';
import { importId, importTarget, type DriveImportJob, type DriveImportLocator, type DriveImportTarget } from './import-model.js';
import { DriveImportService, type DriveImportFiles } from './imports.js';
import { firestoreDriveImportStore } from './import-store.js';
import { driveImportProcessor } from './processor.js';
import { driveRuntimeSecrets, withDriveAccess } from './runtime.js';

const region = 'europe-west1';
const permissions = ['users.manage', 'quiz.media.upload', 'quiz.media.attach', 'quiz.edit', 'quiz.read', 'quiz.answers.read'] as const;
function enabled(): void {
  requireRealDriveRuntime();
  if (process.env.DRIVE_CONNECTION_ENABLED !== 'true' || process.env.DRIVE_MEDIA_ENABLED !== 'true') {
    throw new HttpsError('failed-precondition', 'Automatické ukládání médií zatím není zapnuté.');
  }
}
function service(ownerUid: string, target: DriveImportTarget): DriveImportService {
  const files: DriveImportFiles = {
    generateId: connection => withDriveAccess({ ownerUid, quizId: target.quizId, connectionGeneration: connection.generation,
      accountPermissionId: connection.accountPermissionId, folderId: connection.folderId }, access => access.files.generateId(access.accessToken)),
    upload: (connection, input) => withDriveAccess({ ownerUid, quizId: target.quizId, connectionGeneration: connection.generation,
      accountPermissionId: connection.accountPermissionId, folderId: connection.folderId }, access => access.files.upload(access.accessToken, { ...input, account: access.account })),
  };
  return new DriveImportService(ownerUid, firestoreDriveImportStore(), driveImportProcessor, files, Date.now, 500_000);
}

export const requestDriveMediaImport = onCall({ region, cors: true, maxInstances: 5, timeoutSeconds: 60 }, async request => {
  enabled();
  const target = importTarget(request.data);
  await freshIdentity(request.auth);
  const member = await authorize(request.auth, permissions, { kind: 'quiz', id: target.quizId });
  if (member.role !== 'owner') throw new HttpsError('permission-denied', 'Příprava média není povolena.');
  const status = await service(member.uid, target).request(target, process.env.DRIVE_MEDIA_LOCAL_ENABLED === 'true' ? 'local' : 'cloud');
  if (status.execution !== 'local' && (status.status === 'queued' || status.status === 'failed' || status.status === 'processing')) {
    // An enqueue failure remains retryable; the deterministic job and reserved Drive ID prevent duplicate attachment.
    try {
      await getFunctions().taskQueue('locations/' + region + '/functions/processDriveMediaImport').enqueue(
        { ownerUid: member.uid, ...target, jobId: status.jobId }, { dispatchDeadlineSeconds: 540 });
    } catch { throw new HttpsError('unavailable', 'Přípravu média se nepodařilo spustit. Zkuste ji znovu.'); }
  }
  return status;
});

export const readDriveMediaImport = onCall({ region, cors: true, maxInstances: 5, timeoutSeconds: 30 }, async request => {
  enabled();
  const target = importTarget(request.data, true) as DriveImportLocator;
  await freshIdentity(request.auth);
  const member = await authorize(request.auth, permissions, { kind: 'quiz', id: target.quizId });
  if (member.role !== 'owner') throw new HttpsError('permission-denied', 'Příprava média není povolena.');
  return service(member.uid, target).status(target);
});

export const processDriveMediaImport = onTaskDispatched({ region, invoker: 'private', timeoutSeconds: 540,
  memory: '2GiB', cpu: 1, concurrency: 1, maxInstances: 2, secrets: driveRuntimeSecrets,
  retryConfig: { maxAttempts: 3, minBackoffSeconds: 60, maxBackoffSeconds: 120, maxDoublings: 1 },
  rateLimits: { maxConcurrentDispatches: 2, maxDispatchesPerSecond: 1 },
}, async request => {
  enabled();
  const data: unknown = request.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid media task.');
  const { ownerUid, ...input } = data as Record<string, unknown>;
  const target = importTarget(input, true) as DriveImportLocator;
  const owner = importId(ownerUid);
  if (process.env.DRIVE_MEDIA_LOCAL_ENABLED === 'true') {
    // A queued task from the previous release must not download YouTube in the
    // cloud after local processing is activated. A new owner save/retry routes
    // the same authoritative source to the companion; photos keep this queue.
    const job = (await getFirestore().doc('driveMediaJobs/' + target.jobId).get()).data() as DriveImportJob | undefined;
    if (job?.ownerUid === owner && job.quizId === target.quizId && job.slideId === target.slideId
      && job.field === target.field && job.source?.type === 'youtube') return;
  }
  const status = await service(owner, target).run(target);
  if (status.status === 'processing' || (status.status === 'failed' && status.errorCode === 'processing-failed')) {
    throw new Error('Media processing needs a retry.');
  }
});
