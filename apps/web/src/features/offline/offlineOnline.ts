import { httpsCallable } from 'firebase/functions';
import { canonicalOfflineJson } from '@filmovy-kviz/quiz-domain';
import type { OfflineEventManifest, OfflineGrant, OfflineMediaAsset, OfflineOperation, OfflineSyncPreview, OfflineSyncReceipt, OfflineSyncResolution, OfflineTrust, PrepareOfflineEventResponse } from '@filmovy-kviz/quiz-domain';
import { getFirebaseServices } from '../../services/firebase/client';
import { getFirebaseAuth } from '../../services/firebase/auth';
import { quizMediaEndpoint } from '../../services/firebase/mediaEndpoint';
import { currentOfflineEnvironment, currentOfflineMode, offlineAudience } from './offlineAvailability';
import { offlineDigest } from './offlineCrypto';

async function identity(recovery: boolean, actorId?: string) {
    const mode = currentOfflineMode();
    if (!mode || (mode === 'recovery' && !recovery)) {
        throw new Error('Příprava offline kvízu zde není dostupná.');
    }
    const auth = getFirebaseAuth();
    await auth.authStateReady();
    const user = auth.currentUser;
    if (!user || (actorId !== undefined && user.uid !== actorId)) {
        throw new Error('Nejprve se online přihlaste do administrace JustKvízu.');
    }
    return user;
}
async function call<T>(name: string, input: unknown, timeout = 30000, recovery = false): Promise<T> {
    await identity(recovery);
    return (await httpsCallable<unknown, T>(getFirebaseServices().functions, name, { timeout })(input)).data;
}
export async function prepareOnlineOfflineEvent(eventId: string, requestId: string): Promise<PrepareOfflineEventResponse> {
    return call('prepareOfflineEvent', { eventId, requestId }, 120000);
}
export async function fetchOfflineTrust(eventId: string): Promise<OfflineTrust> {
    const trust = await call<OfflineTrust>('readOfflineTrust', { eventId });
    const key = trust?.publicJwk;
    if (trust?.schemaVersion !== 1 || trust.environment !== currentOfflineEnvironment() || trust.audience !== offlineAudience
        || !key || key.kty !== 'EC' || key.crv !== 'P-256' || key.ext !== true
        || !Array.isArray(key.key_ops) || key.key_ops.length !== 1 || key.key_ops[0] !== 'verify'
        || typeof key.x !== 'string' || typeof key.y !== 'string' || !/^[\w-]{43}$/u.test(key.x) || !/^[\w-]{43}$/u.test(key.y)
        || trust.keyId !== await offlineDigest(canonicalOfflineJson(key))) {
        throw new Error('Podpisový klíč nepatří k tomuto prostředí JustKvízu.');
    }
    await crypto.subtle.importKey('jwk', key, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return trust;
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
    if (manifest.environment !== currentOfflineEnvironment() || manifest.audience !== offlineAudience) {
        throw new Error('Offline kvíz patří do jiného prostředí JustKvízu.');
    }
    const user = await identity(false, manifest.actorId);
    const url = quizMediaEndpoint();
    const token = await user.getIdToken();
    if (getFirebaseAuth().currentUser !== user) throw new Error('Přihlášený uživatel se změnil.');
    url.searchParams.set('reference', asset.reference);
    url.searchParams.set('eventId', manifest.event.id);
    url.searchParams.set('offlineExportId', manifest.exportId);
    const response = await fetch(url, { headers: { Authorization: 'Bearer ' + token, 'If-Match': asset.etag }, cache: 'no-store', redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(60000) });
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
    return call('previewOfflineSync', { eventId, exportId, operations, ...(resolutions ? { resolutions } : {}), ...(completeRecovery ? { completeRecovery: true } : {}) }, 120000, true);
}
export async function commitOfflineSynchronization(eventId: string, exportId: string, operations: readonly OfflineOperation[], previewDigest: string, resolutions?: readonly OfflineSyncResolution[], completeRecovery = false): Promise<OfflineSyncReceipt> {
    const receipt = await call<OfflineSyncReceipt>('commitOfflineSync', { eventId, exportId, operations, previewDigest, ...(resolutions ? { resolutions } : {}), ...(completeRecovery ? { completeRecovery: true } : {}) }, 120000, true);
    if (!receipt || receipt.exportId !== exportId || receipt.operationCount !== operations.length
        || receipt.headHash !== (operations.at(-1)?.hash ?? '0'.repeat(64)) || typeof receipt.sessionId !== 'string'
        || typeof receipt.receiptId !== 'string' || !receipt.receiptId || typeof receipt.replayed !== 'boolean') {
        throw new Error('Potvrzení synchronizace neodpovídá odeslané historii. Místní data zůstala zachována.');
    }
    return receipt;
}
