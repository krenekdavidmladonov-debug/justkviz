import type { PublicLiveState } from '../live/types';
import { readPublicLiveStateFromServer } from '../live/liveRepository';
import { localMediaBackupSupported } from '../live/localMediaBackupAuthority';
import { type LocalImageAuthority as LocalProjectorMediaAuthority, type LocalImageRole, localImageBackupLimits } from '@filmovy-kviz/quiz-domain';
import { readImageAuthority, requestLocalImage, renewLocalImage } from '../live/localImageRelay';
import { verifyImageBlob } from '../events/localImageBackup';
import { buildSlideRenderModel } from '../presentation/model';
import { quizMediaReadFailure, readQuizMediaBlob } from './mediaApi';
import type { ImageTiming } from '../presentation/mediaTiming';
export function localImageEligible(state: PublicLiveState, reference: string, role: LocalImageRole): boolean {
    return localMediaBackupSupported() && window.opener !== null && state.status === 'active'
        && new URLSearchParams(location.search).get('imageBackup') === '3'
        && visibleSource(state, role) === reference && !state.interimResults && !state.finalReveal && !state.interimBackdrop && !state.showCue;
}
function visibleSource(state: PublicLiveState, role: LocalImageRole): string | undefined {
    if (state.presentationMode === 'recap' && (!state.answerRevealed || state.recapQuestionPosition === undefined))
        return undefined;
    const model = buildSlideRenderModel({ kind: state.slideKind ?? 'legacy', title: state.title ?? '', text: state.text ?? '', options: state.options, media: state.media, presentation: state.presentation,
        design: state.design, backgroundImage: state.backgroundImage, questionImage: state.questionImage, answerImage: state.answerImage, revealedAnswer: state.revealedAnswer }, state.renderMode);
    if (role === 'question-image')
        return model.contentKind === 'image' ? model.questionImage : undefined;
    if (role === 'background-image')
        return model.backgroundImage;
    if (role === 'logo-image')
        return model.design.showLogo !== false ? model.design.logoImage : undefined;
    return state.answerRevealed && state.renderMode === 'recap' && state.revealedAnswer !== undefined ? model.answerImage : undefined;
}
function sameState(expected: PublicLiveState, actual: PublicLiveState | null): boolean {
    return actual !== null && actual.sessionId === expected.sessionId && actual.revision === expected.revision
        && actual.slidePosition === expected.slidePosition && actual.mediaGeneration === expected.mediaGeneration
        && actual.status === 'active' && actual.renderMode === expected.renderMode && actual.presentationMode === expected.presentationMode
        && actual.answerRevealed === expected.answerRevealed && actual.recapQuestionPosition === expected.recapQuestionPosition;
}
function binding(authority: LocalProjectorMediaAuthority): string {
    return JSON.stringify([authority.schemaVersion, authority.sessionId, authority.revision, authority.slidePosition,
        authority.mediaGeneration, authority.eventId, authority.snapshotId, authority.quizRevision,
        authority.validUntilMs, authority.media]);
}
async function freshAuthority(state: PublicLiveState, reference: string, signal: AbortSignal, role: LocalImageRole) {
    signal.throwIfAborted();
    if (!navigator.onLine || !localImageEligible(state, reference, role))
        throw new Error('Local media unavailable.');
    const current = await readPublicLiveStateFromServer(state.sessionId);
    signal.throwIfAborted();
    if (!sameState(state, current) || !current || visibleSource(current, role) !== reference)
        throw new Error('Projector authority changed.');
    const authority = await readImageAuthority(state, reference, role, signal);
    signal.throwIfAborted();
    if (authority.sessionId !== state.sessionId || authority.revision !== state.revision
        || authority.slidePosition !== state.slidePosition || authority.mediaGeneration !== state.mediaGeneration
        || authority.media.reference !== reference || authority.media.role !== role
        || authority.expiresAtMs <= Date.now() || authority.expiresAtMs > Date.now() + 5000
        || authority.validUntilMs <= Date.now())
        throw new Error('Local media authority expired.');
    return authority;
}
async function verifyBytes(blob: Blob, authority: LocalProjectorMediaAuthority, signal: AbortSignal) {
    await verifyImageBlob(blob, authority.media, signal, false);
}
const activeImages = new Map<symbol, {
    epoch: string;
    reference: string;
    pixels: number;
}>();
function reserve(state: PublicLiveState, authority: LocalProjectorMediaAuthority): () => void {
    const epoch = JSON.stringify([state.sessionId, state.revision, state.slidePosition, state.mediaGeneration]);
    const current = [...activeImages.values()].filter(entry => entry.epoch === epoch);
    if (current.length >= 4 || current.reduce((sum, entry) => sum + entry.pixels, authority.media.width * authority.media.height) > localImageBackupLimits.framePixels)
        throw new Error('Překročený rozpočet obrázků.');
    const key = Symbol();
    activeImages.set(key, { epoch, reference: authority.media.reference, pixels: authority.media.width * authority.media.height });
    return () => {
        activeImages.delete(key);
    };
}
/** Local bytes bypass the shared media cache and keep a short, actively renewed authority lease. */
export function watchProjectorImage(options: {
    state: PublicLiveState;
    reference: string;
    role: LocalImageRole;
    signal: AbortSignal;
    onImage: (blob: Blob, source: 'online' | 'local', authority?: LocalProjectorMediaAuthority) => void;
    onFailure: (error: unknown) => void;
    onTiming?: ((stage: ImageTiming) => void) | undefined;
}): void {
    const { state, reference, role, signal, onImage, onFailure, onTiming } = options;
    const gateway = new AbortController(), local = new AbortController();
    let selected: 'online' | 'local' | undefined;
    let terminal = false, started = false, gatewayFailed = false;
    let localFailure: unknown;
    let release: (() => void) | undefined;
    let renewTimer: number | undefined, expiryTimer: number | undefined;
    const stopLocal = () => {
        local.abort();
        release?.();
        release = undefined;
        window.clearTimeout(renewTimer);
        window.clearTimeout(expiryTimer);
    };
    const fail = (error: unknown) => {
        if (signal.aborted || terminal)
            return;
        terminal = true;
        stopLocal();
        onFailure(error);
    };
    const localSignal = AbortSignal.any([signal, local.signal]);
    const lease = (authority: LocalProjectorMediaAuthority) => {
        window.clearTimeout(expiryTimer);
        const remaining = Math.min(authority.expiresAtMs, authority.validUntilMs) - Date.now();
        if (remaining <= 0) {
            fail(new Error('Local authority expired.'));
            return;
        }
        expiryTimer = window.setTimeout(() => fail(new Error('Local authority expired.')), remaining);
        renewTimer = window.setTimeout(() => {
            void (async () => {
                const bounded = AbortSignal.any([localSignal, AbortSignal.timeout(Math.min(remaining, 2000))]);
                const current = await freshAuthority(state, reference, bounded, role);
                if (binding(current) !== binding(authority))
                    throw new Error('Local authority changed.');
                // A public lease alone cannot preserve an operator-backed local source after logout/revocation.
                await renewLocalImage(current, bounded);
                const confirmed = await freshAuthority(state, reference, bounded, role);
                bounded.throwIfAborted();
                if (binding(confirmed) !== binding(authority) || current.expiresAtMs <= Date.now())
                    throw new Error('Local authority changed.');
                if (!terminal)
                    lease(confirmed);
            })().catch((error: unknown) => {
                if (!localSignal.aborted)
                    fail(error);
            });
        }, Math.min(2000, Math.max(1, remaining / 2)));
    };
    const startLocal = () => {
        if (started || terminal || selected || signal.aborted)
            return;
        started = true;
        void (async () => {
            // Cold public and operator workers can start sequentially; each issued authority still expires after five seconds.
            const bounded = AbortSignal.any([localSignal, AbortSignal.timeout(10000)]);
            const first = await freshAuthority(state, reference, bounded, role);
            const blob = await requestLocalImage(first, bounded);
            await verifyBytes(blob, first, bounded);
            const second = await freshAuthority(state, reference, bounded, role);
            bounded.throwIfAborted();
            if (binding(first) !== binding(second))
                throw new Error('Local authority changed.');
            if (first.expiresAtMs <= Date.now())
                throw new Error('Local authority expired.');
            if (terminal || selected)
                return;
            release = reserve(state, second);
            selected = 'local';
            onImage(blob, 'local', second);
            lease(second);
        })().catch((error: unknown) => {
            if (signal.aborted || local.signal.aborted || selected === 'online')
                return;
            localFailure = error;
            if (gatewayFailed)
                fail(error);
        });
    };
    const slow = window.setTimeout(startLocal, 1500);
    const timeout = window.setTimeout(() => {
        gateway.abort();
        if (!selected)
            fail(new Error('Media request timed out.'));
    }, 15000);
    signal.addEventListener('abort', () => {
        gateway.abort();
        stopLocal();
        window.clearTimeout(slow);
        window.clearTimeout(timeout);
    }, { once: true });
    void readQuizMediaBlob(reference, AbortSignal.any([signal, gateway.signal]), state.sessionId, undefined, onTiming)
        .then(blob => {
        window.clearTimeout(slow);
        window.clearTimeout(timeout);
        if (signal.aborted || terminal || selected === 'local')
            return;
        selected = 'online';
        stopLocal();
        onImage(blob, 'online');
    }).catch((error: unknown) => {
        window.clearTimeout(slow);
        if (signal.aborted || gateway.signal.aborted)
            return;
        const reason = quizMediaReadFailure(error);
        if (navigator.onLine && ['network-error', 'gateway-unavailable'].includes(reason)) {
            gatewayFailed = true;
            if (localFailure)
                fail(localFailure);
            else
                startLocal();
        }
        else
            fail(error); // Includes denial, ambiguous 404, malformed bytes and unknown errors.
    });
}
