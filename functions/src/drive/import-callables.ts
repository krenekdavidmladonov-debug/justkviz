import { getFunctions } from 'firebase-admin/functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { authorize, freshIdentity } from '../access/authorization.js';
import { importTarget, type DriveImportLocator } from './import-model.js';
import { driveMediaImportService, requireDriveMediaImportRuntime } from './import-service.js';

const region = 'europe-west1';
const permissions = ['users.manage', 'quiz.media.upload', 'quiz.media.attach', 'quiz.edit', 'quiz.read', 'quiz.answers.read'] as const;
export const requestDriveMediaImport = onCall({ region, cors: true, maxInstances: 5, timeoutSeconds: 60 }, async request => {
  requireDriveMediaImportRuntime();
  const target = importTarget(request.data);
  await freshIdentity(request.auth);
  const member = await authorize(request.auth, permissions, { kind: 'quiz', id: target.quizId });
  if (member.role !== 'owner') throw new HttpsError('permission-denied', 'Příprava média není povolena.');
  const status = await driveMediaImportService(member.uid, target, null).request(target, process.env.DRIVE_MEDIA_LOCAL_ENABLED === 'true' ? 'local' : 'cloud');
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
  requireDriveMediaImportRuntime();
  const target = importTarget(request.data, true) as DriveImportLocator;
  await freshIdentity(request.auth);
  const member = await authorize(request.auth, permissions, { kind: 'quiz', id: target.quizId });
  if (member.role !== 'owner') throw new HttpsError('permission-denied', 'Příprava média není povolena.');
  return driveMediaImportService(member.uid, target, null).status(target);
});
