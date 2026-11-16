import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const sine = ['-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=44100'];
const formats = {
  video: { filename: 'owned-video.mp4', kind: 'video', contentType: 'video/mp4', args: [
    '-f', 'lavfi', '-i', 'testsrc2=size=384x216:rate=15', ...sine, '-t', '5',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '28', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart',
  ] },
  mp3: { filename: 'owned-audio.mp3', kind: 'audio', contentType: 'audio/mpeg', args: [...sine, '-t', '5', '-c:a', 'libmp3lame', '-b:a', '64k'] },
  audioOnlyMp4: { filename: 'audio-only.mp4', kind: 'video', contentType: 'video/mp4', args: [
    ...sine, '-t', '5', '-vn', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', '-f', 'mp4',
  ] },
};

export const mediaUploadSha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** Native lavfi inputs only. Each invocation writes its own ignored fixture directory. */
export async function createMediaUploadFixtures(keys = Object.keys(formats)) {
  const root = path.resolve('.local-data/media-storage');
  const ffmpeg = process.env.OFFLINE_QA_FFMPEG_PATH ?? (process.platform === 'win32'
    ? 'C:/Projects/filmovy-kviz-v2/.tools/ffmpeg-media/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe' : '/usr/bin/ffmpeg');
  assert(path.isAbsolute(ffmpeg));
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'synthetic-upload-'));
  const result = {};
  for (const key of keys) {
    assert(Object.hasOwn(formats, key));
    const { args, filename: basename, ...format } = formats[key];
    const filename = path.join(directory, basename);
    await execute(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-n', ...args, filename], { windowsHide: true, timeout: 30_000, maxBuffer: 64 * 1024 });
    const bytes = await readFile(filename);
    result[key] = { ...format, filename, bytes, sha256: mediaUploadSha256(bytes) };
  }
  return result;
}
