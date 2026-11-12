import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';

// Reviewed local Windows x64 artifacts. Packaging has no downloader and fails
// closed on any hash/size change; an update requires a deliberate source review.
export const runtimePins = Object.freeze([
  { name: 'yt-dlp.exe', source: '.tools/yt-dlp/yt-dlp.exe', version: '2026.08.19', bytes: 17840399,
    sha256: '66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a' },
  { name: 'ffmpeg.exe', source: '.tools/ffmpeg-media/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe', version: '9.0.2-essentials_build', bytes: 105423872,
    sha256: '3256173f3f8bffd7df12227c68adf68025edb1832273a9530688a7bb1ed8edec' },
  { name: 'ffprobe.exe', source: '.tools/ffmpeg-media/ffmpeg-9.0.2-essentials_build/bin/ffprobe.exe', version: '9.0.2-essentials_build', bytes: 105221120,
    sha256: 'f0d36ecbbdd3bcfac3efa078c96c7271c2e68b3810595552ac3b7f17e9a65c52' },
  { name: 'node.exe', source: '.tools/node22/node.exe', version: '22.23.2', bytes: 86997320,
    sha256: '0d0f5e39f9f3d9587bc19f73eab3c2c9c4903fd02d6dbf9c853dd81b3d95fad4' },
]);

export async function sha256(filename) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

export async function verifyExecutable(filename, pin) {
  const info = await lstat(filename);
  if (!info.isFile() || info.isSymbolicLink() || info.size !== pin.bytes || await sha256(filename) !== pin.sha256) throw new Error('runtime-verification-failed');
  const descriptor = await open(filename, 'r');
  try {
    const dos = Buffer.alloc(64); await descriptor.read(dos, 0, dos.length, 0);
    const offset = dos.readUInt32LE(0x3c);
    if (dos.toString('ascii', 0, 2) !== 'MZ' || offset > info.size - 6) throw new Error('runtime-verification-failed');
    const pe = Buffer.alloc(6); await descriptor.read(pe, 0, pe.length, offset);
    if (!pe.subarray(0, 4).equals(Buffer.from([80, 69, 0, 0])) || pe.readUInt16LE(4) !== 0x8664) throw new Error('runtime-verification-failed');
  } finally { await descriptor.close(); }
}

export async function verifyPortableRuntime(directory) {
  const binaries = path.join(directory, 'bin');
  const info = await lstat(binaries);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(binaries) !== binaries) throw new Error('runtime-verification-failed');
  for (const pin of runtimePins) await verifyExecutable(path.join(binaries, pin.name), pin);
}
