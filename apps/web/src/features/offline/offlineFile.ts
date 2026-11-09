import { canonicalOfflineJson, offlineEventLimits as limits, parseOfflineManifest, parseOfflineOperations, readLocalImageDimensions, type OfflineEventManifest, type OfflineGrant, type OfflineMediaAsset, type OfflineOperation, type OfflineTrust } from '@filmovy-kviz/quiz-domain';
import { decodeBase64, deriveOfflineKey, encodeBase64, offlineDigest, offlineKdfIterations, verifyOfflineGrant } from './offlineCrypto';
const magic = new TextEncoder().encode('JUSTKVIZ-OFFLINE/1\n');
export interface OfflineArchiveHeader {
    readonly schemaVersion: 1;
    readonly salt: string;
    readonly iterations: number;
    readonly noncePrefix: string;
    readonly recordSizes: readonly number[];
}
export interface OfflineArchiveMetadata {
    readonly manifest: OfflineEventManifest;
    readonly grant: OfflineGrant;
    readonly operations: readonly OfflineOperation[];
}
export type OfflineRecordReader = (index: number) => Promise<Blob>;
export type OfflineRecordWriter = (index: number, record: Blob) => Promise<void>;
const invalid = () => new Error('Soubor offline kvízu je poškozený nebo nekompatibilní.');
export function parseOfflineArchiveHeader(value: unknown): OfflineArchiveHeader {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw invalid();
    }
    const v = value as Record<string, unknown>;
    if (Object.keys(v).length !== 5 || v.schemaVersion !== 1 || typeof v.salt !== 'string' || typeof v.noncePrefix !== 'string' || decodeBase64(v.salt).length !== 16 || decodeBase64(v.noncePrefix).length !== 8
        || !Number.isInteger(v.iterations) || (v.iterations as number) < 100000 || (v.iterations as number) > 500000 || !Array.isArray(v.recordSizes) || !v.recordSizes.length || v.recordSizes.length > 1024) {
        throw invalid();
    }
    const sizes = v.recordSizes as unknown[];
    if (sizes.some((size, index) => typeof size !== 'number' || !Number.isSafeInteger(size) || size < 17 || size > (index === 0 ? limits.manifestBytes + limits.journalBytes + 65536 : limits.chunkBytes) + 16)
        || sizes.reduce<number>((sum, size) => sum + (size as number), 0) > limits.payloadBytes + limits.manifestBytes + limits.journalBytes + 131072) {
        throw invalid();
    }
    return { schemaVersion: 1, salt: v.salt, iterations: v.iterations as number, noncePrefix: v.noncePrefix, recordSizes: sizes as number[] };
}
function iv(header: OfflineArchiveHeader, index: number): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(12);
    bytes.set(decodeBase64(header.noncePrefix));
    new DataView(bytes.buffer).setUint32(8, index);
    return bytes;
}
const aad = (header: OfflineArchiveHeader, index: number) => new TextEncoder().encode(canonicalOfflineJson({ header, index }));
async function decryptRecord(header: OfflineArchiveHeader, index: number, key: CryptoKey, record: Blob): Promise<Uint8Array<ArrayBuffer>> {
    if (record.size !== header.recordSizes[index]) {
        throw invalid();
    }
    try {
        return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv(header, index), additionalData: aad(header, index) }, key, await record.arrayBuffer()));
    }
    catch {
        throw new Error('Nesprávné heslo nebo poškozený soubor.');
    }
}
export async function readOfflineArchiveHeader(file: Blob): Promise<{
    header: OfflineArchiveHeader;
    readRecord: OfflineRecordReader;
}> {
    if (file.size < magic.length + 4 || file.size > limits.payloadBytes + limits.manifestBytes + limits.journalBytes + 262144) {
        throw invalid();
    }
    const prefix = await file.slice(0, magic.length + 4).arrayBuffer();
    if (!magic.every((byte, index) => new Uint8Array(prefix)[index] === byte)) {
        throw invalid();
    }
    const length = new DataView(prefix).getUint32(magic.length);
    if (length < 1 || length > 65536) {
        throw invalid();
    }
    const start = magic.length + 4 + length;
    const header = parseOfflineArchiveHeader(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await file.slice(magic.length + 4, start).arrayBuffer())) as unknown);
    if (start + header.recordSizes.reduce((sum, size) => sum + size, 0) !== file.size) {
        throw invalid();
    }
    const offsets: number[] = [];
    let offset = start;
    for (const size of header.recordSizes) {
        offsets.push(offset);
        offset += size;
    }
    return { header, readRecord: async (index) => {
            if (!Number.isInteger(index) || index < 0 || index >= offsets.length) {
                throw invalid();
            }
            return new Blob([await file.slice(offsets[index], offsets[index]! + header.recordSizes[index]!).arrayBuffer()]);
        } };
}
export async function unlockOfflineMetadata(header: OfflineArchiveHeader, readRecord: OfflineRecordReader, password: string, trusts: readonly OfflineTrust[]): Promise<{
    key: CryptoKey;
    metadata: OfflineArchiveMetadata;
}> {
    const key = await deriveOfflineKey(password, decodeBase64(header.salt), header.iterations);
    const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await decryptRecord(header, 0, key, await readRecord(0)))) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).length !== 3) {
        throw invalid();
    }
    const data = parsed as Record<string, unknown>, manifest = parseOfflineManifest(data.manifest), grant = data.grant as OfflineGrant, operations = parseOfflineOperations(data.operations);
    const trust = trusts.find(trust => trust.keyId === grant?.keyId && trust.environment === manifest.environment && trust.audience === manifest.audience);
    if (!trust) {
        throw new Error('Tento počítač nemá ověřený klíč přípravy. Připravte aplikaci online u své akce.');
    }
    await verifyOfflineGrant(manifest, grant, trust);
    const expectedRecords = 1 + manifest.assets.reduce((sum, asset) => sum + Math.ceil(asset.size / limits.chunkBytes), 0);
    if (expectedRecords !== header.recordSizes.length) {
        throw invalid();
    }
    return { key, metadata: { manifest, grant, operations } };
}
export async function readOfflineAsset(header: OfflineArchiveHeader, readRecord: OfflineRecordReader, key: CryptoKey, manifest: OfflineEventManifest, reference: string): Promise<Blob> {
    let index = 1;
    for (const asset of manifest.assets) {
        const count = Math.ceil(asset.size / limits.chunkBytes);
        if (asset.reference !== reference) {
            index += count;
            continue;
        }
        const chunks: Uint8Array<ArrayBuffer>[] = [];
        let size = 0;
        for (let part = 0; part < count; part++) {
            const bytes = await decryptRecord(header, index + part, key, await readRecord(index + part));
            size += bytes.length;
            if (size > asset.size) {
                throw invalid();
            }
            chunks.push(bytes);
        }
        if (size !== asset.size) {
            throw invalid();
        }
        const blob = new Blob(chunks, { type: asset.contentType });
        if (await offlineDigest(await blob.arrayBuffer()) !== asset.sha256) {
            throw invalid();
        }
        return blob;
    }
    throw new Error('Obrázek nebo ukázka nejsou součástí kvízu.');
}
interface OfflineClipBounds { readonly position?: number; readonly start: number; readonly end?: number }
export function offlineMediaFailure(manifest: OfflineEventManifest, reference: string, error: unknown): Error {
    const detail = error instanceof Error && error.constructor === Error
        ? error.message : 'Médium se nepodařilo stáhnout, přečíst nebo dekódovat. Zkontrolujte soubor a zkuste přípravu znovu.';
    if (detail.startsWith('Snímek ')) return new Error(detail, { cause: error });
    for (const slide of manifest.slides) {
        const fields = [
            [slide.questionImage, 'obrázek otázky'], [slide.answerImage, 'obrázek odpovědi'],
            [slide.backgroundImage, 'pozadí'], [slide.mediaSource, 'zdroj ukázky'],
            [slide.design?.backgroundImage, 'pozadí vzhledu'], [slide.design?.logoImage, 'logo vzhledu'],
            [slide.answerDesign?.backgroundImage, 'pozadí odpovědi'], [slide.answerDesign?.logoImage, 'logo odpovědi'],
        ];
        const field = fields.find(([value]) => value === reference)?.[1];
        if (field) return new Error(`Snímek ${slide.position} (${field}): ${detail}`, { cause: error });
        if (slide.media.some(media => media.source === reference)) {
            return new Error(`Snímek ${slide.position} (médium): ${detail}`, { cause: error });
        }
    }
    for (const [name, label] of [['interim', 'průběžné výsledky'], ['final', 'konečné pořadí']] as const) {
        const design = manifest.resultTemplates?.[name]?.design;
        if (design?.backgroundImage === reference || design?.logoImage === reference) {
            const field = design.backgroundImage === reference ? 'pozadí' : 'logo';
            return new Error(`${label} (${field}): ${detail}`, { cause: error });
        }
    }
    return new Error(detail, { cause: error });
}

