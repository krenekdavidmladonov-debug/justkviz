import { httpsCallable } from 'firebase/functions';
import type { OfflineEventManifest, OfflineGrant, OfflineMediaAsset, OfflineOperation, OfflineSyncPreview, OfflineSyncReceipt, OfflineSyncResolution, OfflineTrust, PrepareOfflineEventResponse } from '@filmovy-kviz/quiz-domain';
import { getFirebaseServices } from '../../services/firebase/client';
import { getFirebaseAuth } from '../../services/firebase/auth';
import { localEventMediaAvailable } from '../events/localEventMediaApi';
async function identity(): Promise<void> {
    if (!localEventMediaAvailable()) {
        throw new Error('Tato implementace je určena pouze pro izolované místní emulátory.');
    }
    const auth = getFirebaseAuth();
    await auth.authStateReady();
    if (!auth.currentUser) {
        throw new Error('Nejprve se online přihlaste do administrace JustKvízu.');
    }
}
async function call<T>(name: string, input: unknown, timeout = 30000): Promise<T> {
    await identity();
    return (await httpsCallable<unknown, T>(getFirebaseServices().functions, name, { timeout })(input)).data;
}
export async function prepareOnlineOfflineEvent(eventId: string, requestId: string): Promise<PrepareOfflineEventResponse> {
    return call('prepareOfflineEvent', { eventId, requestId }, 120000);
}
export async function fetchOfflineTrust(eventId: string): Promise<OfflineTrust> {
    return call('readOfflineTrust', { eventId });
}
export async function authorizePreparedOfflineEvent(manifest: OfflineEventManifest, grant: OfflineGrant): Promise<void> {
    const result = await call<{
        exportId: string;
        manifestDigest: string;
        expiresAtMs: number;
    }>('authorizeOfflineEvent', { eventId: manifest.event.id, exportId: manifest.exportId, manifestDigest: grant.payload.manifestDigest });
    if (result.exportId !== manifest.exportId || result.manifestDigest !== grant.payload.manifestDigest || result.expiresAtMs !== manifest.expiresAtMs) {
        throw new Error('Příprava nebo oprávnění se změnily. Připravte nový soubor.');
    }
}
export async function fetchOfflineAsset(manifest: OfflineEventManifest, asset: OfflineMediaAsset): Promise<Blob> {
    await identity();
    const token = await getFirebaseAuth().currentUser!.getIdToken();
    const url = new URL('http://127.0.0.1:5001/demo-filmovy-kviz-v2/europe-west1/readQuizMedia');
    url.searchParams.set('reference', asset.reference);
    url.searchParams.set('snapshotId', manifest.snapshot.id);
    const response = await fetch(url, { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store', redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(60000) });
    if (response.status !== 200 || response.headers.get('Cache-Control') !== 'no-store'
        || response.headers.get('Content-Length') !== String(asset.size) || response.headers.get('Content-Type') !== asset.contentType || response.headers.get('ETag') !== asset.etag || !response.body) {
        await response.body?.cancel();
        throw new Error('Médium nelze autorizovaně stáhnout.');
    }
    const bytes = new Uint8Array(asset.size), reader = response.body.getReader();
    let offset = 0;
    try {
        while (true) {
            const next = await reader.read();
            if (next.done) {
                break;
            }
            if (offset + next.value.length > bytes.length) {
                await reader.cancel();
                throw new Error('Překročena velikost média.');
            }
            bytes.set(next.value, offset);
            offset += next.value.length;
        }
    }
    finally {
        reader.releaseLock();
    }
    if (offset !== asset.size) {
        throw new Error('Médium nebylo staženo celé.');
    }
    return new Blob([bytes], { type: asset.contentType });
}
export async function previewOfflineSynchronization(eventId: string, exportId: string, operations: readonly OfflineOperation[], resolutions?: readonly OfflineSyncResolution[], completeRecovery = false): Promise<OfflineSyncPreview> {
    return call('previewOfflineSync', { eventId, exportId, operations, ...(resolutions ? { resolutions } : {}), ...(completeRecovery ? { completeRecovery: true } : {}) }, 120000);
}
export async function commitOfflineSynchronization(eventId: string, exportId: string, operations: readonly OfflineOperation[], previewDigest: string, resolutions?: readonly OfflineSyncResolution[], completeRecovery = false): Promise<OfflineSyncReceipt> {
    const receipt = await call<OfflineSyncReceipt>('commitOfflineSync', { eventId, exportId, operations, previewDigest, ...(resolutions ? { resolutions } : {}), ...(completeRecovery ? { completeRecovery: true } : {}) }, 120000);
    if (!receipt || receipt.exportId !== exportId || receipt.operationCount !== operations.length
        || receipt.headHash !== (operations.at(-1)?.hash ?? '0'.repeat(64)) || typeof receipt.sessionId !== 'string'
        || typeof receipt.receiptId !== 'string' || !receipt.receiptId || typeof receipt.replayed !== 'boolean') {
        throw new Error('Potvrzení synchronizace neodpovídá odeslané historii. Místní data zůstala zachována.');
    }
    return receipt;
}
