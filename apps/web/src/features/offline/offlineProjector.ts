import type { PublicLiveState } from '../live/types';
import { parsePublicLiveState } from '../live/projectorChannel';
import { offlineProjectionReferences } from './offlineProjection';
import type { OfflineRuntime } from './offlineRuntime';
const hello = 'justkviz-offline-projector-hello-v1';
export interface OfflineProjectorConnection {
    publish(state: PublicLiveState): void;
    close(): void;
}
export function openOfflineProjector(runtime: OfflineRuntime, current: () => PublicLiveState): OfflineProjectorConnection {
    if (runtime.playBlock) throw new Error(runtime.playBlock);
    const popup = window.open(`/offline.html#/projector/${encodeURIComponent(runtime.manifest.sessionId)}`, `justkviz-offline-${runtime.manifest.sessionId}`, 'popup=yes');
    if (!popup) {
        throw new Error('Prohlížeč zablokoval projektor. Povolte otevírání oken.');
    }
    let port: MessagePort | undefined, closed = false, transfers = 0, serial = 0;
    const publish = (state: PublicLiveState) => {
        if (!closed && !runtime.playBlock) {
            port?.postMessage({ type: 'state', serial: ++serial, state, expiresAtMs: runtime.manifest.expiresAtMs });
        }
    };
    const connect = (event: MessageEvent<unknown>) => {
        if (closed || runtime.playBlock || event.source !== popup || event.origin !== location.origin || !event.data || typeof event.data !== 'object') {
            return;
        }
        const request = event.data as Record<string, unknown>;
        if (request.type !== hello || request.sessionId !== runtime.manifest.sessionId || event.ports.length !== 1) {
            return;
        }
        port?.close();
        port = event.ports[0]!;
        port.onmessage = ({ data }: MessageEvent<unknown>) => {
            if (!data || typeof data !== 'object' || closed || runtime.playBlock) {
                return;
            }
            const message = data as Record<string, unknown>;
            if (message.type === 'finished') {
                const latest = current();
                if (latest.status === 'active' && latest.mediaGeneration === message.mediaGeneration && ['play', 'replay'].includes(latest.mediaCommand)) {
                    void runtime.append({ type: 'media', payload: { command: 'finished' } }).catch(() => {
                    });
                }
                return;
            }
            if (message.type === 'ready') {
                publish(current());
                return;
            }
            if (message.type !== 'asset' || typeof message.reference !== 'string' || typeof message.requestId !== 'string' || message.requestId.length > 100 || transfers >= 4) {
                return;
            }
            const state = current();
            if (message.sessionId !== state.sessionId || message.mediaGeneration !== state.mediaGeneration || !offlineProjectionReferences(state).includes(message.reference)) {
                return;
            }
            transfers++;
            const generation = state.mediaGeneration, reference = message.reference, requestId = message.requestId, activePort = port;
            void runtime.asset(reference).then(async (blob) => {
                const latest = current();
                if (closed || activePort !== port || latest.mediaGeneration !== generation || !offlineProjectionReferences(latest).includes(reference) || runtime.playBlock) {
                    return;
                }
                const bytes = await blob.arrayBuffer();
                if (closed || activePort !== port || current().mediaGeneration !== generation || !offlineProjectionReferences(current()).includes(reference) || runtime.playBlock) {
                    return;
                }
                activePort?.postMessage({ type: 'asset', requestId, reference, mediaGeneration: generation, contentType: blob.type, bytes }, [bytes]);
            }).catch(() => {
                activePort?.postMessage({ type: 'asset-error', requestId });
            }).finally(() => {
                transfers--;
            });
        };
        port.start();
        publish(current());
    };
    window.addEventListener('message', connect);
    popup.focus();
    return { publish, close() {
            closed = true;
            port?.postMessage({ type: 'closed' });
            port?.close();
            window.removeEventListener('message', connect);
        } };
}
export function connectOfflineProjector(sessionId: string, onState: (state: PublicLiveState | null, expiresAtMs: number) => void): {
    resolve: (reference: string, signal: AbortSignal) => Promise<Blob>;
    finished: (generation: number) => void;
    close: () => void;
} {
    const opener = window.opener as Window | null;
    if (!opener || opener.closed) {
        throw new Error('Projektor otevřete z odemčeného offline moderování.');
    }
    const channel = new MessageChannel();
    let closed = false, serial = -1, current: PublicLiveState | null = null, expiresAtMs = 0, lastMessage = Date.now();
    const pending = new Map<string, {
        reference: string;
        generation: number;
        resolve: (blob: Blob) => void;
        reject: (error: Error) => void;
        cleanup: () => void;
    }>();
    const cancel = () => {
        for (const item of pending.values()) {
            item.cleanup();
            item.reject(new Error('Stav projektoru se změnil.'));
        }
        pending.clear();
    };
    channel.port1.onmessage = ({ data }: MessageEvent<unknown>) => {
        if (closed || !data || typeof data !== 'object') {
            return;
        }
        const message = data as Record<string, unknown>;
        lastMessage = Date.now();
        if (message.type === 'closed') {
            current = null;
            cancel();
            onState(null, 0);
            return;
        }
        if (message.type === 'state') {
            const state = parsePublicLiveState(message.state);
            if (!state || state.sessionId !== sessionId || !Number.isSafeInteger(message.serial) || (message.serial as number) <= serial || !Number.isSafeInteger(message.expiresAtMs)) {
                return;
            }
            if (current && state.revision < current.revision) {
                return;
            }
            serial = message.serial as number;
            if (current?.mediaGeneration !== state.mediaGeneration) {
                cancel();
            }
            current = state;
            expiresAtMs = message.expiresAtMs as number;
            onState(Date.now() <= expiresAtMs ? state : null, expiresAtMs);
            return;
        }
        if (typeof message.requestId !== 'string') {
            return;
        }
        const request = pending.get(message.requestId);
        if (!request) {
            return;
        }
        request.cleanup();
        pending.delete(message.requestId);
        if (message.type === 'asset' && message.reference === request.reference && message.mediaGeneration === request.generation && current?.mediaGeneration === request.generation
            && offlineProjectionReferences(current).includes(request.reference) && message.bytes instanceof ArrayBuffer && message.bytes.byteLength <= 25 * 1024 * 1024 && typeof message.contentType === 'string' && Date.now() <= expiresAtMs) {
            request.resolve(new Blob([message.bytes], { type: message.contentType }));
        }
        else {
            request.reject(new Error('Médium není dostupné pro aktuální otázku.'));
        }
    };
    channel.port1.start();
    opener.postMessage({ type: hello, sessionId }, location.origin, [channel.port2]);
    channel.port1.postMessage({ type: 'ready' });
    const health = window.setInterval(() => {
        if (opener.closed || Date.now() > expiresAtMs && expiresAtMs > 0 || Date.now() - lastMessage > 10000) {
            current = null;
            cancel();
            onState(null, expiresAtMs);
        }
        else {
            channel.port1.postMessage({ type: 'ready' });
        }
    }, 2000);
    return { resolve(reference, signal) {
            if (closed || !current || pending.size >= 4 || !offlineProjectionReferences(current).includes(reference) || Date.now() > expiresAtMs) {
                return Promise.reject(new Error('Médium není zveřejněné.'));
            }
            const requestId = crypto.randomUUID(), generation = current.mediaGeneration;
            return new Promise((resolve, reject) => {
                const abort = () => {
                    const item = pending.get(requestId);
                    if (item) {
                        item.cleanup();
                        pending.delete(requestId);
                        reject(new Error('Načítání bylo zrušeno.'));
                    }
                };
                const timer = window.setTimeout(abort, 15000);
                const cleanup = () => {
                    window.clearTimeout(timer);
                    signal.removeEventListener('abort', abort);
                };
                pending.set(requestId, { reference, generation, resolve, reject, cleanup });
                signal.addEventListener('abort', abort, { once: true });
                if (signal.aborted) {
                    abort();
                    return;
                }
                channel.port1.postMessage({ type: 'asset', requestId, reference, mediaGeneration: generation, sessionId });
            });
        }, finished(generation) {
            if (!closed && current?.mediaGeneration === generation) {
                channel.port1.postMessage({ type: 'finished', mediaGeneration: generation });
            }
        }, close() {
            closed = true;
            cancel();
            window.clearInterval(health);
            channel.port1.close();
            channel.port2.close();
        } };
}
