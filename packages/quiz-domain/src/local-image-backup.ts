import { parseQuizAsset } from './media-assets.js';
export const localImageBackupLimits = {
    assets: 64, assetBytes: 10 * 1024 * 1024, payloadBytes: 64 * 1024 * 1024,
    headerBytes: 256 * 1024, pixels: 8388608, dimension: 8192,
    framePixels: 16777216, uses: 1600, transfers: 4,
} as const;
export const localImageRoles = ['question-image', 'background-image', 'logo-image', 'answer-image'] as const;
export type LocalImageRole = typeof localImageRoles[number];
export type LocalImageContentType = 'image/png' | 'image/jpeg' | 'image/webp';
export interface LocalImageUse {
    readonly slidePosition: number;
    readonly role: LocalImageRole;
}
export interface LocalImageIdentity {
    readonly reference: string;
    readonly generation: string;
    readonly contentType: LocalImageContentType;
    readonly size: number;
    readonly sha256: string;
    readonly width: number;
    readonly height: number;
    readonly etag: string;
}
export interface LocalImageAsset extends LocalImageIdentity {
    readonly visibility: 'public' | 'answer';
    readonly uses: readonly LocalImageUse[];
}
export interface LocalImageOmission {
    readonly position: number;
    readonly role: LocalImageRole;
    readonly reason: string;
}
export interface LocalImageManifest {
    readonly schemaVersion: 3;
    readonly eventId: string;
    readonly snapshotId: string;
    readonly quizRevision: number;
    readonly validUntilMs: number;
    readonly scopeKey: string;
    readonly manifestId: string;
    readonly assets: readonly LocalImageAsset[];
    readonly excluded: readonly LocalImageOmission[];
    readonly missing: readonly LocalImageOmission[];
}
export interface LocalImageAuthorization {
    readonly schemaVersion: 3;
    readonly eventId: string;
    readonly snapshotId: string;
    readonly manifestId: string;
    readonly scopeKey: string;
    readonly validUntilMs: number;
}
export interface LocalImageAuthority {
    readonly schemaVersion: 3;
    readonly sessionId: string;
    readonly revision: number;
    readonly slidePosition: number;
    readonly mediaGeneration: number;
    readonly eventId: string;
    readonly snapshotId: string;
    readonly quizRevision: number;
    readonly validUntilMs: number;
    readonly expiresAtMs: number;
    readonly media: LocalImageIdentity & {
        readonly role: LocalImageRole;
    };
}
export function canonicalLocalImageManifestContent(manifest: Omit<LocalImageManifest, 'manifestId'>): string {
    return JSON.stringify({ schemaVersion: manifest.schemaVersion, eventId: manifest.eventId, snapshotId: manifest.snapshotId,
        quizRevision: manifest.quizRevision, validUntilMs: manifest.validUntilMs, scopeKey: manifest.scopeKey,
        assets: manifest.assets, excluded: manifest.excluded, missing: manifest.missing });
}
const id = /^[A-Za-z0-9_-]{1,150}$/u, digest = /^[a-f0-9]{64}$/u;
function reject(): never {
    throw new Error('Neplatná záloha obrázků.');
}
function object(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : reject();
}
function exact(value: unknown, fields: readonly string[]) {
    const record = object(value);
    if (Object.keys(record).length !== fields.length || fields.some(key => !Object.hasOwn(record, key)))
        reject();
    return record;
}
function integer(value: unknown, maximum = Number.MAX_SAFE_INTEGER, minimum = 0): number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : reject();
}
function text(value: unknown, pattern: RegExp): string {
    return typeof value === 'string' && pattern.test(value) ? value : reject();
}
export function parseLocalImageRole(value: unknown): LocalImageRole {
    return localImageRoles.find(role => role === value) ?? reject();
}
const identityFields = ['reference', 'generation', 'contentType', 'size', 'sha256', 'width', 'height', 'etag'] as const;
function identity(value: Record<string, unknown>): LocalImageIdentity {
    if (typeof value.reference !== 'string' || !parseQuizAsset(value.reference)
        || !['image/png', 'image/jpeg', 'image/webp'].includes(String(value.contentType)))
        reject();
    const width = integer(value.width, localImageBackupLimits.dimension, 1), height = integer(value.height, localImageBackupLimits.dimension, 1);
    if (width * height > localImageBackupLimits.pixels)
        reject();
    return {
        reference: value.reference, generation: text(value.generation, /^[1-9]\d{0,29}$/u),
        contentType: value.contentType as LocalImageContentType, size: integer(value.size, localImageBackupLimits.assetBytes, 1),
        sha256: text(value.sha256, digest), width, height, etag: text(value.etag, /^"[a-f0-9]{64}"$/u),
    };
}
export function parseLocalImageAsset(value: unknown): LocalImageAsset {
    const data = exact(value, [...identityFields, 'visibility', 'uses']);
    if (data.visibility !== 'public' && data.visibility !== 'answer')
        reject();
    if (!Array.isArray(data.uses) || data.uses.length < 1 || data.uses.length > localImageBackupLimits.uses)
        reject();
    const seen = new Set<string>();
    const uses = data.uses.map((value): LocalImageUse => {
        const use = exact(value, ['slidePosition', 'role']);
        const result = { slidePosition: integer(use.slidePosition, 400), role: parseLocalImageRole(use.role) };
        const key = JSON.stringify(result);
        if (seen.has(key))
            reject();
        seen.add(key);
        return result;
    });
    return { ...identity(data), visibility: data.visibility, uses };
}
function omissions(value: unknown): readonly LocalImageOmission[] {
    if (!Array.isArray(value) || value.length > localImageBackupLimits.uses)
        reject();
    return value.map(entry => {
        const data = exact(entry, ['position', 'role', 'reason']);
        return { position: integer(data.position, 400), role: parseLocalImageRole(data.role), reason: text(data.reason, /^[a-z0-9-]{1,80}$/u) };
    });
}
export function parseLocalImageManifest(value: unknown): LocalImageManifest {
    const data = exact(value, ['schemaVersion', 'eventId', 'snapshotId', 'quizRevision', 'validUntilMs', 'scopeKey', 'manifestId', 'assets', 'excluded', 'missing']);
    if (data.schemaVersion !== 3 || !Array.isArray(data.assets) || data.assets.length > localImageBackupLimits.assets)
        reject();
    const assets = data.assets.map(parseLocalImageAsset);
    const refs = new Set(assets.map(asset => asset.reference));
    if (refs.size !== assets.length || assets.reduce((sum, asset) => sum + asset.size, 0) > localImageBackupLimits.payloadBytes
        || assets.reduce((sum, asset) => sum + asset.uses.length, 0) > localImageBackupLimits.uses)
        reject();
    const result: LocalImageManifest = { schemaVersion: 3, eventId: text(data.eventId, id), snapshotId: text(data.snapshotId, id),
        quizRevision: integer(data.quizRevision), validUntilMs: integer(data.validUntilMs, Number.MAX_SAFE_INTEGER, 1),
        scopeKey: text(data.scopeKey, digest), manifestId: text(data.manifestId, digest), assets,
        excluded: omissions(data.excluded), missing: omissions(data.missing) };
    if (new TextEncoder().encode(JSON.stringify(result)).byteLength > localImageBackupLimits.headerBytes)
        reject();
    return result;
}
export function parseLocalImageAuthorization(value: unknown): LocalImageAuthorization {
    const data = exact(value, ['schemaVersion', 'eventId', 'snapshotId', 'manifestId', 'scopeKey', 'validUntilMs']);
    if (data.schemaVersion !== 3)
        reject();
    return { schemaVersion: 3, eventId: text(data.eventId, id), snapshotId: text(data.snapshotId, id), manifestId: text(data.manifestId, digest),
        scopeKey: text(data.scopeKey, digest), validUntilMs: integer(data.validUntilMs, Number.MAX_SAFE_INTEGER, 1) };
}
export function parseLocalImageAuthority(value: unknown): LocalImageAuthority {
    const data = exact(value, ['schemaVersion', 'sessionId', 'revision', 'slidePosition', 'mediaGeneration', 'eventId', 'snapshotId', 'quizRevision', 'validUntilMs', 'expiresAtMs', 'media']);
    if (data.schemaVersion !== 3)
        reject();
    const media = exact(data.media, [...identityFields, 'role']);
    const validUntilMs = integer(data.validUntilMs, Number.MAX_SAFE_INTEGER, 1), expiresAtMs = integer(data.expiresAtMs, validUntilMs, 1);
    return { schemaVersion: 3, sessionId: text(data.sessionId, id), revision: integer(data.revision), slidePosition: integer(data.slidePosition, 400),
        mediaGeneration: integer(data.mediaGeneration), eventId: text(data.eventId, id), snapshotId: text(data.snapshotId, id),
        quizRevision: integer(data.quizRevision), validUntilMs, expiresAtMs, media: { ...identity(media), role: parseLocalImageRole(media.role) } };
}
/** Bounded static container inspection; the browser must additionally decode the real image. */
export function localImageDimensions(bytes: Uint8Array, contentType: LocalImageContentType): {
    width: number;
    height: number;
} {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const ascii = (at: number, count: number) => String.fromCharCode(...bytes.subarray(at, at + count));
    let width = 0, height = 0;
    if (contentType === 'image/png') {
        if (bytes.length < 33 || ![137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v) || ascii(12, 4) !== 'IHDR' || view.getUint32(8) !== 13)
            reject();
        width = view.getUint32(16);
        height = view.getUint32(20);
        let offset = 8, ended = false;
        while (offset + 12 <= bytes.length) {
            const length = view.getUint32(offset), type = ascii(offset + 4, 4);
            if (length > bytes.length - offset - 12 || (type === 'IHDR' && offset !== 8) || type === 'acTL' || type === 'fcTL' || type === 'fdAT')
                reject();
            offset += length + 12;
            if (type === 'IEND') {
                ended = length === 0 && offset === bytes.length;
                break;
            }
        }
        if (!ended)
            reject();
    }
    else if (contentType === 'image/jpeg') {
        if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[bytes.length - 2] !== 255 || bytes[bytes.length - 1] !== 217)
            reject();
        let offset = 2, frames = 0;
        while (offset + 4 <= bytes.length) {
            if (bytes[offset] !== 255)
                reject();
            while (bytes[offset] === 255)
                offset++;
            const marker = bytes[offset++]!;
            if (marker === 218 || marker === 217)
                break;
            const length = view.getUint16(offset);
            if (length < 2 || length > bytes.length - offset)
                reject();
            if ([192, 193, 194].includes(marker)) {
                if (length < 8 || ++frames !== 1)
                    reject();
                height = view.getUint16(offset + 3);
                width = view.getUint16(offset + 5);
            }
            offset += length;
        }
    }
    else {
        if (bytes.length < 20 || ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WEBP' || view.getUint32(4, true) + 8 !== bytes.length)
            reject();
        let offset = 12, imageWidth = 0, imageHeight = 0, payloads = 0, canvases = 0;
        while (offset + 8 <= bytes.length) {
            const type = ascii(offset, 4), length = view.getUint32(offset + 4, true), at = offset + 8;
            if (length > bytes.length - at || type === 'ANIM' || type === 'ANMF')
                reject();
            if (type === 'VP8X') {
                if (length !== 10 || ++canvases !== 1 || (bytes[at]! & 2))
                    reject();
                width = 1 + bytes[at + 4]! + (bytes[at + 5]! << 8) + (bytes[at + 6]! << 16);
                height = 1 + bytes[at + 7]! + (bytes[at + 8]! << 8) + (bytes[at + 9]! << 16);
            }
            else if (type === 'VP8 ') {
                if (length < 10 || ++payloads !== 1 || ascii(at + 3, 3) !== '\x9d\x01\x2a')
                    reject();
                imageWidth = view.getUint16(at + 6, true) & 16383;
                imageHeight = view.getUint16(at + 8, true) & 16383;
            }
            else if (type === 'VP8L') {
                if (length < 5 || ++payloads !== 1 || bytes[at] !== 47)
                    reject();
                const bits = view.getUint32(at + 1, true);
                imageWidth = (bits & 16383) + 1;
                imageHeight = ((bits >>> 14) & 16383) + 1;
            }
            offset = at + length + (length % 2);
        }
        if (offset !== bytes.length || payloads !== 1 || (canvases && (width !== imageWidth || height !== imageHeight)))
            reject();
        width = imageWidth;
        height = imageHeight;
    }
    if (width < 1 || height < 1 || width > localImageBackupLimits.dimension || height > localImageBackupLimits.dimension || width * height > localImageBackupLimits.pixels)
        reject();
    return { width, height };
}
export const readLocalImageDimensions = localImageDimensions;
