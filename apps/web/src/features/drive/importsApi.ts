import { parseQuizAsset } from '@filmovy-kviz/quiz-domain';
import { accessCall } from '../access/api';

export const driveImportFields = ['mediaSource', 'questionImage', 'answerImage', 'backgroundImage'] as const;
export type DriveImportField = typeof driveImportFields[number];
export interface DriveImportTarget { readonly quizId: string; readonly slideId: string; readonly field: DriveImportField }
export type DriveImportStatus = 'queued' | 'processing' | 'ready' | 'failed' | 'stale';
export interface DriveImportResult { readonly jobId: string; readonly status: DriveImportStatus; readonly reference?: string; readonly execution?: 'local' | 'cloud' }

function result(value: unknown, quizId: string): DriveImportResult {
  if (!value || typeof value !== 'object' || !('jobId' in value) || typeof value.jobId !== 'string'
    || !/^[A-Za-z0-9_-]{1,200}$/u.test(value.jobId) || !('status' in value) || typeof value.status !== 'string'
    || !['queued', 'processing', 'ready', 'failed', 'stale'].includes(value.status)) throw new Error('Neplatný stav ukládání média.');
  const reference = 'reference' in value ? value.reference : undefined;
  const execution = 'execution' in value ? value.execution : undefined;
  if (reference !== undefined && (typeof reference !== 'string' || parseQuizAsset(reference)?.quizId !== quizId)) throw new Error('Neplatný stav ukládání média.');
  if (execution !== undefined && execution !== 'local' && execution !== 'cloud') throw new Error('Neplatný stav ukládání média.');
  return { jobId: value.jobId, status: value.status as DriveImportStatus, ...(reference === undefined ? {} : { reference }), ...(execution === undefined ? {} : { execution }) };
}
export async function requestDriveMediaImport(target: DriveImportTarget): Promise<DriveImportResult> {
  return result(await accessCall<unknown>('requestDriveMediaImport', { ...target }), target.quizId);
}
export async function readDriveMediaImport(target: DriveImportTarget, jobId: string): Promise<DriveImportResult> {
  return result(await accessCall<unknown>('readDriveMediaImport', { ...target, jobId }), target.quizId);
}
