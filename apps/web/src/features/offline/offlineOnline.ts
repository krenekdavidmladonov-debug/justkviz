import { httpsCallable } from 'firebase/functions';
import { canonicalOfflineJson } from '@filmovy-kviz/quiz-domain';
import type { OfflineEventManifest, OfflineEventPreflight, OfflineGrant, OfflineMediaAsset, OfflineOperation, OfflineSyncPreview, OfflineSyncReceipt, OfflineSyncResolution, OfflineTrust, PrepareOfflineEventResponse } from '@filmovy-kviz/quiz-domain';
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
async function call<T>(name: string, input: unknown, timeout = 30000, recovery = false, actorId?: string): Promise<T> {
    await identity(recovery, actorId);
    const { data } = await httpsCallable<unknown, T>(getFirebaseServices().functions, name, { timeout })(input);
    if (actorId !== undefined) await identity(recovery, actorId);
    return data;
}
export async function checkOnlineOfflineEvent(eventId: string): Promise<OfflineEventPreflight> {
    return call('readOfflineTrust', { eventId, preflight: true }, 120000);
}
export function observeOfflineIdentity(change: () => void): () => void {
    let previous: string | null | undefined;
    return getFirebaseAuth().onAuthStateChanged(user => {
        const uid = user?.uid ?? null;
        if (previous !== undefined && previous !== uid) change();
        previous = uid;
    });
}
export async function currentOfflineActor(): Promise<string> {
    return (await identity(false)).uid;
}
export async function prepareOnlineOfflineEvent(eventId: string, requestId: string, expectedSnapshotId: string, expectedActorId: string): Promise<PrepareOfflineEventResponse> {
    return call('prepareOfflineEvent', { eventId, requestId, expectedSnapshotId, expectedActorId }, 120000, false, expectedActorId);
}
export async function fetchOfflineTrust(eventId: string, actorId?: string): Promise<OfflineTrust> {
    const trust = await call<OfflineTrust>('readOfflineTrust', { eventId, ...(actorId === undefined ? {} : { expectedActorId: actorId }) }, 30000, false, actorId);
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
export async function authorizePreparedOfflineEvent(manifest: Pick<OfflineEventManifest, 'event' | 'exportId' | 'expiresAtMs' | 'actorId'>, grant: Pick<OfflineGrant, 'payload'>): Promise<void> {
    const result = await call<{
        exportId: string;
        manifestDigest: string;
        expiresAtMs: number;
    }>('authorizeOfflineEvent', { eventId: manifest.event.id, exportId: manifest.exportId, manifestDigest: grant.payload.manifestDigest }, 30000, false, manifest.actorId);
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
    const input = structuredClone({ eventId, exportId, operations, ...(resolutions ? { resolutions } : {}), ...(completeRecovery ? { completeRecovery: true } : {}) });
    return call('previewOfflineSync', input, 120000, true);
}
export async function commitOfflineSynchronization(eventId: string, exportId: string, operations: readonly OfflineOperation[], previewDigest: string, resolutions?: readonly OfflineSyncResolution[], completeRecovery = false): Promise<OfflineSyncReceipt> {
    const input = structuredClone({ eventId, exportId, operations, previewDigest, ...(resolutions ? { resolutions } : {}), ...(completeRecovery ? { completeRecovery: true } : {}) });
    const receipt = await call<OfflineSyncReceipt>('commitOfflineSync', input, 120000, true);
    if (!receipt || receipt.exportId !== exportId || receipt.operationCount !== input.operations.length
        || receipt.headHash !== (input.operations.at(-1)?.hash ?? '0'.repeat(64)) || typeof receipt.sessionId !== 'string'
        || typeof receipt.receiptId !== 'string' || !receipt.receiptId || typeof receipt.replayed !== 'boolean') {
        throw new Error('Potvrzení synchronizace neodpovídá odeslané historii. Místní data zůstala zachována.');
    }
    return receipt;
}
