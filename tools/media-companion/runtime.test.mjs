import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyExecutable } from './runtime.mjs';

const repository = fileURLToPath(new URL('../../', import.meta.url));

test('runtime integrity rejects changed bytes, truncated files and wrong executable architecture', async t => {
  const parent = path.resolve(repository, '.local-data');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(path.join(parent, 'media-companion-runtime-test-'));
  t.after(() => {
    const target = path.resolve(directory);
    assert.equal(path.dirname(target), parent);
    assert.match(path.basename(target), /^media-companion-runtime-test-/u);
    return rm(target, { recursive: true, force: true });
  });
  const filename = path.join(directory, 'synthetic.exe');
  const bytes = Buffer.alloc(128);
  bytes.write('MZ', 0); bytes.writeUInt32LE(64, 0x3c); bytes.set([80, 69, 0, 0], 64); bytes.writeUInt16LE(0x8664, 68);
  const pin = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  await writeFile(filename, bytes);
  await verifyExecutable(filename, pin);
  const changed = Buffer.from(bytes); changed[100] = 1;
  await writeFile(filename, changed);
  await assert.rejects(() => verifyExecutable(filename, pin), /runtime-verification-failed/u);
  await writeFile(filename, bytes.subarray(0, 70));
  await assert.rejects(() => verifyExecutable(filename, pin), /runtime-verification-failed/u);
  bytes.writeUInt16LE(0x14c, 68);
  await writeFile(filename, bytes);
  await assert.rejects(() => verifyExecutable(filename, { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }), /runtime-verification-failed/u);
});
