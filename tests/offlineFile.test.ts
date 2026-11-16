import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createOfflineArchive, parseOfflineArchiveHeader, readOfflineArchiveHeader, unlockOfflineMetadata, writeOfflineArchive,
  type OfflineArchiveHeader,
} from '../apps/web/src/features/offline/offlineFile';
import { encodeBase64 } from '../apps/web/src/features/offline/offlineCrypto';
import type { OfflineEventManifest, OfflineGrant, OfflineOperation } from '../packages/quiz-domain/src/offline-event';
import { signedOfflineFixture } from './offline-fixture';

const password = 'synthetic-offline-passphrase';
const magic = new TextEncoder().encode('JUSTKVIZ-OFFLINE/1\n');
let metadata: { manifest: OfflineEventManifest; grant: OfflineGrant; operations: readonly OfflineOperation[] };
let trust: Awaited<ReturnType<typeof signedOfflineFixture>>['trust'];
let file: Blob, records: Blob[], header: OfflineArchiveHeader;

function envelope(value: unknown, payloads: readonly Blob[]) {
  const json = new TextEncoder().encode(JSON.stringify(value));
  const prefix = new Uint8Array(magic.length + 4); prefix.set(magic);
  new DataView(prefix.buffer).setUint32(magic.length, json.length);
  return new Blob([prefix, json, ...payloads]);
}

beforeAll(async () => {
  const fixture = await signedOfflineFixture(); trust = fixture.trust;
  metadata = { manifest: fixture.manifest, grant: fixture.grant, operations: [] };
  records = [];
  const load = vi.fn(() => Promise.reject(new Error('No synthetic assets are declared in this archive.')));
  ({ header } = await createOfflineArchive(metadata, password, load, (index, record) => { records[index] = record; return Promise.resolve(); }));
  expect(load).not.toHaveBeenCalled();
  const parts: Blob[] = [];
  await writeOfflineArchive(header, index => Promise.resolve(records[index]!), blob => { parts.push(blob); return Promise.resolve(); });
  file = new Blob(parts);
});

describe('portable encrypted offline archive', () => {
  it('round-trips signed metadata and private answers while exposing no private plaintext in the file', async () => {
    const bytes = await file.arrayBuffer(), visible = new TextDecoder().decode(bytes);
    for (const sentinel of ['PRIVATE_OFFLINE_ANSWER_ONE', 'PRIVATE_OFFLINE_NOTE_ONE', metadata.manifest.actorId, metadata.manifest.teams[0]!.name]) {
      expect(visible).not.toContain(sentinel);
    }
    const opened = await readOfflineArchiveHeader(new Blob([bytes]));
    const unlocked = await unlockOfflineMetadata(opened.header, opened.readRecord, password, [trust]);
    expect(unlocked.metadata).toEqual(JSON.parse(JSON.stringify(metadata)));
    expect(unlocked.key.extractable).toBe(false);
  });

  it('rejects a wrong password and refuses a file signer absent from separately installed trust', async () => {
    const opened = await readOfflineArchiveHeader(file);
    await expect(unlockOfflineMetadata(opened.header, opened.readRecord, 'wrong-synthetic-password', [trust])).rejects.toThrow();
    await expect(unlockOfflineMetadata(opened.header, opened.readRecord, password, [])).rejects.toThrow();
    const other = await signedOfflineFixture();
    await expect(unlockOfflineMetadata(opened.header, opened.readRecord, password, [other.trust])).rejects.toThrow();
  });

  it('rejects unsupported format, truncated lengths, trailing bytes and undeclared records', async () => {
    const wrongMagic = new Uint8Array(await file.arrayBuffer()); wrongMagic[0] = wrongMagic[0]! ^ 1;
    const hugeHeader = new Uint8Array(magic.length + 4); hugeHeader.set(magic);
    new DataView(hugeHeader.buffer).setUint32(magic.length, 65537);
    for (const invalid of [
      new Blob([wrongMagic]), new Blob([hugeHeader]), file.slice(0, magic.length + 2),
      file.slice(0, file.size - 1), new Blob([file, new Uint8Array([0])]),
      envelope({ ...header, schemaVersion: 2 }, records),
      envelope({ ...header, recordSizes: [...header.recordSizes, 17] }, records),
    ]) await expect(readOfflineArchiveHeader(invalid)).rejects.toThrow();
  });

  it('authenticates same-length metadata ciphertext and every header field as associated data', async () => {
    const tampered = new Uint8Array(await records[0]!.arrayBuffer()); tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 1;
    const damaged = await readOfflineArchiveHeader(envelope(header, [new Blob([tampered])]));
    await expect(unlockOfflineMetadata(damaged.header, damaged.readRecord, password, [trust])).rejects.toThrow();
    for (const changed of [
      { ...header, noncePrefix: encodeBase64(new Uint8Array(8).fill(9)) },
      { ...header, salt: encodeBase64(new Uint8Array(16).fill(9)) },
      { ...header, iterations: header.iterations + 1 },
    ]) {
      const altered = await readOfflineArchiveHeader(envelope(changed, records));
      await expect(unlockOfflineMetadata(altered.header, altered.readRecord, password, [trust])).rejects.toThrow();
    }
  });

  it('validates bounded record/header sizes before decryption and rejects invalid record indexing', async () => {
    for (const changed of [
      { ...header, unexpected: true }, { ...header, iterations: 500001 }, { ...header, iterations: 99999 },
      { ...header, salt: encodeBase64(new Uint8Array(15)) }, { ...header, noncePrefix: encodeBase64(new Uint8Array(7)) },
      { ...header, recordSizes: [] }, { ...header, recordSizes: [16] }, { ...header, recordSizes: [NaN] },
      { ...header, recordSizes: [4 * 1024 * 1024 + 512 * 1024 + 65536 + 17] },
      { ...header, recordSizes: [17, 4 * 1024 * 1024 + 17] },
    ]) expect(() => parseOfflineArchiveHeader(changed)).toThrow();
    const opened = await readOfflineArchiveHeader(file);
    for (const index of [-1, 0.5, 1, Number.MAX_SAFE_INTEGER]) await expect(opened.readRecord(index)).rejects.toThrow();
  });

  it('propagates interrupted export writes and rejects shortened record reads', async () => {
    const write = vi.fn(() => Promise.reject(new Error('Synthetic disk full')));
    await expect(writeOfflineArchive(header, index => Promise.resolve(records[index]!), write)).rejects.toThrow('Synthetic disk full');
    expect(write).toHaveBeenCalledOnce();
    await expect(writeOfflineArchive(header, index => Promise.resolve(records[index]!.slice(0, records[index]!.size - 1)), () => Promise.resolve())).rejects.toThrow();
  });
});
