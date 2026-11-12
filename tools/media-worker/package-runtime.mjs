import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, lstat, mkdir, open, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { verifyRuntime } from './verify-runtime.mjs';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const ytBase = 'https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/';
const ffBase = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-16-13-04/';
const ytSource = 'https://raw.githubusercontent.com/yt-dlp/yt-dlp/3a08beaf031ab68f966401ead017ac81fe8486cf/';
const ffRoot = 'ffmpeg-N-127579-g5cb9fcd211-linux64-gpl';
export const runtimePins = Object.freeze({
  platform: 'linux', architecture: 'x64',
  ytDlp: { version: '2026.08.19', commit: '3a08beaf031ab68f966401ead017ac81fe8486cf',
    filename: 'yt-dlp_linux', url: ytBase + 'yt-dlp_linux', size: 40_446_224,
    sha256: '58162f9bfdc27458ea47bfcb311cf47028f17d8154a8bf7d689861d46399230a' },
  ffmpeg: { version: 'N-127579-g5cb9fcd211-20261016', sourceVersion: 'N-127579-g5cb9fcd211', release: 'autobuild-2026-10-16-13-04',
    filename: ffRoot + '.tar.xz', url: ffBase + ffRoot + '.tar.xz', size: 156_246_852,
    sha256: '3d994f31aa9ee78ef56eab530a86d50d8307200cb9d1788be36c1ea9410e605c' },
  files: [
    { filename: 'yt-dlp-SHA2-256SUMS', url: ytBase + 'SHA2-256SUMS', size: 1595,
      sha256: 'a63701f30755cb4d9317950d69703e9d751d490cb1b7059e1bb501a353fe7dcb' },
    { filename: 'ffmpeg-checksums.sha256', url: ffBase + 'checksums.sha256', size: 5728,
      sha256: '7b414ac012daab382bc7720a980cf994ddcaf1ff9070fb2ca4df8f520c7b358d' },
    { filename: 'yt-dlp-LICENSE', url: ytSource + 'LICENSE', size: 1211,
      sha256: '7e12e5df4bae12cb21581ba157ced20e1986a0508dd10d0e8a4ab9a4cf94e85c' },
    { filename: 'yt-dlp-THIRD_PARTY_LICENSES.txt', url: ytSource + 'THIRD_PARTY_LICENSES.txt', size: 243550,
      sha256: '472aefe951c7db35e1657c1d13fd337140511ed6f2b329205105ad441c5a02b7' },
  ],
});

