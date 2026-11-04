import assert from 'node:assert/strict';
import test from 'node:test';
import { checksumFor, runtimePins, safeArchiveMember, verifyElf64Header } from './package-runtime.mjs';

test('release pins use exact immutable names and full SHA256 digests', () => {
  for (const pin of [runtimePins.ytDlp, runtimePins.ffmpeg, ...runtimePins.files]) {
    assert.match(pin.sha256, /^[a-f0-9]{64}$/u); assert.ok(pin.size > 0);
    assert.equal(new URL(pin.url).protocol, 'https:'); assert.ok(!pin.url.includes('/latest/'));
  }
});
test('checksum verification rejects missing, ambiguous or malformed filename records', () => {
  const hash = 'a'.repeat(64);
  assert.equal(checksumFor(hash + '  tool\n', 'tool'), hash);
  assert.equal(checksumFor(hash + ' *tool\n', 'tool'), hash);
  for (const input of ['', hash + '  other', 'bad  tool', hash + '  tool\n' + hash + '  tool']) assert.throws(() => checksumFor(input, 'tool'));
});
test('archive extraction accepts only exact selected files, never traversal or executable extras', () => {
  const root = 'ffmpeg-N-127579-g5cb9fcd211-linux64-gpl';
  for (const member of [root + '/bin/ffmpeg', root + '/bin/ffprobe', root + '/LICENSE.txt']) assert.equal(safeArchiveMember(member), true);
  for (const member of [root + '/bin/ffplay', root + '/../outside', '/' + root + '/bin/ffmpeg', root + '\\bin\\ffmpeg', root + '/bin/ffmpeg/extra', null]) assert.equal(safeArchiveMember(member), false);
});
test('ELF verification requires complete 64-bit little-endian x86_64 executable headers', () => {
  const bytes = Buffer.alloc(64); Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]).copy(bytes); bytes.writeUInt16LE(3, 16); bytes.writeUInt16LE(62, 18);
  assert.equal(verifyElf64Header(bytes), true);
  for (const [offset, value] of [[0, 0], [4, 1], [5, 2], [6, 0], [16, 1], [18, 183]]) {
    const bad = Buffer.from(bytes); bad[offset] = value; assert.throws(() => verifyElf64Header(bad));
  }
  assert.throws(() => verifyElf64Header(bytes.subarray(0, 40)));
});
