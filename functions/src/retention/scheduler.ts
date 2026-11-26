import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { runRetention, type RetentionMode } from './engine.js';

export function retentionConfiguration(environment: NodeJS.ProcessEnv = process.env): { mode: RetentionMode; resultsMode: 'off' | 'preview' } {
  const value = environment.JUSTKVIZ_CONTACT_RETENTION_MODE;
  return { mode: value === 'preview' || value === 'apply' ? value : 'off',
    resultsMode: environment.JUSTKVIZ_RESULTS_RETENTION_MODE === 'preview' ? 'preview' : 'off' };
}

export const runEventRetention = onSchedule({ schedule: '0 3 * * *', timeZone: 'Europe/Prague', region: 'europe-west1',
  invoker: 'private', maxInstances: 1, concurrency: 1, retryCount: 0, timeoutSeconds: 300 }, async () => {
  const summary = await runRetention(getFirestore(), retentionConfiguration());
  const { nextPreviewCursor, ...counts } = summary;
  logger.info('Event retention summary', { ...counts, previewHasMore: nextPreviewCursor !== undefined });
});