export function offlineAssetClips(manifest: OfflineEventManifest, reference: string): readonly OfflineClipBounds[] {
    return manifest.slides.filter(slide => slide.mediaSource === reference || slide.media.some(media => media.role === 'prompt' && media.source === reference && ['audio', 'video'].includes(media.kind)))
        .map(slide => ({ position: slide.position, start: slide.clipStartSeconds ?? 0,
            ...(slide.clipEndSeconds == null || (slide.clipStartSeconds ?? 0) === 0 && slide.clipEndSeconds === 0 ? {} : { end: slide.clipEndSeconds }) }));
}
export async function verifyOfflineMedia(blob: Blob, asset: OfflineMediaAsset, clips: readonly OfflineClipBounds[] = []): Promise<void> {
    if (blob.size !== asset.size || blob.type !== asset.contentType || await offlineDigest(await blob.arrayBuffer()) !== asset.sha256) {
        throw invalid();
    }
    if (asset.kind === 'image') {
        const dimensions = readLocalImageDimensions(new Uint8Array(await blob.arrayBuffer()), asset.contentType as 'image/png' | 'image/jpeg' | 'image/webp');
        if (asset.width !== undefined && (dimensions.width !== asset.width || dimensions.height !== asset.height)) {
            throw invalid();
        }
        const bitmap = await createImageBitmap(blob);
        try {
            if (bitmap.width * bitmap.height !== dimensions.width * dimensions.height) {
                throw invalid();
            }
        }
        finally {
            bitmap.close();
        }
        return;
    }
    const url = URL.createObjectURL(blob);
    const video = asset.kind === 'video' ? document.createElement('video') : undefined;
    const player = video ?? document.createElement('audio');
    try {
        await new Promise<void>((resolve, reject) => {
            const timer = window.setTimeout(() => reject(new Error('Ukázku nelze v tomto prohlížeči přehrát.')), 20000);
            const done = (error?: Error) => {
                window.clearTimeout(timer);
                player.onloadeddata = null;
                player.onerror = null;
                if (error) {
                    reject(error);
                }
                else {
                    resolve();
                }
            };
            player.preload = 'auto';
            player.onloadeddata = () => {
                const invalidClip = clips.find(clip => !Number.isFinite(clip.start)
                    || clip.start < 0 || clip.start >= player.duration || (clip.end !== undefined && (!Number.isFinite(clip.end) || clip.end <= clip.start || clip.end > player.duration)));
                if (!Number.isFinite(player.duration) || player.duration <= 0) {
                    done(invalid());
                } else if (video && (video.videoWidth <= 0 || video.videoHeight <= 0)) {
                    done(new Error('Soubor MP4 neobsahuje obraz, který lze v tomto prohlížeči přehrát.'));
                } else if (invalidClip) {
                    done(new Error(`${invalidClip.position ? `Snímek ${invalidClip.position}: ` : ''}časování ukázky přesahuje délku souboru nebo má neplatné hranice.`));
                }
                else {
                    done();
                }
            };
            player.onerror = () => done(new Error('Formát ukázky není podporovaný.'));
            player.src = url;
            player.load();
        });
    }
    finally {
        player.pause();
        player.removeAttribute('src');
        player.load();
        URL.revokeObjectURL(url);
    }
}
export async function createOfflineArchive(metadata: OfflineArchiveMetadata, password: string, loadAsset: (asset: OfflineMediaAsset) => Promise<Blob>, writeRecord: OfflineRecordWriter, progress?: (index: number, total: number) => void): Promise<{
    header: OfflineArchiveHeader;
    key: CryptoKey;
}> {
    const manifest = parseOfflineManifest(metadata.manifest);
    const metadataBytes = new TextEncoder().encode(canonicalOfflineJson({ ...metadata, manifest }));
    const recordSizes = [metadataBytes.length + 16];
    for (const asset of manifest.assets) {
        for (let offset = 0; offset < asset.size; offset += limits.chunkBytes) {
            recordSizes.push(Math.min(limits.chunkBytes, asset.size - offset) + 16);
        }
    }
    const header = parseOfflineArchiveHeader({ schemaVersion: 1, salt: encodeBase64(crypto.getRandomValues(new Uint8Array(16))), iterations: offlineKdfIterations, noncePrefix: encodeBase64(crypto.getRandomValues(new Uint8Array(8))), recordSizes });
    const key = await deriveOfflineKey(password, decodeBase64(header.salt));
    let recordIndex = 0;
    const write = async (bytes: BufferSource) => {
        const index = recordIndex++;
        const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv(header, index), additionalData: aad(header, index) }, key, bytes);
        await writeRecord(index, new Blob([encrypted]));
    };
    await write(metadataBytes);
    for (const [index, asset] of manifest.assets.entries()) {
        let blob: Blob;
        try {
            blob = await loadAsset(asset);
            await verifyOfflineMedia(blob, asset, offlineAssetClips(manifest, asset.reference));
        } catch (error) {
            throw offlineMediaFailure(manifest, asset.reference, error);
        }
        for (let offset = 0; offset < blob.size; offset += limits.chunkBytes) {
            await write(await blob.slice(offset, offset + limits.chunkBytes).arrayBuffer());
        }
        progress?.(index + 1, manifest.assets.length);
    }
    return { header, key };
}
export async function writeOfflineArchive(header: OfflineArchiveHeader, readRecord: OfflineRecordReader, write: (blob: Blob) => Promise<void>): Promise<void> {
    const json = new TextEncoder().encode(canonicalOfflineJson(header)), prefix = new Uint8Array(magic.length + 4);
    prefix.set(magic);
    new DataView(prefix.buffer).setUint32(magic.length, json.length);
    await write(new Blob([prefix, json]));
    for (let index = 0; index < header.recordSizes.length; index++) {
        const record = await readRecord(index);
        if (record.size !== header.recordSizes[index]) {
            throw invalid();
        }
        await write(record);
    }
}
