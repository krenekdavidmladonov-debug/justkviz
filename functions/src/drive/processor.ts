import { open } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { warn } from 'firebase-functions/logger';
import { parseQuizAsset } from '@filmovy-kviz/quiz-domain';
import { mediaBucket } from '../media/storage.js';
import { assetPath, mediaSignature } from '../media/model.js';
import { requireRealDriveRuntime } from './config.js';
import { fetchPrivateImage } from './images.js';
import type { DriveImportProcessor } from './imports.js';

interface Clip { path: string; contentType: string; durationSeconds: number; cleanup(): Promise<void> }
interface ClipWorker {
  createYouTubeClip(request: { videoId: string; startSeconds: number; endSeconds: number; kind: 'video' | 'audio' },
    config: { ytDlpPath: string; ffmpegPath: string; ffprobePath: string; nodePath: string; tempRoot: string; deadlineMs: number }): Promise<Clip>;
}
const clipCodes = ['invalid-input', 'invalid-config', 'deadline-exceeded', 'source-too-large', 'output-too-large', 'process-failed', 'invalid-media'];
const clipPhases = ['setup', 'tools', 'download-video', 'download-audio', 'transcode', 'verify', 'ready'];
const diagnosticCodes = ['runtime-library-missing', 'runtime-option-unsupported', 'provider-sign-in-required', 'provider-rate-limited',
  'provider-access-denied', 'provider-unavailable', 'format-unavailable', 'network-failed', 'executable-missing',
  'executable-not-permitted', 'executable-start-failed', 'timeout', 'stdout-limit', 'stderr-limit', 'file-write-failed', 'process-exit'];
type VideoStage = 'worker-load' | 'clip' | 'output-read' | 'output-verify' | 'cleanup';
/** Construct a fresh fixed-label log record; never spread/serialize the thrown object. */
export function safeClipFailure(error: unknown, stage: VideoStage): Record<string, string> {
  const result: Record<string, string> = { stage };
  if (!error || typeof error !== 'object') return result;
  const value = error as Record<string, unknown>;
  if (value.name !== 'ClipError') return result;
  for (const [key, allowed] of [['code', clipCodes], ['phase', clipPhases], ['tool', ['ytDlp', 'ffmpeg', 'ffprobe']],
    ['diagnosticCode', diagnosticCodes]] as const) {
    if (typeof value[key] === 'string' && (allowed as readonly string[]).includes(value[key])) result[key] = value[key];
  }
  return result;
}
/** Metadata rejects oversized output before allocation; an inclusive read cap also bounds concurrent file growth. */
export async function readBoundedClip(path: string): Promise<Buffer> {
  const maximum = 25 * 1024 * 1024, handle = await open(path, 'r');
  try {
    const before = await handle.stat();
    if (!before.isFile() || !Number.isSafeInteger(before.size) || before.size < 1 || before.size > maximum) throw new Error('OUTPUT_INVALID');
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of handle.createReadStream({ start: 0, end: maximum, autoClose: false })) {
      if (!(chunk instanceof Buffer)) throw new Error('OUTPUT_INVALID');
      size += chunk.length;
      if (size > maximum) throw new Error('OUTPUT_INVALID');
      chunks.push(chunk);
    }
    const after = await handle.stat();
    if (size !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error('OUTPUT_INVALID');
    return Buffer.concat(chunks, size);
  } finally { await handle.close(); }
}
/** Release packaging must supply reviewed worker and Linux binaries. No downloads/install at runtime. */
export const driveImportProcessor: DriveImportProcessor = { async prepare(source, target) {
  requireRealDriveRuntime();
  if (process.env.DRIVE_MEDIA_ENABLED !== 'true') throw new Error('MEDIA_NOT_ENABLED');
  if (source.type === 'https-image') return fetchPrivateImage(source.url);
  if (source.type === 'owned-image') {
    const parsed = parseQuizAsset(source.reference);
    if (!parsed || parsed.quizId !== target.quizId || !/^\d+$/u.test(source.generation) || source.size > 10 * 1024 * 1024) throw new Error('SOURCE_INVALID');
    const [bytes] = await mediaBucket().file(assetPath(parsed.quizId, parsed.assetId), { generation: source.generation }).download({ start: 0, end: source.size });
    if (bytes.length !== source.size || !mediaSignature(bytes, source.contentType)) throw new Error('SOURCE_INVALID');
    return { bytes, contentType: source.contentType };
  }
  let stage: VideoStage = 'worker-load';
  try {
    const workerUrl = new URL('../../worker/clip.mjs', import.meta.url);
    const worker = await import(workerUrl.href) as ClipWorker;
    const binary = (name: string) => fileURLToPath(new URL('../../worker/bin/' + name, import.meta.url));
    stage = 'clip';
    const clip = await worker.createYouTubeClip({ videoId: source.videoId, startSeconds: source.startSeconds,
      endSeconds: source.endSeconds, kind: source.kind }, { ytDlpPath: binary('yt-dlp'), ffmpegPath: binary('ffmpeg'),
      ffprobePath: binary('ffprobe'), nodePath: process.execPath, tempRoot: tmpdir(), deadlineMs: 420_000 });
    try {
      stage = 'output-read';
      const bytes = await readBoundedClip(clip.path);
      stage = 'output-verify';
      if (bytes.length > 25 * 1024 * 1024 || !mediaSignature(bytes, clip.contentType)) throw new Error('OUTPUT_INVALID');
      return { bytes, contentType: clip.contentType, durationSeconds: clip.durationSeconds };
    } finally {
      await clip.cleanup().catch(error => { stage = 'cleanup'; throw error; });
    }
  } catch (error) {
    warn('Drive media clip preparation failed.', safeClipFailure(error, stage));
    throw error;
  }
} };
