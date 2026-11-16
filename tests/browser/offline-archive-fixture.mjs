import assert from 'node:assert/strict';
import { createDecipheriv, createHash, pbkdf2Sync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { canonicalOfflineJson, applyOfflineOperation, initialOfflineState, offlineOperationContent } from '../../packages/quiz-domain/lib/index.js';

/** Independent Node crypto inspection of a test-owned real browser download; never logs its private metadata. */
export async function inspectOfflineArchive(filename, password) {
  const file = await readFile(filename), magic = Buffer.from('JUSTKVIZ-OFFLINE/1\n');
  assert(file.subarray(0, magic.length).equals(magic));
  const length = file.readUInt32BE(magic.length); assert(length > 0 && length <= 65536);
  const start = magic.length + 4 + length, header = JSON.parse(file.subarray(magic.length + 4, start));
  assert.equal(header.schemaVersion, 1); assert(header.recordSizes.length > 0 && header.recordSizes.length <= 1024);
  assert.equal(start + header.recordSizes.reduce((sum, size) => sum + size, 0), file.length);
  assert(header.iterations >= 100000 && header.iterations <= 500000);
  const key = pbkdf2Sync(password, Buffer.from(header.salt, 'base64url'), header.iterations, 32, 'sha256');
  const records = []; let offset = start;
  for (const [index, size] of header.recordSizes.entries()) {
    assert(Number.isSafeInteger(size) && size >= 17);
    const encrypted = file.subarray(offset, offset + size); offset += size;
    const iv = Buffer.alloc(12); Buffer.from(header.noncePrefix, 'base64url').copy(iv); iv.writeUInt32BE(index, 8);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(canonicalOfflineJson({ header, index }))); decipher.setAuthTag(encrypted.subarray(-16));
    records.push(Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]));
  }
  const metadata = JSON.parse(records[0]); let record = 1;
  const assets = [];
  for (const asset of metadata.manifest.assets) {
    const count = Math.ceil(asset.size / (4 * 1024 * 1024));
    const bytes = Buffer.concat(records.slice(record, record + count)); record += count;
    assert.equal(bytes.length, asset.size); assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256);
    assets.push({ ...asset, bytes });
  }
  assert.equal(record, records.length);
  let state = initialOfflineState(metadata.manifest);
  for (const operation of metadata.operations) {
    const { hash, ...content } = operation;
    assert.equal(createHash('sha256').update(offlineOperationContent(content)).digest('hex'), hash);
    state = applyOfflineOperation(metadata.manifest, state, operation);
  }
  return { metadata, assets, state, fileBytes: file.length,
    fileSha256: createHash('sha256').update(file).digest('hex'), recordCount: records.length };
}
