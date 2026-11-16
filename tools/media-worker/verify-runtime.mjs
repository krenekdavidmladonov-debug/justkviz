import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { chmod, lstat, open, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const runtimeDirectory = fileURLToPath(new URL('./', import.meta.url));
const names = ['yt-dlp', 'ffmpeg', 'ffprobe'];
const safeFailure = message => new Error('Media runtime verification failed: ' + message);

export function binaryManifestEntry(manifest, name) {
  if (!names.includes(name) || !manifest || manifest.schemaVersion !== 1 || manifest.target !== 'linux-x86_64'
    || !Array.isArray(manifest.files)) throw safeFailure('invalid manifest.');
  const matching = manifest.files.filter(file => file && file.path === 'worker/bin/' + name);
  if (matching.length !== 1 || !/^[a-f0-9]{64}$/u.test(matching[0].sha256)
    || !Number.isSafeInteger(matching[0].bytes) || matching[0].bytes < 64 || matching[0].bytes > 256 * 1024 * 1024) throw safeFailure('invalid binary manifest entry.');
  return matching[0];
}
export function expectedVersion(manifest, name) {
  const version = name === 'yt-dlp' ? manifest?.pins?.ytDlp?.version : manifest?.pins?.ffmpeg?.version;
  if (typeof version !== 'string' || !/^[A-Za-z0-9._+-]{1,100}$/u.test(version)
    || (name === 'yt-dlp' && !/^\d{4}\.\d{2}\.\d{2}$/u.test(version))) throw safeFailure('invalid pinned version.');
  return version;
}
export function checkVersionLine(name, version, output) {
  const first = output.split(/\r?\n/u)[0]?.trim();
  const valid = name === 'yt-dlp' ? first === version : first?.startsWith(name + ' version ' + version + ' ');
  if (!valid) throw safeFailure('unexpected ' + name + ' version.');
  return first;
}
export function checkElfHeader(header) {
  if (header.length !== 64 || !header.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70]))
    || header[4] !== 2 || header[5] !== 1 || header[6] !== 1 || header.readUInt16LE(18) !== 62
    || ![2, 3].includes(header.readUInt16LE(16))) throw safeFailure('expected an ELF64 little-endian x86_64 executable.');
}
async function checkedFile(filename, directory) {
  const info = await lstat(filename);
  if (!info.isFile() || info.isSymbolicLink() || path.dirname(await realpath(filename)) !== directory) throw safeFailure('runtime files must be regular files within the package.');
  return info;
}
async function inspectBinary(filename, directory, expected) {
  const info = await checkedFile(filename, directory);
  if (info.size !== expected.bytes) throw safeFailure('binary size differs from manifest.');
  const descriptor = await open(filename, 'r');
  try {
    const header = Buffer.alloc(64), result = await descriptor.read(header, 0, 64, 0);
    checkElfHeader(header.subarray(0, result.bytesRead));
  } finally { await descriptor.close(); }
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  if (hash.digest('hex') !== expected.sha256) throw safeFailure('binary SHA256 differs from manifest.');
}
function versionEnvironment() {
  return Object.fromEntries(['PATH', 'LANG', 'LC_ALL', 'TMPDIR', 'TEMP', 'TMP'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
}
/** Fixed version arguments only. No downloader operation, installation or network access. */
export function runVersion(filename, name, spawnProcess = spawn) {
  const args = name === 'yt-dlp' ? ['--ignore-config', '--no-plugin-dirs', '--no-remote-components', '--no-js-runtimes', '--version'] : ['-version'];
  return new Promise((resolve, reject) => {
    let child, timer, error, bytes = 0, output = '';
    const terminate = () => {
      if (!child?.pid) { child?.kill('SIGKILL'); return; }
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    };
    const fail = () => { error ??= safeFailure(name + ' did not complete its bounded version check.'); terminate(); };
    try {
      child = spawnProcess(filename, args, { shell: false, windowsHide: true, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: versionEnvironment() });
      timer = setTimeout(fail, 10_000);
      child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > 64 * 1024) fail(); else output += chunk.toString(); });
      child.stderr.on('data', chunk => { bytes += chunk.length; if (bytes > 64 * 1024) fail(); });
      child.once('error', () => { error ??= safeFailure(name + ' could not execute.'); });
      child.once('close', code => {
        clearTimeout(timer);
        if (error || code !== 0) reject(error ?? safeFailure(name + ' returned an unsuccessful version check.'));
        else resolve(output);
      });
    } catch { clearTimeout(timer); terminate(); reject(safeFailure(name + ' could not execute.')); }
  });
}

/** Intended for gcp-build: no traffic can reach a deployment whose verification fails. */
export async function verifyRuntime({ directory = runtimeDirectory } = {}) {
  if (process.platform !== 'linux' || process.arch !== 'x64') throw safeFailure('an actual Linux x86_64 environment is required.');
  const rootInfo = await lstat(directory), binInfo = await lstat(path.join(directory, 'bin'));
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || !binInfo.isDirectory() || binInfo.isSymbolicLink()) throw safeFailure('package directories must not be links.');
  const root = await realpath(directory), bin = await realpath(path.join(directory, 'bin'));
  if (path.dirname(bin) !== root) throw safeFailure('binary directory escapes its package.');
  const manifestPath = path.join(root, 'runtime-manifest.json'), manifestInfo = await checkedFile(manifestPath, root);
  if (manifestInfo.size > 1024 * 1024) throw safeFailure('manifest exceeds its size limit.');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const binaries = names.map(name => ({ name, filename: path.join(bin, name), expected: binaryManifestEntry(manifest, name), version: expectedVersion(manifest, name) }));
  // Validate every file before executing any of them.
  for (const binary of binaries) await inspectBinary(binary.filename, bin, binary.expected);
  for (const binary of binaries) {
    await chmod(binary.filename, 0o755);
    if (((await lstat(binary.filename)).mode & 0o777) !== 0o755) throw safeFailure('executable mode could not be set.');
  }
  const versions = {};
  for (const binary of binaries) versions[binary.name] = checkVersionLine(binary.name, binary.version, await runVersion(binary.filename, binary.name));
  return { target: 'linux-x86_64', binaryHashes: true, elfHeaders: true, executableMode: '0755', versions };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw safeFailure('unexpected arguments.');
    console.log(JSON.stringify(await verifyRuntime(), null, 2));
  } catch (error) { console.error(error instanceof Error ? error.message : 'Media runtime verification failed.'); process.exitCode = 1; }
}
