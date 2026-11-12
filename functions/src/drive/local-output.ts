import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DriveImportSource } from './import-model.js';
import type { PreparedDriveMedia } from './imports.js';
import { mediaSignature } from '../media/model.js';

export const maximumLocalOutput = 25 * 1024 * 1024;
type YoutubeSource = Extract<DriveImportSource, { type: 'youtube' }>;
/** Probe output is untrusted too: allow only the reviewed streams/container and exact saved interval. */
export function localProbeDuration(source: YoutubeSource, input: unknown): number {
  if (!input || typeof input !== 'object') throw new Error('INVALID_LOCAL_OUTPUT');
  const data = input as { format?: { duration?: unknown; format_name?: unknown }; streams?: { codec_type?: unknown; codec_name?: unknown; width?: unknown; height?: unknown; channels?: unknown }[] };
  const duration = Number(data.format?.duration), streams = data.streams;
  const formats = typeof data.format?.format_name === 'string' ? data.format.format_name.split(',') : [];
  if (!Number.isFinite(duration) || duration <= 0 || Math.abs(duration - (source.endSeconds - source.startSeconds)) > 0.3
    || duration > 180.3 || !Array.isArray(streams) || streams.length < 1 || streams.length > 2) throw new Error('INVALID_LOCAL_OUTPUT');
  if (source.kind === 'audio') {
    if (!formats.includes('mp3') || streams.length !== 1 || streams[0]?.codec_type !== 'audio' || streams[0].codec_name !== 'mp3'
      || !Number.isInteger(streams[0].channels) || Number(streams[0].channels) < 1 || Number(streams[0].channels) > 2) throw new Error('INVALID_LOCAL_OUTPUT');
  } else {
    const video = streams.filter(stream => stream.codec_type === 'video'), audio = streams.filter(stream => stream.codec_type === 'audio');
    if (!formats.includes('mp4') || streams.length !== 2 || video.length !== 1 || audio.length !== 1 || video[0]?.codec_name !== 'h264'
      || audio[0]?.codec_name !== 'aac' || !Number.isInteger(video[0].width) || !Number.isInteger(video[0].height)
      || Number(video[0].width) < 1 || Number(video[0].height) < 1 || Number(video[0].width) > 1280 || Number(video[0].height) > 720
      || !Number.isInteger(audio[0].channels) || Number(audio[0].channels) < 1 || Number(audio[0].channels) > 2) throw new Error('INVALID_LOCAL_OUTPUT');
  }
  return duration;
}
export async function validateLocalOutput(source: DriveImportSource, bytes: Buffer,
  probePath = fileURLToPath(new URL('../../worker/bin/ffprobe', import.meta.url))): Promise<PreparedDriveMedia> {
  if (source.type !== 'youtube' || !Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > maximumLocalOutput) throw new Error('INVALID_LOCAL_OUTPUT');
  const contentType = source.kind === 'audio' ? 'audio/mpeg' : 'video/mp4';
  if (!mediaSignature(bytes, contentType)) throw new Error('INVALID_LOCAL_OUTPUT');
  const directory = await mkdtemp(join(tmpdir(), 'justkviz-local-output-'));
  const path = join(directory, source.kind === 'audio' ? 'clip.mp3' : 'clip.mp4');
  try {
    await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(probePath, ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_entries',
        'format=duration,format_name:stream=codec_type,codec_name,channels,width,height', '-of', 'json', path],
      { timeout: 30_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024, windowsHide: true, encoding: 'utf8' },
      (error, output) => error ? reject(new Error('INVALID_LOCAL_OUTPUT')) : resolve(output));
    });
    return { bytes, contentType, durationSeconds: localProbeDuration(source, JSON.parse(stdout)) };
  } finally { await unlink(path).catch(() => undefined); await rmdir(directory); }
}
