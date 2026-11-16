import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PNG } from 'pngjs';
import {
  canonicalLocalImageManifestContent, localImageBackupLimits, parseLocalImageManifest, readLocalImageDimensions,
  type LocalImageAsset, type LocalImageManifest,
} from '../packages/quiz-domain/src/local-image-backup';
import { readImageBackupHeader, verifyImageBlob } from '../apps/web/src/features/events/localImageBackup';

const png = new Uint8Array(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aLZkAAAAASUVORK5CYII=', 'base64',
));
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const magic = new TextEncoder().encode('JUSTKVIZ-IMAGE-BACKUP/3\n');

function asset(index = 1, extra: Partial<LocalImageAsset> = {}): LocalImageAsset {
  return {
    reference: `quiz-asset:synthetic-quiz/${index.toString(16).padStart(64, '0')}`,
    generation: '1001', contentType: 'image/png', size: png.byteLength, sha256: hash(png),
    width: 1, height: 1, etag: '"' + 'a'.repeat(64) + '"', visibility: 'public',
    uses: [{ slidePosition: index, role: 'question-image' }], ...extra,
  };
}

function manifest(assets: readonly LocalImageAsset[] = [asset()]): LocalImageManifest {
  const content: Omit<LocalImageManifest, 'manifestId'> = { schemaVersion: 3, eventId: 'synthetic-event', snapshotId: 'synthetic-snapshot', quizRevision: 2,
    validUntilMs: Date.now() + 60_000, scopeKey: 'b'.repeat(64),
    assets, excluded: [], missing: [] };
  return { ...content, manifestId: createHash('sha256').update(canonicalLocalImageManifestContent(content)).digest('hex') };
}

function archive(header: LocalImageManifest, payloads: readonly Uint8Array[] = [png]): Blob {
  const json = new TextEncoder().encode(JSON.stringify(header));
  const prefix = new Uint8Array(magic.length + 4);
  prefix.set(magic); new DataView(prefix.buffer).setUint32(magic.length, json.length);
  return new Blob([prefix, json, ...payloads.map(payload => new Uint8Array(payload))]);
}

function webpDimensionsConflict(kind: 'VP8 ' | 'VP8L'): Uint8Array {
  const canvas = Buffer.alloc(18); canvas.write('VP8X'); canvas.writeUInt32LE(10, 4);
  // The extended canvas declares 1×1, while the image payload declares 2×2.
  const payloadBytes = kind === 'VP8 ' ? 10 : 5;
  const payload = Buffer.alloc(8 + payloadBytes + payloadBytes % 2);
  payload.write(kind); payload.writeUInt32LE(payloadBytes, 4);
  if (kind === 'VP8 ') {
    payload.set([0x9d, 1, 0x2a], 11); payload.writeUInt16LE(2, 14); payload.writeUInt16LE(2, 16);
  } else {
    payload[8] = 47; payload.writeUInt32LE(1 | 1 << 14, 9);
  }
  const header = Buffer.alloc(12); header.write('RIFF'); header.write('WEBP', 8);
  header.writeUInt32LE(4 + canvas.length + payload.length, 4);
  return new Uint8Array(Buffer.concat([header, canvas, payload]));
}

