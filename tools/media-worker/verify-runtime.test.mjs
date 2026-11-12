import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { binaryManifestEntry, checkElfHeader, checkVersionLine, expectedVersion, runVersion, verifyRuntime } from './verify-runtime.mjs';

const manifest = () => ({ schemaVersion: 1, target: 'linux-x86_64', pins: { ytDlp: { version: '2026.08.19' }, ffmpeg: { version: 'N-127579-g5cb9fcd211' } },
  files: [{ path: 'worker/bin/yt-dlp', bytes: 40_446_224, sha256: 'a'.repeat(64) }] });
test('requires one bounded hash/size entry at the exact binary path', () => {
  const valid = manifest(); assert.equal(binaryManifestEntry(valid, 'yt-dlp').bytes, 40_446_224);
  for (const changed of [{ ...valid, target: 'windows' }, { ...valid, files: [] }, { ...valid, files: [...valid.files, ...valid.files] },
    { ...valid, files: [{ ...valid.files[0], bytes: 300 * 1024 * 1024 }] }, { ...valid, files: [{ ...valid.files[0], sha256: 'bad' }] }]) assert.throws(() => binaryManifestEntry(changed, 'yt-dlp'));
  assert.throws(() => binaryManifestEntry(valid, '../outside'));
});
test('checks exact pinned tool versions and rejects suffix spoofing', () => {
  assert.equal(expectedVersion(manifest(), 'yt-dlp'), '2026.08.19');
  assert.equal(checkVersionLine('yt-dlp', '2026.08.19', '2026.08.19\n'), '2026.08.19');
  assert.equal(checkVersionLine('ffmpeg', 'N-127579-g5cb9fcd211', 'ffmpeg version N-127579-g5cb9fcd211 Copyright\n'), 'ffmpeg version N-127579-g5cb9fcd211 Copyright');
  for (const output of ['2026.08.19-malicious', 'other', 'ffmpeg version N-127579-g5cb9fcd211-other Copyright']) assert.throws(() => checkVersionLine('yt-dlp', '2026.08.19', output));
  assert.throws(() => checkVersionLine('ffmpeg', 'N-127579-g5cb9fcd211', 'ffmpeg version N-127579-g5cb9fcd211-other Copyright'));
});
test('rejects non-ELF and other architectures before execution', () => {
  const header = Buffer.alloc(64); Buffer.from([127, 69, 76, 70, 2, 1, 1]).copy(header); header.writeUInt16LE(3, 16); header.writeUInt16LE(62, 18);
  assert.doesNotThrow(() => checkElfHeader(header)); header.writeUInt16LE(183, 18);
  assert.throws(() => checkElfHeader(header)); assert.throws(() => checkElfHeader(Buffer.alloc(4)));
});
function fakeProcess(output, code = 0) {
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true;
  queueMicrotask(() => { child.stdout.emit('data', Buffer.from(output)); child.emit('close', code); });
  return child;
}
test('version invocation uses fixed offline flags without a shell or application credentials', async () => {
  let observed;
  await assert.doesNotReject(runVersion('/trusted/yt-dlp', 'yt-dlp', (file, args, options) => { observed = { file, args, options }; return fakeProcess('2026.08.19\n'); }));
  assert.equal(observed.file, '/trusted/yt-dlp'); assert.ok(observed.args.includes('--ignore-config')); assert.ok(observed.args.includes('--no-remote-components'));
  assert.deepEqual(observed.options.stdio, ['ignore', 'pipe', 'pipe']); assert.equal(observed.options.shell, false);
  assert.equal(Object.keys(observed.options.env).some(key => key.includes('DRIVE') || key.includes('TOKEN')), false);
});
test('nonzero exit and oversized tool output fail without exposing provider output', async () => {
  await assert.rejects(runVersion('/trusted/ffmpeg', 'ffmpeg', () => fakeProcess('private-provider-detail', 1)), /unsuccessful version check/u);
  await assert.rejects(runVersion('/trusted/ffmpeg', 'ffmpeg', () => fakeProcess('x'.repeat(70_000))), /bounded version check/u);
});
test('Windows/macOS cannot claim Linux runtime verification', { skip: process.platform === 'linux' && process.arch === 'x64' }, async () => {
  await assert.rejects(verifyRuntime(), /actual Linux x86_64/u);
});