function contained(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('Runtime path escapes its package root.');
}
async function safeDirectory(relative) {
  const root = await realpath(repository), target = path.resolve(repository, relative);
  contained(repository, target);
  let cursor = repository;
  for (const segment of path.relative(repository, target).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    let data;
    try { data = await lstat(cursor); } catch (error) { if (error.code !== 'ENOENT') throw error; await mkdir(cursor); data = await lstat(cursor); }
    if (!data.isDirectory() || data.isSymbolicLink()) throw new Error('Runtime directories must be real directories.');
    contained(root, await realpath(cursor));
  }
  return target;
}
async function regularFile(filename) {
  try {
    const data = await lstat(filename);
    if (!data.isFile() || data.isSymbolicLink()) throw new Error('Runtime input must be a regular file.');
    return data;
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function digest(filename) {
  if (!await regularFile(filename)) throw new Error('Required runtime file is missing.');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}
function byteLimiter(maximum, hash) {
  let total = 0;
  return new Transform({ transform(chunk, _encoding, callback) {
    total += chunk.length;
    if (total > maximum) { callback(new Error('Runtime artifact exceeds its pinned size limit.')); return; }
    hash?.update(chunk); callback(null, chunk);
  } });
}
async function download(pin, downloads, offline) {
  const filename = path.join(downloads, pin.filename), existing = await regularFile(filename);
  if (existing) {
    if (existing.size !== pin.size || await digest(filename) !== pin.sha256) throw new Error('Cached runtime artifact does not match its pinned hash: ' + pin.filename);
    return filename;
  }
  if (offline) throw new Error('Offline cache is missing: ' + pin.filename);
  const partial = filename + '.' + randomUUID() + '.part';
  const timeout = AbortSignal.timeout(300_000);
  try {
    const response = await fetch(pin.url, { signal: timeout, redirect: 'follow' });
    const destination = new URL(response.url);
    if (!response.ok || !response.body || destination.protocol !== 'https:'
      || !['github.com', 'release-assets.githubusercontent.com', 'raw.githubusercontent.com'].includes(destination.hostname)) throw new Error('Runtime artifact download failed.');
    const hash = createHash('sha256');
    await pipeline(response.body, byteLimiter(pin.size, hash), createWriteStream(partial, { flags: 'wx', mode: 0o600 }));
    if ((await lstat(partial)).size !== pin.size || hash.digest('hex') !== pin.sha256) throw new Error('Downloaded artifact does not match its pinned SHA256: ' + pin.filename);
    await rename(partial, filename); return filename;
  } finally { await unlink(partial).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

export function checksumFor(text, filename) {
  const lines = text.split(/\r?\n/u).filter(line => line.endsWith('  ' + filename) || line.endsWith(' *' + filename));
  if (lines.length !== 1 || !/^[a-f0-9]{64} [ *]/u.test(lines[0])) throw new Error('Pinned filename is missing or duplicated in release checksums.');
  return lines[0].slice(0, 64);
}
export function safeArchiveMember(member) {
  return typeof member === 'string' && [ffRoot + '/bin/ffmpeg', ffRoot + '/bin/ffprobe', ffRoot + '/LICENSE.txt'].includes(member);
}
export function verifyElf64Header(header) {
  if (header.length < 64 || !header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
    || header[4] !== 2 || header[5] !== 1 || header[6] !== 1 || header.readUInt16LE(18) !== 62
    || ![2, 3].includes(header.readUInt16LE(16))) throw new Error('Expected an executable ELF64 little-endian x86_64 runtime.');
  return true;
}
async function verifyExecutable(filename) {
  await regularFile(filename);
  const descriptor = await open(filename, 'r');
  try { const bytes = Buffer.alloc(64); const { bytesRead } = await descriptor.read(bytes, 0, 64, 0); verifyElf64Header(bytes.subarray(0, bytesRead)); }
  finally { await descriptor.close(); }
  await chmod(filename, 0o755);
  if (process.platform === 'linux' && ((await lstat(filename)).mode & 0o111) !== 0o111) throw new Error('Runtime executable permissions were not retained.');
}
async function copyFile(source, destination) {
  if (!await regularFile(source)) throw new Error('Runtime copy source is missing.');
  await regularFile(destination); // Reject a pre-existing link or non-file.
  const temporary = destination + '.' + randomUUID() + '.part';
  try {
    await pipeline(createReadStream(source), createWriteStream(temporary, { flags: 'wx', mode: 0o644 }));
    if (await digest(source) !== await digest(temporary)) throw new Error('Runtime copy verification failed.');
    await rename(temporary, destination);
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
async function extractKnownMember(archive, member, destination) {
  if (!safeArchiveMember(member)) throw new Error('Refusing an unexpected archive member.');
  await regularFile(destination);
  const temporary = destination + '.' + randomUUID() + '.part';
  const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  // Archive paths are never used as filesystem destinations. tar writes one
  // allowlisted member to stdout, and this process owns its fixed destination.
  const child = spawn(tar, ['-xOf', archive, member], { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const deadline = setTimeout(() => child.kill('SIGKILL'), 300_000);
  let stderrBytes = 0;
  child.stderr.on('data', chunk => { stderrBytes += chunk.length; if (stderrBytes > 1024 * 1024) child.kill('SIGKILL'); });
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error('Pinned runtime archive extraction failed.')));
  });
  try {
    await Promise.all([closed, pipeline(child.stdout, byteLimiter(256 * 1024 * 1024), createWriteStream(temporary, { flags: 'wx', mode: 0o644 }))]);
    await rename(temporary, destination);
  } finally {
    clearTimeout(deadline); if (child.exitCode === null) child.kill('SIGKILL');
    await closed.catch(() => undefined);
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
export async function packageRuntime({ offline = false, install = false, verifyLinux = false } = {}) {
  const downloads = await safeDirectory('.tools/media-linux/downloads');
  const stagedFunctions = await safeDirectory('.tools/media-linux/package/functions');
  const stage = await safeDirectory('.tools/media-linux/package/functions/worker');
  await safeDirectory('.tools/media-linux/package/functions/worker/bin');
  await safeDirectory('.tools/media-linux/package/functions/worker/licenses');
  for (const pin of [runtimePins.ytDlp, runtimePins.ffmpeg, ...runtimePins.files]) await download(pin, downloads, offline);
  if (checksumFor(await readFile(path.join(downloads, 'yt-dlp-SHA2-256SUMS'), 'utf8'), runtimePins.ytDlp.filename) !== runtimePins.ytDlp.sha256
    || checksumFor(await readFile(path.join(downloads, 'ffmpeg-checksums.sha256'), 'utf8'), runtimePins.ffmpeg.filename) !== runtimePins.ffmpeg.sha256) throw new Error('Release checksums disagree with pinned artifacts.');
  await copyFile(path.join(repository, 'tools/media-worker/clip.mjs'), path.join(stage, 'clip.mjs'));
  await copyFile(path.join(repository, 'tools/media-worker/verify-runtime.mjs'), path.join(stage, 'verify-runtime.mjs'));
  await copyFile(path.join(downloads, runtimePins.ytDlp.filename), path.join(stage, 'bin/yt-dlp'));
  for (const binary of ['ffmpeg', 'ffprobe']) await extractKnownMember(path.join(downloads, runtimePins.ffmpeg.filename), ffRoot + '/bin/' + binary, path.join(stage, 'bin', binary));
  await extractKnownMember(path.join(downloads, runtimePins.ffmpeg.filename), ffRoot + '/LICENSE.txt', path.join(stage, 'licenses/ffmpeg-LICENSE.txt'));
  for (const filename of ['yt-dlp-LICENSE', 'yt-dlp-THIRD_PARTY_LICENSES.txt']) await copyFile(path.join(downloads, filename), path.join(stage, 'licenses', filename));
  for (const filename of ['yt-dlp-SHA2-256SUMS', 'ffmpeg-checksums.sha256']) await copyFile(path.join(downloads, filename), path.join(stage, 'licenses', filename));
  const binaries = Object.fromEntries(['yt-dlp', 'ffmpeg', 'ffprobe'].map(name => [name, path.join(stage, 'bin', name)]));
  for (const filename of Object.values(binaries)) await verifyExecutable(filename);
  const members = ['worker/clip.mjs', 'worker/verify-runtime.mjs', 'worker/bin/yt-dlp', 'worker/bin/ffmpeg', 'worker/bin/ffprobe',
    'worker/licenses/ffmpeg-LICENSE.txt', 'worker/licenses/yt-dlp-LICENSE', 'worker/licenses/yt-dlp-THIRD_PARTY_LICENSES.txt',
    'worker/licenses/yt-dlp-SHA2-256SUMS', 'worker/licenses/ffmpeg-checksums.sha256'];
  const files = [];
  for (const member of members) {
    const filename = path.join(stagedFunctions, member);
    files.push({ path: member, bytes: (await lstat(filename)).size, sha256: await digest(filename) });
  }
  const manifest = { schemaVersion: 1, target: 'linux-x86_64', generatedAt: new Date().toISOString(), pins: runtimePins, files,
    verification: { artifactHashes: true, officialChecksums: true, elfHeaders: true, linuxExecuted: false, versions: null },
    limitations: ['ELF/header verification does not execute Linux binaries on Windows.',
      'BtbN daily releases expire after 14 days; retain the verified cache or deliberately repin.',
      'BtbN targets glibc >= 2.28 and Linux >= 4.18; runtime execution and executable modes require Linux verification.'] };
  await regularFile(path.join(stage, 'runtime-manifest.json'));
  await writeFile(path.join(stage, 'runtime-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o644 });
  if (verifyLinux) {
    const verified = await verifyRuntime({ directory: stage });
    manifest.verification.linuxExecuted = true; manifest.verification.versions = verified.versions;
    await writeFile(path.join(stage, 'runtime-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o644 });
  }
  if (install) {
    await safeDirectory('functions/worker/bin'); await safeDirectory('functions/worker/licenses');
    for (const member of [...members, 'worker/runtime-manifest.json']) await copyFile(path.join(stagedFunctions, member), path.join(repository, 'functions', member));
    for (const name of Object.keys(binaries)) await verifyExecutable(path.join(repository, 'functions/worker/bin', name));
  }
  return { stagedFunctions, installed: install, executableBytes: files.filter(file => file.path.startsWith('worker/bin/')).reduce((total, file) => total + file.bytes, 0), manifest };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const flags = process.argv.slice(2);
  if (flags.some(flag => !['--offline', '--install', '--verify-linux'].includes(flag))) throw new Error('Usage: node tools/media-worker/package-runtime.mjs [--offline] [--install] [--verify-linux]');
  try {
    const result = await packageRuntime({ offline: flags.includes('--offline'), install: flags.includes('--install'), verifyLinux: flags.includes('--verify-linux') });
    console.log(JSON.stringify({ stagedFunctions: result.stagedFunctions, installed: result.installed, executableBytes: result.executableBytes,
      artifactHashes: true, officialChecksums: true, elfHeaders: true, linuxExecuted: result.manifest.verification.linuxExecuted }, null, 2));
  } catch (error) { console.error(error instanceof Error ? error.message : 'Runtime packaging failed.'); process.exitCode = 1; }
}
