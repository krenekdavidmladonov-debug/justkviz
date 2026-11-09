/* global document, createImageBitmap */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** All bytes originate in local canvas/lavfi generators; no downloaded media. */
export async function createOfflineMedia(page, outputDirectory) {
  const directory = path.resolve(outputDirectory);
  const localRoot = path.resolve('.local-data') + path.sep;
  assert(directory.startsWith(localRoot), 'Offline synthetic media belongs in ignored .local-data.');
  const ffmpeg = process.env.OFFLINE_QA_FFMPEG_PATH ??
    (process.platform === 'win32' ? 'C:/Projects/filmovy-kviz-v2/.tools/ffmpeg-media/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe' : '/usr/bin/ffmpeg');
  assert(path.isAbsolute(ffmpeg), 'OFFLINE_QA_FFMPEG_PATH must name an absolute local executable.');
  await mkdir(directory, { recursive: true });
  const generatedImages = await page.evaluate(async () => {
    const images = [];
    for (const [index, contentType] of ['image/png', 'image/jpeg', 'image/webp'].entries()) {
      const canvas = document.createElement('canvas');
      canvas.width = 24 + index; canvas.height = 12 + index;
      const context = canvas.getContext('2d');
      context.fillStyle = ['#228844', '#3377aa', '#ddaa22'][index];
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#111111'; context.fillRect(2, 2, 5, 5);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, contentType, 0.9));
      if (!blob || blob.type !== contentType) throw new Error('Synthetic image encoder unavailable.');
      const bitmap = await createImageBitmap(blob);
      try { images.push({ kind: 'image', contentType, width: bitmap.width, height: bitmap.height,
        bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) }); }
      finally { bitmap.close(); }
    }
    return images;
  });
  const assets = generatedImages.map(image => ({ ...image, bytes: Buffer.from(image.bytes) }));
  const audioInput = ['-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=44100'];
  const jobs = [
    { filename: 'synthetic-owned.mp4', kind: 'video', contentType: 'video/mp4', width: 384, height: 216,
      args: ['-f', 'lavfi', '-i', 'testsrc2=size=384x216:rate=15', ...audioInput, '-t', '5',
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '28', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart'] },
    { filename: 'synthetic-owned.mp3', kind: 'audio', contentType: 'audio/mpeg',
      args: [...audioInput, '-t', '5', '-c:a', 'libmp3lame', '-b:a', '64k'] },
    { filename: 'synthetic-owned.wav', kind: 'audio', contentType: 'audio/wav',
      args: ['-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=8000', '-t', '5', '-c:a', 'pcm_s16le'] },
  ];
  for (const { args, ...job } of jobs) {
    const filename = path.join(directory, job.filename);
    await execute(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-n', ...args, filename], {
      windowsHide: true, timeout: 30_000, maxBuffer: 64 * 1024,
    });
    assets.push({ ...job, bytes: await readFile(filename), filename });
  }
  return assets.map(asset => ({ ...asset, size: asset.bytes.length, sha256: sha256(asset.bytes) }));
}

/** Native playback proof, deliberately muted; this makes no hardware audibility claim. */
export async function verifyOfflineNativeMedia(page, asset) {
  return page.evaluate(async ({ bytes, contentType, kind }) => {
    const blob = new Blob([new Uint8Array(bytes)], { type: contentType });
    if (kind === 'image') {
      const bitmap = await createImageBitmap(blob);
      try { return { width: bitmap.width, height: bitmap.height, decoded: true }; }
      finally { bitmap.close(); }
    }
    const media = document.createElement(kind === 'video' ? 'video' : 'audio');
    const url = URL.createObjectURL(blob);
    media.muted = true; media.src = url; document.body.append(media);
    const deadline = promise => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Synthetic native media deadline exceeded.')), 5000);
      promise.then(value => { clearTimeout(timeout); resolve(value); }, error => { clearTimeout(timeout); reject(error); });
    });
    try {
      await deadline(new Promise((resolve, reject) => {
        media.onloadeddata = resolve; media.onerror = () => reject(new Error('Native media decode error.'));
      }));
      await deadline(media.play());
      const frame = kind === 'video' ? await deadline(new Promise(resolve => {
        media.requestVideoFrameCallback((_, metadata) => resolve({ width: metadata.width, height: metadata.height }));
      })) : null;
      await deadline(new Promise(resolve => {
        const start = media.currentTime;
        const observe = () => media.currentTime > start + 0.15 ? resolve() : setTimeout(observe, 20);
        observe();
      }));
      const result = { duration: media.duration, currentTime: media.currentTime, frame, playing: !media.paused,
        width: kind === 'video' ? media.videoWidth : null, height: kind === 'video' ? media.videoHeight : null };
      media.pause();
      return { ...result, paused: media.paused, decoded: media.error === null };
    } finally {
      media.pause(); media.removeAttribute('src'); media.load(); media.remove(); URL.revokeObjectURL(url);
    }
  }, { bytes: [...asset.bytes], contentType: asset.contentType, kind: asset.kind });
}
