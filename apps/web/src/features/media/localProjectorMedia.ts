import type { PublicLiveState } from '../live/types';
import { readPublicLiveStateFromServer } from '../live/liveRepository';
import { localMediaBackupSupported, readLocalProjectorMediaAuthority, type LocalProjectorMediaAuthority } from '../live/localMediaBackupAuthority';
import { requestLocalProjectorMedia } from '../live/localMediaBackupRelay';
import { quizMediaReadFailure, readQuizMediaBlob } from './mediaApi';
import type { ImageTiming } from '../presentation/mediaTiming';

export function localProjectorImageEligible(state: PublicLiveState, reference: string): boolean {
  return localMediaBackupSupported() && window.opener !== null && state.status === 'active'
    && state.renderMode === 'question' && state.presentationMode === 'slide' && state.slideKind === 'image'
    && state.questionImage === reference && !state.answerRevealed && state.revealedAnswer === undefined
    && !state.interimResults && !state.finalReveal && !state.interimBackdrop && !state.showCue;
}

function sameState(expected: PublicLiveState, actual: PublicLiveState | null): boolean {
  return actual !== null && actual.sessionId === expected.sessionId && actual.revision === expected.revision
    && actual.slidePosition === expected.slidePosition && actual.mediaGeneration === expected.mediaGeneration
    && actual.questionImage === expected.questionImage && actual.status === 'active'
    && actual.renderMode === 'question' && actual.presentationMode === 'slide' && !actual.answerRevealed;
}

function binding(authority: LocalProjectorMediaAuthority): string {
  return JSON.stringify([authority.schemaVersion, authority.sessionId, authority.revision, authority.slidePosition,
    authority.mediaGeneration, authority.eventId, authority.snapshotId, authority.quizRevision,
    authority.validUntilMs, authority.media]);
}

async function freshAuthority(state: PublicLiveState, reference: string, signal: AbortSignal) {
  signal.throwIfAborted();
  if (!navigator.onLine || !localProjectorImageEligible(state, reference)) throw new Error('Local media unavailable.');
  const current = await readPublicLiveStateFromServer(state.sessionId);
  signal.throwIfAborted();
  if (!sameState(state, current)) throw new Error('Projector authority changed.');
  const authority = await readLocalProjectorMediaAuthority(state, reference, signal);
  signal.throwIfAborted();
  if (authority.sessionId !== state.sessionId || authority.revision !== state.revision
    || authority.slidePosition !== state.slidePosition || authority.mediaGeneration !== state.mediaGeneration
    || authority.media.reference !== reference || authority.media.role !== 'question-image'
    || authority.expiresAtMs <= Date.now() || authority.expiresAtMs > Date.now() + 5_000
    || authority.validUntilMs <= Date.now()) throw new Error('Local media authority expired.');
  return authority;
}

async function verifyBytes(blob: Blob, authority: LocalProjectorMediaAuthority, signal: AbortSignal) {
  if (blob.type !== 'image/png' || blob.size !== authority.media.size || blob.size > 1024 * 1024) throw new Error('Invalid local image.');
  const bytes = await blob.arrayBuffer();
  const signature = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 8));
  if (![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => signature[index] === byte)) throw new Error('Invalid local image.');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  signal.throwIfAborted();
  if (Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('') !== authority.media.sha256) throw new Error('Invalid local image.');
}

