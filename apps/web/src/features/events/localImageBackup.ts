import { httpsCallable } from 'firebase/functions';
import { localImageBackupLimits as limits, parseLocalImageManifest, parseLocalImageAuthorization, readLocalImageDimensions, type LocalImageAsset, type LocalImageManifest, canonicalLocalImageManifestContent, } from '@filmovy-kviz/quiz-domain';
import { getFirebaseServices } from '../../services/firebase/client';
import { getFirebaseAuth } from '../../services/firebase/auth';
import { localEventMediaAvailable, type LocalEventMediaScope } from './localEventMediaApi';
const magic = new TextEncoder().encode('JUSTKVIZ-IMAGE-BACKUP/3\n');
const prefixSize = magic.length + 4;
export interface LoadedImageBackup {
    readonly manifest: LocalImageManifest;
    readonly images: ReadonlyMap<string, Blob>;
}
export type ImageProgress = (reference: string, status: 'pending' | 'downloading' | 'verified' | 'invalid') => void;
function user(scope: Pick<LocalEventMediaScope, 'actorId'>, signal: AbortSignal) {
    signal.throwIfAborted();
    const current = getFirebaseAuth().currentUser;
    if (!localEventMediaAvailable() || !navigator.onLine || current?.uid !== scope.actorId)
        throw new Error('Záloha není autorizována.');
    return current;
}
async function verifyManifestId(manifest: LocalImageManifest, signal: AbortSignal): Promise<void> {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalLocalImageManifestContent(manifest))));
    signal.throwIfAborted();
    if (Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('') !== manifest.manifestId)
        throw new Error('Nesouhlasí manifest zálohy.');
}
export async function readImageManifest(scope: LocalEventMediaScope, signal: AbortSignal): Promise<LocalImageManifest> {
    user(scope, signal);
    const response = await httpsCallable<{
        eventId: string;
    }, unknown>(getFirebaseServices().functions, 'readLocalImageManifest', { timeout: 120000 })({ eventId: scope.eventId });
    user(scope, signal);
    const manifest = parseLocalImageManifest(response.data);
    if (manifest.eventId !== scope.eventId || manifest.snapshotId !== scope.snapshotId || manifest.quizRevision !== scope.quizRevision)
        throw new Error('Změnil se připravený kvíz.');
    await verifyManifestId(manifest, signal);
    if (manifest.missing.length === 0)
        await authorizeImageBackup(scope, manifest, signal);
    return manifest;
}
export async function authorizeImageBackup(scope: Pick<LocalEventMediaScope, 'actorId' | 'eventId' | 'snapshotId'>, manifest: LocalImageManifest, signal: AbortSignal): Promise<void> {
    user(scope, signal);
    await verifyManifestId(manifest, signal);
    if (manifest.missing.length)
        throw new Error('Záloha nemá všechny obrázky.');
    if (manifest.eventId !== scope.eventId || manifest.snapshotId !== scope.snapshotId || manifest.validUntilMs <= Date.now())
        throw new Error('Záloha není aktuální.');
    const response = await httpsCallable<object, unknown>(getFirebaseServices().functions, 'authorizeLocalImageBackup', { timeout: 5000 })({ eventId: scope.eventId, snapshotId: scope.snapshotId, manifestId: manifest.manifestId });
    user(scope, signal);
    const auth = parseLocalImageAuthorization(response.data);
    if (auth.eventId !== manifest.eventId || auth.snapshotId !== manifest.snapshotId || auth.manifestId !== manifest.manifestId
        || auth.scopeKey !== manifest.scopeKey || auth.validUntilMs !== manifest.validUntilMs)
        throw new Error('Oprávnění nebo záloha se změnily.');
}
export async function verifyImageBlob(blob: Blob, asset: Pick<LocalImageAsset, 'size' | 'contentType' | 'sha256' | 'width' | 'height'>, signal: AbortSignal, decode = true): Promise<void> {
    signal.throwIfAborted();
    if (blob.size !== asset.size || blob.size > limits.assetBytes || blob.type !== asset.contentType)
        throw new Error('Neplatný obrázek.');
    const bytes = await blob.arrayBuffer();
    signal.throwIfAborted();
    const dimensions = readLocalImageDimensions(new Uint8Array(bytes), asset.contentType);
    if (dimensions.width !== asset.width || dimensions.height !== asset.height)
        throw new Error('Nesouhlasí rozměry obrázku.');
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    signal.throwIfAborted();
    if (Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('') !== asset.sha256)
        throw new Error('Nesouhlasí obsah obrázku.');
    if (decode) {
        const bitmap = await createImageBitmap(blob);
        try {
            signal.throwIfAborted();
            const rawDimensions = bitmap.width === asset.width && bitmap.height === asset.height;
            // Native decoding may apply EXIF orientation; an exact transpose retains the validated pixel budget.
            const transposedDimensions = bitmap.width === asset.height && bitmap.height === asset.width;
            if (!rawDimensions && !transposedDimensions)
                throw new Error('Obrázek nelze dekódovat.');
        }
        finally {
            bitmap.close();
        }
    }
}
async function download(scope: LocalEventMediaScope, asset: LocalImageAsset, signal: AbortSignal): Promise<Blob> {
    const token = await user(scope, signal).getIdToken();
    user(scope, signal);
    const url = new URL('http://127.0.0.1:5001/demo-filmovy-kviz-v2/europe-west1/readQuizMedia');
    url.searchParams.set('reference', asset.reference);
    url.searchParams.set('snapshotId', scope.snapshotId);
    const response = await fetch(url, { headers: { Authorization: 'Bearer ' + token }, signal, cache: 'no-store', redirect: 'error', credentials: 'omit' });
    if (response.status !== 200 || response.headers.get('ETag') !== asset.etag || response.headers.get('Content-Type') !== asset.contentType
        || response.headers.get('Content-Length') !== String(asset.size) || response.headers.get('Cache-Control') !== 'no-store' || !response.body) {
        await response.body?.cancel();
        throw new Error('Obrázek se nepodařilo stáhnout.');
    }
    const reader = response.body.getReader(), bytes = new Uint8Array(asset.size);
    let offset = 0;
    try {
        while (true) {
            const chunk = await reader.read();
            if (chunk.done)
                break;
            if (offset + chunk.value.length > bytes.length) {
                await reader.cancel();
                throw new Error('Překročená velikost obrázku.');
            }
            bytes.set(chunk.value, offset);
            offset += chunk.value.length;
        }
    }
    finally {
        reader.releaseLock();
    }
    if (offset !== asset.size)
        throw new Error('Neúplný obrázek.');
    user(scope, signal);
    return new Blob([bytes], { type: asset.contentType });
}
export async function prepareImageBackup(scope: LocalEventMediaScope, signal: AbortSignal, progress: ImageProgress, onManifest?: (manifest: LocalImageManifest) => void): Promise<{
    manifest: LocalImageManifest;
    file: Blob;
}> {
    const manifest = await readImageManifest(scope, signal);
    signal.throwIfAborted();
    onManifest?.(manifest);
    manifest.assets.forEach(asset => progress(asset.reference, 'pending'));
    if (manifest.missing.length)
        throw new Error('Některé obrázky nejsou dostupné.');
    const images: Blob[] = [];
    for (const asset of manifest.assets) {
        progress(asset.reference, 'downloading');
        try {
            const blob = await download(scope, asset, AbortSignal.any([signal, AbortSignal.timeout(30000)]));
            await verifyImageBlob(blob, asset, signal);
            images.push(blob);
            progress(asset.reference, 'verified');
        }
        catch (error) {
            progress(asset.reference, 'invalid');
            throw error;
        }
    }
    await authorizeImageBackup(scope, manifest, signal);
    const header = new TextEncoder().encode(JSON.stringify(manifest)), prefix = new Uint8Array(prefixSize);
    prefix.set(magic);
    new DataView(prefix.buffer).setUint32(magic.length, header.length);
    return { manifest, file: new Blob([prefix, header, ...images], { type: 'application/octet-stream' }) };
}
export async function readImageBackupHeader(file: Blob): Promise<{
    manifest: LocalImageManifest;
    start: number;
}> {
    if (file.size < prefixSize || file.size > prefixSize + limits.headerBytes + limits.payloadBytes)
        throw new Error('Neplatná velikost zálohy.');
    const prefix = await file.slice(0, prefixSize).arrayBuffer();
    if (!magic.every((byte, index) => new Uint8Array(prefix)[index] === byte))
        throw new Error('Starší balíček otevřete v původním pilotu (?backupPilot=1).');
    const length = new DataView(prefix).getUint32(magic.length);
    if (length < 1 || length > limits.headerBytes || prefixSize + length > file.size)
        throw new Error('Neplatná hlavička zálohy.');
    const manifest = parseLocalImageManifest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await file.slice(prefixSize, prefixSize + length).arrayBuffer())) as unknown);
    const start = prefixSize + length;
    if (start + manifest.assets.reduce((sum, asset) => sum + asset.size, 0) !== file.size)
        throw new Error('Neúplná záloha.');
    return { manifest, start };
}
export async function openImageBackup(file: Blob, scope: Pick<LocalEventMediaScope, 'actorId' | 'eventId' | 'snapshotId'>, signal: AbortSignal, progress?: ImageProgress): Promise<LoadedImageBackup> {
    const { manifest, start } = await readImageBackupHeader(file);
    await authorizeImageBackup(scope, manifest, signal);
    const images = new Map<string, Blob>();
    let offset = start;
    for (const asset of manifest.assets) {
        progress?.(asset.reference, 'downloading');
        try {
            // Retain the exact verified bytes, independent of a later change/removal of the disk file.
            const blob = new Blob([await file.slice(offset, offset + asset.size).arrayBuffer()], {type:asset.contentType});
            signal.throwIfAborted();
            offset += asset.size;
            await verifyImageBlob(blob, asset, signal);
            images.set(asset.reference, blob);
            progress?.(asset.reference, 'verified');
        }
        catch (error) {
            progress?.(asset.reference, 'invalid');
            throw error;
        }
    }
    await authorizeImageBackup(scope, manifest, signal);
    signal.throwIfAborted();
    return { manifest, images };
}
