import { copyFile, lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimePins, sha256, verifyExecutable, verifyPortableRuntime } from './runtime.mjs';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const members = ['README.md', 'client.mjs', 'runtime.mjs', 'protected-store.ps1', 'Pair.ps1', 'Start.ps1', 'Install-Logon.ps1', 'Remove-Logon.ps1'];
const licenseInputs = [
  ['.tools/node22/LICENSE', 'node-LICENSE.txt'],
  ['.tools/ffmpeg-media/ffmpeg-9.0.2-essentials_build/LICENSE', 'ffmpeg-LICENSE.txt'],
  ['.tools/ffmpeg-media/ffmpeg-9.0.2-essentials_build/README.txt', 'ffmpeg-README.txt'],
  ['.tools/media-linux/downloads/yt-dlp-LICENSE', 'yt-dlp-LICENSE.txt'],
  ['.tools/media-linux/downloads/yt-dlp-THIRD_PARTY_LICENSES.txt', 'yt-dlp-THIRD_PARTY_LICENSES.txt'],
  ['.tools/yt-dlp/SHA2-256SUMS', 'yt-dlp-SHA2-256SUMS.txt'],
];

async function regular(filename) {
  const info = await lstat(filename);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('package-input-invalid');
  return info;
}
async function safeDirectory(relative) {
  let cursor = await realpath(repository);
  for (const segment of relative.split('/')) {
    if (!segment || ['.', '..'].includes(segment)) throw new Error('package-path-invalid');
    cursor = path.join(cursor, segment);
    try { await mkdir(cursor); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const info = await lstat(cursor);
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(cursor) !== cursor) throw new Error('package-path-invalid');
  }
  return cursor;
}
async function copy(source, destination) {
  await regular(source);
  try { await regular(destination); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = destination + '.package-part';
  try {
    await copyFile(source, temporary, constants.COPYFILE_EXCL);
    if (await sha256(source) !== await sha256(temporary)) throw new Error('package-copy-failed');
    await rename(temporary, destination);
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

/** Offline only. Never starts a helper, pairs a device, registers logon or calls a cloud service. */
export async function packageRuntime() {
  const destination = await safeDirectory('.local-data/media-companion');
  await safeDirectory('.local-data/media-companion/bin');
  await safeDirectory('.local-data/media-companion/licenses');
  await safeDirectory('.local-data/media-companion/tools/media-companion');
  await safeDirectory('.local-data/media-companion/tools/media-worker');
  for (const pin of runtimePins) {
    await verifyExecutable(path.join(repository, pin.source), pin);
    await copy(path.join(repository, pin.source), path.join(destination, 'bin', pin.name));
  }
  for (const member of members) await copy(path.join(repository, 'tools/media-companion', member), path.join(destination, 'tools/media-companion', member));
  for (const member of ['Pair.ps1', 'Start.ps1', 'Install-Logon.ps1', 'Remove-Logon.ps1']) {
    // Launchers live beside bin/ in the portable package; their own directory
    // determines the root and supports paths containing spaces.
    await copy(path.join(repository, 'tools/media-companion', member), path.join(destination, member));
  }
  await copy(path.join(repository, 'tools/media-companion/README.md'), path.join(destination, 'README.md'));
  await copy(path.join(repository, 'tools/media-worker/clip.mjs'), path.join(destination, 'tools/media-worker/clip.mjs'));
  for (const [source, name] of licenseInputs) await copy(path.join(repository, source), path.join(destination, 'licenses', name));
  await verifyPortableRuntime(destination);
  const sums = await readFile(path.join(destination, 'licenses/yt-dlp-SHA2-256SUMS.txt'), 'utf8');
  if (!sums.split(/\r?\n/u).includes(runtimePins[0].sha256 + '  yt-dlp.exe')) throw new Error('release-checksum-mismatch');
  const filenames = [...runtimePins.map(pin => 'bin/' + pin.name), ...members.map(member => 'tools/media-companion/' + member),
    'tools/media-worker/clip.mjs', 'README.md', 'Pair.ps1', 'Start.ps1', 'Install-Logon.ps1', 'Remove-Logon.ps1', ...licenseInputs.map(([, name]) => 'licenses/' + name)];
  const files = [];
  for (const filename of filenames) files.push({ path: filename, bytes: (await regular(path.join(destination, filename))).size, sha256: await sha256(path.join(destination, filename)) });
  const manifest = { schemaVersion: 1, target: 'windows-x64', offline: true, generatedAt: new Date().toISOString(),
    runtimePins, files, secretsIncluded: false, helperStarted: false, logonInstalled: false };
  const manifestFile = path.join(destination, 'runtime-manifest.json');
  try { await regular(manifestFile); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  return { directory: destination, binaryBytes: runtimePins.reduce((total, pin) => total + pin.bytes, 0), files: files.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error('This offline packager accepts no options.');
  try { console.log(JSON.stringify(await packageRuntime())); }
  catch { console.error('offline-package-failed'); process.exitCode = 1; }
}