const codecContradictions = [
  { name: 'PNG duplicate IHDR', contentType: 'image/png' as const,
    bytes: new Uint8Array(Buffer.concat([png.subarray(0, 33), png.subarray(8, 33), png.subarray(33)])) },
  { name: 'JPEG multiple SOF dimensions', contentType: 'image/jpeg' as const,
    bytes: new Uint8Array([255, 216, 255, 192, 0, 8, 8, 0, 1, 0, 1, 0, 255, 194, 0, 8, 8, 0, 2, 0, 2, 0, 255, 217]) },
  { name: 'WebP VP8X and VP8 dimensions disagree', contentType: 'image/webp' as const, bytes: webpDimensionsConflict('VP8 ') },
  { name: 'WebP VP8X and VP8L dimensions disagree', contentType: 'image/webp' as const, bytes: webpDimensionsConflict('VP8L') },
];

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('bounded image manifest and archive envelope', () => {
  it('accepts 64 distinct assets and rejects a 65th or duplicate reference', () => {
    const assets = Array.from({ length: 64 }, (_, index) => asset(index + 1));
    expect(parseLocalImageManifest(manifest(assets)).assets).toHaveLength(64);
    expect(() => parseLocalImageManifest(manifest([...assets, asset(65)]))).toThrow();
    expect(() => parseLocalImageManifest(manifest([asset(), asset()]))).toThrow();
  });

  it('enforces exact 10 MiB per-file and 64 MiB cumulative byte boundaries', () => {
    const sizes = [...Array<number>(6).fill(10 * 1024 * 1024), 4 * 1024 * 1024];
    const assets = sizes.map((size, index) => asset(index + 1, { size }));
    expect(parseLocalImageManifest(manifest(assets)).assets.reduce((sum, value) => sum + value.size, 0)).toBe(64 * 1024 * 1024);
    expect(() => parseLocalImageManifest(manifest([asset(1, { size: localImageBackupLimits.assetBytes + 1 })]))).toThrow();
    expect(() => parseLocalImageManifest(manifest([...assets.slice(0, -1), asset(7, { size: sizes[6]! + 1 })]))).toThrow();
  });

  it('rejects dimensions and pixel counts above their explicit bounds before image decoding', async () => {
    expect(parseLocalImageManifest(manifest([asset(1, { width: 4096, height: 2048 })])).assets[0]?.width).toBe(4096);
    expect(() => parseLocalImageManifest(manifest([asset(1, { width: 4096, height: 2049 })]))).toThrow();
    expect(parseLocalImageManifest(manifest([asset(1, { width: 8192, height: 1 })])).assets[0]?.width).toBe(8192);
    expect(() => parseLocalImageManifest(manifest([asset(1, { width: 8193, height: 1 })]))).toThrow();
    const decode = vi.fn(); vi.stubGlobal('createImageBitmap', decode);
    const changed = new Uint8Array(png); new DataView(changed.buffer).setUint32(16, 8193);
    await expect(verifyImageBlob(new Blob([changed], { type: 'image/png' }), asset(1, { sha256: hash(changed) }), new AbortController().signal)).rejects.toThrow();
    expect(decode).not.toHaveBeenCalled();
  });

  it('rejects unknown private fields, duplicate uses and unsupported animated containers', () => {
    expect(() => parseLocalImageManifest({ ...manifest(), correctAnswer: 'private' })).toThrow();
    expect(() => parseLocalImageManifest(manifest([asset(1, { uses: [{ slidePosition: 1, role: 'question-image' }, { slidePosition: 1, role: 'question-image' }] })]))).toThrow();
    const animated = new Uint8Array(png);
    // Mark the existing first IDAT chunk as an animation-control chunk; static inspection must reject it.
    for (let offset = 8; offset + 12 <= animated.length;) {
      const view = new DataView(animated.buffer), length = view.getUint32(offset);
      if (String.fromCharCode(...animated.subarray(offset + 4, offset + 8)) === 'IDAT') {
        animated.set(new TextEncoder().encode('acTL'), offset + 4); break;
      }
      offset += 12 + length;
    }
    expect(() => readLocalImageDimensions(animated, 'image/png')).toThrow();
  });

  it('requires an exact payload length and bounded well-formed header', async () => {
    const current = manifest();
    expect((await readImageBackupHeader(archive(current))).manifest.assets).toHaveLength(1);
    await expect(readImageBackupHeader(archive(current, [png.subarray(0, -1)]))).rejects.toThrow();
    await expect(readImageBackupHeader(archive(current, [png, new Uint8Array([0])]))).rejects.toThrow();
    const excessivePrefix = new Uint8Array(magic.length + 4); excessivePrefix.set(magic);
    new DataView(excessivePrefix.buffer).setUint32(magic.length, localImageBackupLimits.headerBytes + 1);
    await expect(readImageBackupHeader(new Blob([excessivePrefix]))).rejects.toThrow();
    const bytes = new Uint8Array(await archive(current).arrayBuffer()); bytes[0] = bytes[0]! ^ 1;
    await expect(readImageBackupHeader(new Blob([bytes]))).rejects.toThrow();
  });

  it('rejects a same-length mutation before decode and closes every successful bitmap', async () => {
    const close = vi.fn(), decode = vi.fn().mockResolvedValue({ width: 1, height: 1, close });
    vi.stubGlobal('createImageBitmap', decode);
    const changed = new Uint8Array(png); changed[changed.length - 1] = changed[changed.length - 1]! ^ 1;
    await expect(verifyImageBlob(new Blob([changed], { type: 'image/png' }), asset(), new AbortController().signal)).rejects.toThrow();
    expect(decode).not.toHaveBeenCalled();
    await verifyImageBlob(new Blob([png], { type: 'image/png' }), asset(), new AbortController().signal);
    expect(decode).toHaveBeenCalledTimes(1); expect(close).toHaveBeenCalledTimes(1);
  });

  it.each(codecContradictions)('rejects $name before requesting a browser decode', async ({ bytes, contentType }) => {
    const decode = vi.fn(); vi.stubGlobal('createImageBitmap', decode);
    if (contentType === 'image/webp') {
      const matchingMetadata = new Uint8Array(bytes); matchingMetadata[24] = 1; matchingMetadata[27] = 1;
      expect(readLocalImageDimensions(matchingMetadata, contentType)).toEqual({ width: 2, height: 2 });
    } else if (contentType === 'image/jpeg') {
      const singleFrame = new Uint8Array([...bytes.subarray(0, 12), 255, 217]);
      expect(readLocalImageDimensions(singleFrame, contentType)).toEqual({ width: 1, height: 1 });
    } else expect(readLocalImageDimensions(png, contentType)).toEqual({ width: 1, height: 1 });
    expect(() => readLocalImageDimensions(bytes, contentType)).toThrow();
    await expect(verifyImageBlob(new Blob([new Uint8Array(bytes)], { type: contentType }), asset(1, {
      contentType, size: bytes.length, sha256: hash(bytes),
    }), new AbortController().signal)).rejects.toThrow();
    expect(decode).not.toHaveBeenCalled();
  });

  it('accepts an exact native dimension transposition while retaining raw header and hash checks', async () => {
    const image = new PNG({ width: 2, height: 1 }); image.data.fill(255);
    const bytes = new Uint8Array(PNG.sync.write(image));
    const close = vi.fn(); vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 1, height: 2, close }));
    await verifyImageBlob(new Blob([bytes], { type: 'image/png' }), asset(1, { size: bytes.length, sha256: hash(bytes), width: 2, height: 1 }), new AbortController().signal);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('rejects native scaling or cropping rather than accepting arbitrary decoded dimensions', async () => {
    const image = new PNG({ width: 2, height: 1 }); image.data.fill(255);
    const bytes = new Uint8Array(PNG.sync.write(image));
    const close = vi.fn(); vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 3, height: 1, close }));
    await expect(verifyImageBlob(new Blob([bytes], { type: 'image/png' }), asset(1, { size: bytes.length, sha256: hash(bytes), width: 2, height: 1 }), new AbortController().signal)).rejects.toThrow();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
