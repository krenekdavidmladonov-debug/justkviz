import { getFirestore } from 'firebase-admin/firestore';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { importId, importTarget, type DriveImportJob, type DriveImportLocator } from './import-model.js';
import { driveImportProcessor } from './processor.js';
import { driveRuntimeSecrets } from './runtime.js';
import { driveMediaImportService, requireDriveMediaImportRuntime } from './import-service.js';

const region = 'europe-west1';
export const processDriveMediaImport = onTaskDispatched({ region, invoker: 'private', timeoutSeconds: 540,
  memory: '2GiB', cpu: 1, concurrency: 1, maxInstances: 2, secrets: driveRuntimeSecrets,
  retryConfig: { maxAttempts: 3, minBackoffSeconds: 60, maxBackoffSeconds: 120, maxDoublings: 1 },
  rateLimits: { maxConcurrentDispatches: 2, maxDispatchesPerSecond: 1 },
}, async request => {
  requireDriveMediaImportRuntime();
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
  const status = await driveMediaImportService(owner, target, driveImportProcessor).run(target);
  if (status.status === 'processing' || (status.status === 'failed' && status.errorCode === 'processing-failed')) {
    throw new Error('Media processing needs a retry.');
  }
});
