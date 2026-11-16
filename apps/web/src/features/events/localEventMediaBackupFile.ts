import { parseQuizAsset } from '@filmovy-kviz/quiz-domain';

const magic = new TextEncoder().encode('JUSTKVIZ-MEDIA-BACKUP/1\n');
const prefixSize = magic.length + 4;
const maximumHeaderSize = 4096;
const maximumPngSize = 1024 * 1024;
const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
const digestPattern = /^[a-f0-9]{64}$/u;
const documentIdPattern = /^[A-Za-z0-9_-]{1,150}$/u;

export const localEventMediaBackupName = 'justkviz-mistni-zaloha.justkvizbackup';

export interface LocalEventMediaAsset {
  readonly role: 'question-image';
  readonly reference: string;
  readonly generation: string;
  readonly contentType: 'image/png';
  readonly size: number;
  readonly sha256: string;
  readonly etag: string;
}

export interface LocalEventMediaManifest {
  readonly schemaVersion: 1;
  readonly eventId: string;
  readonly snapshotId: string;
  readonly quizRevision: number;
  readonly validUntilMs: number;
  readonly scopeKey: string;
  readonly media: LocalEventMediaAsset | null;
  readonly missing: number;
  readonly excluded: number;
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length || !keys.every(key => Object.hasOwn(value, key))) {
    throw new Error('Neplatný formát manifestu místní zálohy.');
  }
  return value as Record<string, unknown>;
}

function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error('Neplatná hodnota v manifestu místní zálohy.');
  }
  return value;
}

function matchedText(value: unknown, pattern: RegExp): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new Error('Neplatný identifikátor v manifestu místní zálohy.');
  }
  return value;
}

export function parseLocalEventMediaAsset(value: unknown): LocalEventMediaAsset | null {
  if (value === null) return null;
  const asset = exactRecord(value, ['role', 'reference', 'generation', 'contentType', 'size', 'sha256', 'etag']);
  if (asset.role !== 'question-image' || asset.contentType !== 'image/png'
    || typeof asset.reference !== 'string' || !parseQuizAsset(asset.reference)) {
    throw new Error('Nepovolený typ souboru místní zálohy.');
  }
  return {
    role: asset.role,
    reference: asset.reference,
    generation: matchedText(asset.generation, /^[1-9][0-9]{0,29}$/u),
    contentType: asset.contentType,
    size: integer(asset.size, pngSignature.length, maximumPngSize),
    sha256: matchedText(asset.sha256, digestPattern),
    etag: matchedText(asset.etag, /^"[a-f0-9]{64}"$/u),
  };
}

export function parseLocalEventMediaManifest(data: unknown): LocalEventMediaManifest {
  const value = exactRecord(data, [
    'schemaVersion', 'eventId', 'snapshotId', 'quizRevision', 'validUntilMs', 'scopeKey', 'media', 'missing', 'excluded',
  ]);
  if (value.schemaVersion !== 1) throw new Error('Nepodporovaná verze místní zálohy.');
  return {
    schemaVersion: 1,
    eventId: matchedText(value.eventId, documentIdPattern),
    snapshotId: matchedText(value.snapshotId, documentIdPattern),
    quizRevision: integer(value.quizRevision),
    validUntilMs: integer(value.validUntilMs, 1),
    scopeKey: matchedText(value.scopeKey, digestPattern),
    media: parseLocalEventMediaAsset(value.media),
    missing: integer(value.missing),
    excluded: integer(value.excluded),
  };
}

async function matchesPng(file: Blob, asset: LocalEventMediaAsset): Promise<boolean> {
  if (file.size !== asset.size) return false;
  const bytes = await file.arrayBuffer();
  const signature = new Uint8Array(bytes, 0, pngSignature.length);
  if (!pngSignature.every((byte, index) => signature[index] === byte)) return false;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const sha256 = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
  return sha256 === asset.sha256;
}

