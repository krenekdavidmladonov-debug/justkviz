import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ffprobeSample } from './ffprobe-sample.mjs';

// Fixed publisher release asset; bytes and the contained ELF are pinned independently.
export const FFPROBE_PIN = Object.freeze({
  publisher: 'FFmpeg-Builds/FFmpeg-Builds', assetId: 695397913, license: 'GPL-3.0',
  source: 'https://github.com/FFmpeg/FFmpeg/commit/4811625b5f',
  version: 'N-128227-g4811625b5f', archiveRoot: 'ffmpeg-N-128227-g4811625b5f-linux64-gpl',
  url: 'https://github.com/FFmpeg-Builds/FFmpeg-Builds/releases/download/autobuild-2026-10-31-12-59/ffmpeg-N-128227-g4811625b5f-linux64-gpl.tar.xz',
  archiveBytes: 157360624, archiveSha256: '67929be39bbb696f41d3295686597a439aeac902f61d82be660ccc1453c1fdfb',
  binaryBytes: 176493896, binarySha256: '051ec8183c385a29f6a07550b44a377fb7ff6cd013b0561e195c7c6934b518cf',
});
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const archivePath = root => path.join(root, '.tools/d2-ffprobe', FFPROBE_PIN.archiveSha256 + '.tar.xz');
function checkArchive(bytes) {
  assert.equal(bytes.length, FFPROBE_PIN.archiveBytes, 'FFprobe archive size mismatch');
  assert.equal(digest(bytes), FFPROBE_PIN.archiveSha256, 'FFprobe archive SHA256 mismatch');
}
export async function prepareFfprobe(root = process.cwd()) {
  const file = archivePath(root);
  try { checkArchive(await readFile(file)); return file; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const response = await fetch(FFPROBE_PIN.url, { redirect: 'follow', signal: AbortSignal.timeout(120000) });
  assert(response.ok && response.body && ['github.com', 'release-assets.githubusercontent.com'].includes(new URL(response.url).hostname), 'Pinned FFprobe download failed');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length; assert(size <= FFPROBE_PIN.archiveBytes, 'FFprobe archive download exceeds pinned size'); chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks); checkArchive(bytes);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes, { flag: 'wx' });
  return file;
}
export async function ffprobeFiles(read, root = process.cwd()) {
  const archive = archivePath(root);
  checkArchive(await readFile(archive));
  const extract = name => execFileSync('tar', ['-xOf', archive, name], { windowsHide: true, maxBuffer: 256 * 1024 * 1024 });
  const binary = extract(FFPROBE_PIN.archiveRoot + '/bin/ffprobe');
  assert.equal(binary.length, FFPROBE_PIN.binaryBytes);
  assert.equal(digest(binary), FFPROBE_PIN.binarySha256);
  assert(binary.subarray(0, 7).equals(Buffer.from([127, 69, 76, 70, 2, 1, 1])) && binary.readUInt16LE(18) === 62, 'Expected Linux x86_64 ELF');
  const license = read('tools/deploy/ffprobe-runtime.LICENSE');
  assert.equal(license.replace(/\r\n/gu, '\n'), extract(FFPROBE_PIN.archiveRoot + '/LICENSE.txt').toString('utf8').replace(/\r\n/gu, '\n'));
  assert(license.includes('GNU GENERAL PUBLIC LICENSE') && license.includes('Version 3, 29 June 2007'));
  return new Map([
    ['worker/bin/ffprobe', binary], ['worker/licenses/ffprobe-LICENSE.txt', license],
    ['worker/licenses/ffprobe-provenance.json', JSON.stringify(FFPROBE_PIN, null, 2) + '\n'],
  ]);
}
export const ffprobeVerification = `
const probePath = new URL('./worker/bin/ffprobe', import.meta.url);
const probe = readFileSync(probePath);
assert.equal(probe.length, ${FFPROBE_PIN.binaryBytes});
assert.equal(createHash('sha256').update(probe).digest('hex'), '${FFPROBE_PIN.binarySha256}');
assert.equal(process.platform, 'linux'); assert.equal(process.arch, 'x64');
const version = execFileSync(fileURLToPath(probePath), ['-version'], { timeout: 10000, maxBuffer: 65536, env: { PATH: process.env.PATH ?? '', LANG: 'C' } }).toString();
assert(version.split(/\\r?\\n/)[0].includes('${FFPROBE_PIN.version}'), 'Pinned FFprobe version must execute');
// Probe a tiny PCM WAV supplied through stdin: no files, providers or network.
const wav = Buffer.alloc(46); wav.write('RIFF'); wav.writeUInt32LE(38,4); wav.write('WAVEfmt ',8); wav.writeUInt32LE(16,16);
wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22); wav.writeUInt32LE(8000,24); wav.writeUInt32LE(16000,28);
wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34); wav.write('data',36); wav.writeUInt32LE(2,40);
const probed = JSON.parse(execFileSync(fileURLToPath(probePath), ['-v','error','-protocol_whitelist','file,pipe','-show_entries','stream=codec_type,codec_name','-of','json','pipe:0'], { input: wav, timeout: 10000, maxBuffer: 65536, env: { PATH: process.env.PATH ?? '', LANG: 'C' } }));
assert.deepEqual(probed.streams.map(stream => [stream.codec_type, stream.codec_name]), [['audio','pcm_s16le']]);
const { validateLocalOutput } = await import('./lib/drive/local-output.js');
const checked = await validateLocalOutput({ type: 'youtube', kind: 'video', videoId: 'synthetic01', startSeconds: 0, endSeconds: 1 }, Buffer.from('${ffprobeSample}', 'base64'));
assert.equal(checked.contentType, 'video/mp4'); assert(Math.abs(checked.durationSeconds - 1) < 0.3);
assert(readFileSync(new URL('./worker/licenses/ffprobe-LICENSE.txt', import.meta.url), 'utf8').includes('GNU GENERAL PUBLIC LICENSE'));
`;
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert.deepEqual(process.argv.slice(2), ['--prepare']);
  console.log(await prepareFfprobe());
}
