import { sameLocalEventMediaManifest } from '../events/localEventMediaApi';
import type { LocalEventMediaManifest } from '../events/localEventMediaBackupFile';
import {
  localMediaBackupSupported, parseLocalProjectorMediaAuthority, readLocalProjectorMediaAuthority,
  readOperatorLocalMediaManifest, type LocalMediaOperatorScope, type LocalProjectorMediaAuthority,
} from './localMediaBackupAuthority';
import { managedProjectorWindow } from './projectorWindow';
import type { PublicLiveState } from './types';

const requestType = 'justkviz-local-png-request-v1';
const usedType = 'justkviz-local-png-used-v1';
const noncePattern = /^[0-9a-f-]{36}$/u;
let received: { requestId: string; key: string } | undefined;

export function localMediaAuthorityKey(authority: LocalProjectorMediaAuthority): string {
  return JSON.stringify({ ...authority, expiresAtMs: 0 });
}

export function requestLocalProjectorMedia(authority: LocalProjectorMediaAuthority, signal: AbortSignal): Promise<Blob> {
  signal.throwIfAborted();
  const opener = window.opener as Window | null;
  if (!localMediaBackupSupported() || !opener || opener.closed) return Promise.reject(new Error('Podporovaný projektor není propojen.'));
  received = undefined;
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const requestId = crypto.randomUUID();
    let settled = false;
    const cleanup = () => {
      window.clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      channel.port1.close(); channel.port2.close();
    };
    const fail = () => {
      if (settled) return;
      settled = true; cleanup(); reject(new Error('Místní obrázek není dostupný.'));
    };
    const abort = () => { received = undefined; fail(); };
    const timeout = window.setTimeout(fail, Math.min(4_000, Math.max(1, authority.expiresAtMs - Date.now())));
    signal.addEventListener('abort', abort, { once: true });
    channel.port1.onmessage = ({ data }: MessageEvent<unknown>) => {
      if (settled || signal.aborted || Date.now() >= authority.expiresAtMs || !data || typeof data !== 'object') { fail(); return; }
      const message = data as Record<string, unknown>;
      if (Object.keys(message).length !== 3 || message.requestId !== requestId || message.key !== localMediaAuthorityKey(authority)
        || !(message.bytes instanceof ArrayBuffer) || message.bytes.byteLength !== 84) { fail(); return; }
      settled = true; cleanup();
      received = { requestId, key: message.key };
      resolve(new Blob([message.bytes], { type: 'image/png' }));
    };
    channel.port1.onmessageerror = fail;
    try {
      opener.postMessage({ type: requestType, requestId, authority }, window.location.origin, [channel.port2]);
    } catch { fail(); }
  });
}

export function notifyLocalProjectorMediaUsed(authority: LocalProjectorMediaAuthority): void {
  if (!received || received.key !== localMediaAuthorityKey(authority) || Date.now() >= authority.expiresAtMs) return;
  try {
    const opener = window.opener as Window | null;
    opener?.postMessage({ type: usedType, requestId: received.requestId, key: received.key }, window.location.origin);
  } catch { /* Source reporting cannot grant navigation or media access. */ }
  received = undefined;
}

export interface LoadedLocalMedia {
  readonly manifest: LocalEventMediaManifest;
  readonly bytes: Blob;
}

/** Only a pinned popup may request a single already-public prompt through its one-use port. */
export function serveLocalProjectorMedia(
  scope: LocalMediaOperatorScope,
  state: PublicLiveState,
  loaded: LoadedLocalMedia,
  report: (message: 'used' | 'invalid') => void,
): () => void {
  const lifetime = new AbortController();
  const ports = new Set<MessagePort>();
  const requests = new Map<string, number>();
  const acknowledgements = new Map<string, { key: string; expiresAtMs: number }>();
  let serving = false;
  const stop = () => {
    lifetime.abort(); ports.forEach(port => port.close()); ports.clear(); acknowledgements.clear();
  };
  const receive = (event: MessageEvent<unknown>) => {
    if (lifetime.signal.aborted || !localMediaBackupSupported() || !navigator.onLine || event.origin !== window.location.origin
      || event.source !== managedProjectorWindow() || !event.data || typeof event.data !== 'object') return;
    const message = event.data as Record<string, unknown>;
    if (typeof message.requestId !== 'string' || !noncePattern.test(message.requestId)) return;
    if (message.type === usedType) {
      const expected = acknowledgements.get(message.requestId);
      if (Object.keys(message).length === 3 && expected && expected.key === message.key && expected.expiresAtMs > Date.now()) {
        acknowledgements.delete(message.requestId); report('used');
      }
      return;
    }
    if (message.type !== requestType || Object.keys(message).length !== 3 || event.ports.length !== 1) return;
    const port = event.ports[0]!;
    for (const [nonce, expiresAt] of requests) {
      if (expiresAt <= Date.now()) { requests.delete(nonce); acknowledgements.delete(nonce); }
    }
    if (serving || requests.has(message.requestId) || requests.size >= 8) { port.close(); return; }
    let authority: LocalProjectorMediaAuthority;
    try { authority = parseLocalProjectorMediaAuthority(message.authority); } catch { port.close(); return; }
    if (authority.sessionId !== state.sessionId || authority.revision !== state.revision || authority.slidePosition !== state.slidePosition
      || authority.mediaGeneration !== state.mediaGeneration || authority.eventId !== scope.eventId || authority.snapshotId !== scope.snapshotId
      || authority.media.reference !== loaded.manifest.media?.reference || authority.media.generation !== loaded.manifest.media.generation
      || authority.media.sha256 !== loaded.manifest.media.sha256 || state.questionImage !== authority.media.reference) { port.close(); return; }
    requests.set(message.requestId, authority.expiresAtMs); ports.add(port); serving = true;
    const requestId = message.requestId;
    const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(4_000)]);
    void (async () => {
      const current = await readOperatorLocalMediaManifest(scope, signal, authority.media.reference);
      if (!sameLocalEventMediaManifest(loaded.manifest, current)) throw new Error('Záloha není platná.');
      const publicAuthority = await readLocalProjectorMediaAuthority(state, authority.media.reference, signal);
      if (localMediaAuthorityKey(publicAuthority) !== localMediaAuthorityKey(authority)) throw new Error('Snímek se změnil.');
      const bytes = await loaded.bytes.arrayBuffer();
      signal.throwIfAborted();
      if (bytes.byteLength !== 84 || Date.now() >= authority.expiresAtMs || event.source !== managedProjectorWindow()) throw new Error('Potvrzení vypršelo.');
      acknowledgements.set(requestId, { key: localMediaAuthorityKey(authority), expiresAtMs: authority.expiresAtMs });
      port.postMessage({ requestId, key: localMediaAuthorityKey(authority), bytes }, [bytes]);
    })().catch(() => { if (!lifetime.signal.aborted) report('invalid'); }).finally(() => {
      port.close(); ports.delete(port); serving = false;
    });
  };
  window.addEventListener('message', receive);
  window.addEventListener('offline', stop);
  return () => {
    stop(); window.removeEventListener('message', receive); window.removeEventListener('offline', stop);
  };
}