export async function createLocalEventMediaBackup(manifest: LocalEventMediaManifest, bytes: Blob): Promise<Blob> {
  const current = parseLocalEventMediaManifest(manifest);
  if (!current.media || current.validUntilMs <= Date.now()) throw new Error('Manifest místní zálohy už neplatí.');
  if (bytes.type !== current.media.contentType || !await matchesPng(bytes, current.media)) {
    throw new Error('Stažený obrázek neodpovídá ověřenému manifestu.');
  }
  const header = new TextEncoder().encode(JSON.stringify(current));
  if (header.length > maximumHeaderSize) throw new Error('Manifest místní zálohy je příliš velký.');
  const prefix = new Uint8Array(prefixSize);
  prefix.set(magic);
  new DataView(prefix.buffer).setUint32(magic.length, header.length);
  return new Blob([prefix, header, bytes], { type: 'application/octet-stream' });
}

export async function verifyLocalEventMediaBackup(
  file: Blob,
  current: LocalEventMediaManifest,
): Promise<'ready' | 'corrupt' | 'invalid'> {
  if (current.validUntilMs <= Date.now() || !current.media) return 'invalid';
  if (file.size < prefixSize || file.size > prefixSize + maximumHeaderSize + maximumPngSize) return 'corrupt';
  try {
    const prefix = await file.slice(0, prefixSize).arrayBuffer();
    const bytes = new Uint8Array(prefix);
    if (!magic.every((byte, index) => bytes[index] === byte)) return 'corrupt';
    const headerSize = new DataView(prefix).getUint32(magic.length);
    const payloadStart = prefixSize + headerSize;
    if (headerSize < 1 || headerSize > maximumHeaderSize || payloadStart >= file.size) return 'corrupt';
    const json = new TextDecoder('utf-8', { fatal: true }).decode(await file.slice(prefixSize, payloadStart).arrayBuffer());
    const recorded = parseLocalEventMediaManifest(JSON.parse(json) as unknown);
    if (JSON.stringify(recorded) !== JSON.stringify(parseLocalEventMediaManifest(current))) return 'invalid';
    if (!await matchesPng(file.slice(payloadStart), current.media)) return 'corrupt';
    return current.validUntilMs > Date.now() ? 'ready' : 'invalid';
  } catch {
    return 'corrupt';
  }
}

export async function readVerifiedLocalEventMediaBlob(file: Blob, manifest: LocalEventMediaManifest): Promise<Blob> {
  if (file.size > prefixSize + maximumHeaderSize + maximumPngSize) throw new Error('Neplatný balíček.');
  const copy = new Blob([await file.arrayBuffer()]);
  if (await verifyLocalEventMediaBackup(copy, manifest) !== 'ready') throw new Error('Neplatný balíček.');
  const prefix = await copy.slice(0, prefixSize).arrayBuffer();
  return copy.slice(prefixSize + new DataView(prefix).getUint32(magic.length), copy.size, 'image/png');
}

type BackupPickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: { description: string; accept: Record<string, string[]> }[];
    excludeAcceptAllOption: boolean;
  }) => Promise<FileSystemFileHandle>;
};

/** A browser download still needs reopening before we can verify the disk copy. */
export async function saveLocalEventMediaBackup(
  file: Blob,
  name = localEventMediaBackupName,
  assertCurrent?: () => Promise<void>,
): Promise<File | 'downloaded'> {
  const pickerWindow: BackupPickerWindow = window;
  if (!pickerWindow.showSaveFilePicker) {
    await assertCurrent?.();
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    try { link.click(); }
    finally {
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    return 'downloaded';
  }

  const destination = await pickerWindow.showSaveFilePicker({
    suggestedName: name,
    types: [{ description: 'Místní záloha JustKvíz', accept: { 'application/octet-stream': ['.justkvizbackup'] } }],
    excludeAcceptAllOption: true,
  });
  await assertCurrent?.();
  const writer = await destination.createWritable();
  try {
    await writer.write(file);
    await assertCurrent?.();
    await writer.close();
  } catch (error) {
    await writer.abort().catch(() => { /* The stream may already be errored. */ });
    throw error;
  }
  return destination.getFile();
}
