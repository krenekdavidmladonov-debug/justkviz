import { httpsCallable } from 'firebase/functions';
import { parseLocalImageAuthority, type LocalImageAuthority, type LocalImageRole, localImageBackupLimits } from '@filmovy-kviz/quiz-domain';
import { getFirebaseServices } from '../../services/firebase/client';
import { authorizeImageBackup, type LoadedImageBackup } from '../events/localImageBackup';
import { localMediaBackupSupported, type LocalMediaOperatorScope } from './localMediaBackupAuthority';
import { managedProjectorWindow } from './projectorWindow';
import type { PublicLiveState } from './types';
const requestType = 'justkviz-local-image-request-v3', usedType = 'justkviz-local-image-used-v3';
const received = new Map<string, {
    nonce: string;
    until: number;
    cleanup:()=>void;
}>();
function removeReceived(key:string):void{
    received.get(key)?.cleanup();
    received.delete(key);
}
export const imageAuthorityKey = (authority: LocalImageAuthority) => JSON.stringify({ ...authority, expiresAtMs: 0 });
export async function readImageAuthority(state: PublicLiveState, reference: string, role: LocalImageRole, signal: AbortSignal): Promise<LocalImageAuthority> {
    signal.throwIfAborted();
    if (!localMediaBackupSupported() || !navigator.onLine)
        throw new Error('Obrázek není autorizován.');
    const payload = { sessionId: state.sessionId, revision: state.revision, slidePosition: state.slidePosition, mediaGeneration: state.mediaGeneration, reference, role };
    const response = await httpsCallable<typeof payload, unknown>(getFirebaseServices().functions, 'readLocalImageAuthority', { timeout: 5000 })(payload);
    signal.throwIfAborted();
    const grant = parseLocalImageAuthority(response.data);
    if (grant.sessionId !== state.sessionId || grant.revision !== state.revision || grant.slidePosition !== state.slidePosition || grant.mediaGeneration !== state.mediaGeneration
        || grant.media.reference !== reference || grant.media.role !== role || grant.expiresAtMs <= Date.now() || grant.expiresAtMs > Date.now() + 5000)
        throw new Error('Obrázek není aktuální.');
    return grant;
}
async function request(authority: LocalImageAuthority, signal: AbortSignal, mode: 'bytes' | 'renew'): Promise<Blob | undefined> {
    signal.throwIfAborted();
    const opener = window.opener as Window | null;
    if (!localMediaBackupSupported() || !opener || opener.closed)
        throw new Error('Projektor není propojen.');
    const key = imageAuthorityKey(authority);
    for (const [entry, pending] of received)
        if (pending.until <= Date.now())
            removeReceived(entry);
    if (mode === 'bytes')
        removeReceived(key);
    return new Promise((resolve, reject) => {
        const channel = new MessageChannel(), nonce = crypto.randomUUID();
        let settled = false;
        const cleanup = () => {
            window.clearTimeout(timer);
            signal.removeEventListener('abort', fail);
            channel.port1.close();
            channel.port2.close();
        };
        const fail = () => {
            if (settled)
                return;
            settled = true;
            cleanup();
            reject(new Error('Místní obrázek není dostupný.'));
        };
        const timer = window.setTimeout(fail, Math.min(4000, Math.max(1, authority.expiresAtMs - Date.now())));
        signal.addEventListener('abort', fail, { once: true });
        channel.port1.onmessage = ({ data }: MessageEvent<unknown>) => {
            if (settled || signal.aborted || authority.expiresAtMs <= Date.now() || !data || typeof data !== 'object') {
                fail();
                return;
            }
            const value = data as Record<string, unknown>;
            if (value.nonce !== nonce || value.key !== key || Object.keys(value).length !== (mode === 'bytes' ? 3 : 2)) {
                fail();
                return;
            }
            if (mode === 'bytes' && (!(value.bytes instanceof ArrayBuffer) || value.bytes.byteLength !== authority.media.size)) {
                fail();
                return;
            }
            settled = true;
            cleanup();
            if (mode === 'bytes') {
                while(received.size>=32){const oldest=received.keys().next().value;if(oldest!==undefined)removeReceived(oldest);}
                const forget=()=>{if(received.get(key)?.nonce===nonce)removeReceived(key);};
                const expiry=window.setTimeout(forget,Math.max(1,authority.expiresAtMs-Date.now()));
                signal.addEventListener('abort',forget,{once:true});
                received.set(key, { nonce, until: authority.expiresAtMs,cleanup:()=>{window.clearTimeout(expiry);signal.removeEventListener('abort',forget);} });
                resolve(new Blob([value.bytes as ArrayBuffer], { type: authority.media.contentType }));
            }
            else
                resolve(undefined);
        };
        channel.port1.onmessageerror = fail;
        try {
            opener.postMessage({ type: requestType, nonce, mode, authority }, window.location.origin, [channel.port2]);
        }
        catch {
            fail();
        }
    });
}
export async function requestLocalImage(authority: LocalImageAuthority, signal: AbortSignal): Promise<Blob> {
    const blob = await request(authority, signal, 'bytes');
    if (!blob)
        throw new Error('Chybí obrázek.');
    return blob;
}
export async function renewLocalImage(authority: LocalImageAuthority, signal: AbortSignal): Promise<void> {
    await request(authority, signal, 'renew');
}
export function notifyLocalImageUsed(authority: LocalImageAuthority): void {
    for(const [entry,pending] of received)if(pending.until<=Date.now())removeReceived(entry);
    const key = imageAuthorityKey(authority), pending = received.get(key);
    removeReceived(key);
    if (!pending || pending.until <= Date.now() || authority.expiresAtMs <= Date.now())
        return;
    try {
        (window.opener as Window | null)?.postMessage({ type: usedType, nonce: pending.nonce, key }, window.location.origin);
    }
    catch { /* An acknowledgement grants no authority. */
    }
}
export function serveLocalImages(scope: LocalMediaOperatorScope, state: PublicLiveState, loaded: LoadedImageBackup, report: (status: 'used' | 'invalid') => void): () => void {
    const lifetime = new AbortController(), ports = new Set<MessagePort>(), requests = new Map<string, number>(), acks = new Map<string, {
        key: string;
        until: number;
    }>();
    let authorizing: Promise<void> | undefined;
    const authorizeOperator = (): Promise<void> => {
        if (!authorizing) {
            // Concurrent roles share one pending check of this exact operator, frame and full manifest.
            // The completed result is never cached or reused by a subsequent request.
            authorizing = authorizeImageBackup(scope, loaded.manifest, lifetime.signal).finally(() => {
                authorizing = undefined;
            });
        }
        return authorizing;
    };
    const receive = (event: MessageEvent<unknown>) => {
        if (lifetime.signal.aborted || !navigator.onLine || event.origin !== location.origin || event.source !== managedProjectorWindow() || !event.data || typeof event.data !== 'object')
            return;
        const value = event.data as Record<string, unknown>;
        if (typeof value.nonce !== 'string' || !/^[a-f0-9-]{36}$/u.test(value.nonce))
            return;
        if (value.type === usedType) {
            const ack = acks.get(value.nonce);
            if (Object.keys(value).length === 3 && ack && ack.key === value.key && ack.until > Date.now()) {
                acks.delete(value.nonce);
                report('used');
            }
            return;
        }
        if (value.type !== requestType || Object.keys(value).length !== 4 || event.ports.length !== 1)
            return;
        const port = event.ports[0]!;
        for (const [nonce, until] of requests)
            if (until <= Date.now()) {
                requests.delete(nonce);
                acks.delete(nonce);
            }
        if ((value.mode !== 'bytes' && value.mode !== 'renew') || ports.size >= localImageBackupLimits.transfers || requests.has(value.nonce) || requests.size >= 32) {
            port.close();
            return;
        }
        let authority: LocalImageAuthority;
        try {
            authority = parseLocalImageAuthority(value.authority);
        }
        catch {
            port.close();
            return;
        }
        const asset = loaded.manifest.assets.find(asset => asset.reference === authority.media.reference), blob = loaded.images.get(authority.media.reference);
        if (!asset || !blob || authority.expiresAtMs <= Date.now() || authority.expiresAtMs>Date.now()+5000 || authority.sessionId !== state.sessionId || authority.revision !== state.revision || authority.slidePosition !== state.slidePosition
            || authority.mediaGeneration !== state.mediaGeneration || authority.eventId !== scope.eventId || authority.snapshotId !== scope.snapshotId
            || asset.generation !== authority.media.generation || asset.sha256 !== authority.media.sha256) {
            port.close();
            return;
        }
        const nonce = value.nonce, mode = value.mode;
        requests.set(nonce, authority.expiresAtMs);
        ports.add(port);
        const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(4000)]);
        void (async () => {
            await authorizeOperator();
            signal.throwIfAborted();
            const current = await readImageAuthority(state, authority.media.reference, authority.media.role, signal);
            if (imageAuthorityKey(current) !== imageAuthorityKey(authority))
                throw new Error('Obrázek se změnil.');
            const bytes = mode === 'bytes' ? await blob.arrayBuffer() : undefined;
            signal.throwIfAborted();
            if (authority.expiresAtMs <= Date.now() || event.source !== managedProjectorWindow())
                throw new Error('Potvrzení vypršelo.');
            if (bytes) {
                if (bytes.byteLength !== authority.media.size)
                    throw new Error('Neplatný obrázek.');
                acks.set(nonce, { key: imageAuthorityKey(authority), until: authority.expiresAtMs });
                port.postMessage({ nonce, key: imageAuthorityKey(authority), bytes }, [bytes]);
            }
            else
                port.postMessage({ nonce, key: imageAuthorityKey(authority) });
        })().catch(() => {
            if (!lifetime.signal.aborted)
                report('invalid');
        }).finally(() => {
            ports.delete(port);
            port.close();
        });
    };
    const stop = () => {
        lifetime.abort();
        ports.forEach(port => port.close());
        ports.clear();
        acks.clear();
    };
    window.addEventListener('message', receive);
    window.addEventListener('offline', stop);
    return () => {
        stop();
        window.removeEventListener('message', receive);
        window.removeEventListener('offline', stop);
    };
}