/** Local bytes bypass the shared media cache and keep a short, actively renewed authority lease. */
export function watchProjectorQuestionImage(options: {
  state: PublicLiveState; reference: string; signal: AbortSignal;
  onImage: (blob: Blob, source: 'online' | 'local', authority?: LocalProjectorMediaAuthority) => void;
  onFailure: (error: unknown) => void;
  onTiming?: ((stage: ImageTiming) => void) | undefined;
}): void {
  const { state, reference, signal, onImage, onFailure, onTiming } = options;
  const gateway = new AbortController(), local = new AbortController();
  let selected: 'online' | 'local' | undefined;
  let terminal = false, started = false, gatewayFailed = false;
  let localFailure: unknown;
  let renewTimer: number | undefined, expiryTimer: number | undefined;
  const stopLocal = () => { local.abort(); window.clearTimeout(renewTimer); window.clearTimeout(expiryTimer); };
  const fail = (error: unknown) => {
    if (signal.aborted || terminal) return;
    terminal = true; stopLocal(); onFailure(error);
  };
  const localSignal = AbortSignal.any([signal, local.signal]);
  const lease = (authority: LocalProjectorMediaAuthority) => {
    window.clearTimeout(expiryTimer);
    const remaining = Math.min(authority.expiresAtMs, authority.validUntilMs) - Date.now();
    if (remaining <= 0) { fail(new Error('Local authority expired.')); return; }
    expiryTimer = window.setTimeout(() => fail(new Error('Local authority expired.')), remaining);
    renewTimer = window.setTimeout(() => {
      void (async () => {
        const bounded = AbortSignal.any([localSignal, AbortSignal.timeout(Math.min(remaining, 2000))]);
        const current = await freshAuthority(state, reference, bounded);
        if (binding(current) !== binding(authority)) throw new Error('Local authority changed.');
        // A public lease alone cannot preserve an operator-backed local source after logout/revocation.
        const blob = await requestLocalProjectorMedia(current, bounded);
        await verifyBytes(blob, current, bounded);
        const confirmed = await freshAuthority(state, reference, bounded);
        bounded.throwIfAborted();
        if (binding(confirmed) !== binding(authority) || current.expiresAtMs <= Date.now()) throw new Error('Local authority changed.');
        if (!terminal) lease(confirmed);
      })().catch((error: unknown) => { if (!localSignal.aborted) fail(error); });
    }, Math.min(2000, Math.max(1, remaining / 2)));
  };
  const startLocal = () => {
    if (started || terminal || selected || signal.aborted) return;
    started = true;
    void (async () => {
      const bounded = AbortSignal.any([localSignal, AbortSignal.timeout(5_000)]);
      const first = await freshAuthority(state, reference, bounded);
      const blob = await requestLocalProjectorMedia(first, bounded);
      await verifyBytes(blob, first, bounded);
      const second = await freshAuthority(state, reference, bounded);
      bounded.throwIfAborted();
      if (binding(first) !== binding(second)) throw new Error('Local authority changed.');
      if (first.expiresAtMs <= Date.now()) throw new Error('Local authority expired.');
      if (terminal || selected) return;
      selected = 'local'; onImage(blob, 'local', second); lease(second);
    })().catch((error: unknown) => {
      if (signal.aborted || local.signal.aborted || selected === 'online') return;
      localFailure = error;
      if (gatewayFailed) fail(error);
    });
  };
  const slow = window.setTimeout(startLocal, 1500);
  const timeout = window.setTimeout(() => {
    gateway.abort();
    if (!selected) fail(new Error('Media request timed out.'));
  }, 15_000);
  signal.addEventListener('abort', () => {
    gateway.abort(); stopLocal(); window.clearTimeout(slow); window.clearTimeout(timeout);
  }, { once: true });
  void readQuizMediaBlob(reference, AbortSignal.any([signal, gateway.signal]), state.sessionId, undefined, onTiming)
    .then(blob => {
      window.clearTimeout(slow); window.clearTimeout(timeout);
      if (signal.aborted || terminal || selected === 'local') return;
      selected = 'online'; stopLocal(); onImage(blob, 'online');
    }).catch((error: unknown) => {
      window.clearTimeout(slow);
      if (signal.aborted || gateway.signal.aborted) return;
      const reason = quizMediaReadFailure(error);
      if (navigator.onLine && ['network-error', 'gateway-unavailable'].includes(reason)) {
        gatewayFailed = true;
        if (localFailure) fail(localFailure); else startLocal();
      } else fail(error); // Includes denial, ambiguous 404, malformed bytes and unknown errors.
    });
}
