import { accessActor, securedOnCall, runAccessTransaction, currentMembership } from '../access/authorization.js';
import { getFirestore, Timestamp, type Transaction } from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { authorizeStaff, parseSession, loadSlide } from '../live/callables.js';
import { buildPublicSessionState, publicResultTemplate } from '../live/publication.js';
import { applyLiveSessionAction } from '../live/session-machine.js';
import type { PrivateLiveSession } from '../live/types.js';
import { calculateResults, calculateFinalResults, calculateCurrentResults, fingerprint } from './model.js';
import { normalizeResultPagination, resultPagination, type PublicResultRow, type ShowCue } from '@filmovy-kviz/quiz-domain';
import { attachResultMovement, captureInterimReturn, makeShowCue, restoreInterimReturn, staticInterimBackdrop } from '../live/show-mode.js';
import type { PrivateSlide } from '../live/types.js';
const options = { region: 'europe-west1', cors: true, maxInstances: 10 };
const db = () => getFirestore();
export function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new HttpsError('invalid-argument', 'Neplatný požadavek.');
    return value as Record<string, unknown>;
}
export function id(data: Record<string, unknown>, key: string): string {
    const value = data[key];
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,150}$/u.test(value))
        throw new HttpsError('invalid-argument', 'Neplatný identifikátor.');
    return value;
}
export function revision(data: Record<string, unknown>): number {
    if (!Number.isSafeInteger(data.expectedRevision) || (data.expectedRevision as number) < 0)
        throw new HttpsError('invalid-argument', 'Neplatná revize.');
    return data.expectedRevision as number;
}
export function staff(request: CallableRequest) {
    return Promise.resolve(accessActor(request.auth).uid);
}
async function eventIn(tx: Transaction, eventId: string) {
    const event = (await tx.get(db().doc('events/' + eventId))).data();
    if (!event || !['ready', 'live', 'finalizing'].includes(event.lifecycleStatus as string))
        throw new HttpsError('failed-precondition', 'Akce není dostupná pro moderování.');
    return event;
}
export async function bound(tx: Transaction, eventId: string, sessionId: string) {
    const event = await eventIn(tx, eventId);
    const session = parseSession(await tx.get(db().doc('sessions/' + sessionId)));
    if (session.eventId !== eventId || event.liveSessionId !== sessionId || session.snapshotId !== object(event.quizAssignment).snapshotId || session.status === 'ended')
        throw new HttpsError('failed-precondition', 'Akce a aktivní moderování neodpovídají.');
    return { event, session };
}
// One event-bound live session uses the existing presentation path and immutable source.
export const createEventLiveSession = securedOnCall('createEventLiveSession', options, async (request) => {
    const uid = authorizeStaff(request.auth).uid, data = object(request.data), eventId = id(data, 'eventId');
    const sessionRef = db().collection('sessions').doc();
    return runAccessTransaction(db(), async (tx) => {
        await staff(request);
        const event = await eventIn(tx, eventId);
        if (typeof event.liveSessionId === 'string') {
            const existing = parseSession(await tx.get(db().doc('sessions/' + event.liveSessionId)));
            if (existing.eventId !== eventId || existing.snapshotId !== object(event.quizAssignment).snapshotId)
                throw new HttpsError('failed-precondition', 'Vazba moderování se změnila.');
            if (existing.status !== 'ended') return { sessionId: existing.sessionId };
        }
        if (event.revision !== revision(data))
            throw new HttpsError('aborted', 'Akce se změnila.');
        const snapshotId = id(object(event.quizAssignment), 'snapshotId');
        const snapshot = (await tx.get(db().doc('quizSnapshots/' + snapshotId))).data();
        if (!snapshot || !Number.isSafeInteger(snapshot.slideCount) || (snapshot.slideCount as number) < 1)
            throw new HttpsError('failed-precondition', 'Připravený kvíz chybí.');
        const now = Timestamp.now();
        const session: PrivateLiveSession = {
            sessionId: sessionRef.id, eventId, snapshotId, quizId: String(object(event.quizAssignment).quizId), quizTitle: String(event.title), slideCount: snapshot.slideCount as number,
            status: 'waiting', currentSlidePosition: 0, answerRevealed: false, presentationMode: 'slide',
            mediaCommand: 'idle', mediaPlaybackState: 'idle', mediaGeneration: 0, introGeneration: 0, revision: 0,
            createdBy: uid, updatedBy: uid, createdAt: now, updatedAt: now, startedAt: null, endedAt: null,
        };
        tx.create(sessionRef, session);
        tx.create(db().doc('publicSessions/' + sessionRef.id), buildPublicSessionState(session));
        tx.update(db().doc('events/' + eventId), { liveSessionId: sessionRef.id, revision: (event.revision as number) + 1, updatedAt: now, updatedBy: uid });
        return { sessionId: sessionRef.id };
    });
});
export async function previewIn(tx: Transaction, eventId: string, sessionId: string, throughRoundId: string | null, scope: 'selected' | 'current' = 'selected') {
    const { session } = await bound(tx, eventId, sessionId);
    const rounds = await tx.get(db().collection(`quizSnapshots/${session.snapshotId}/rounds`));
    const teams = await tx.get(db().collection(`events/${eventId}/registrations`).where('status', '==', 'accepted'));
    const scores = await tx.get(db().collection(`events/${eventId}/scores`));
    const roundValues = rounds.docs.map(d => ({ id: d.id, title: String(d.data().title), position: Number(d.data().position) }));
    const teamValues = teams.docs.map(d => ({ id: d.id, name: String(d.data().teamName), revision: Number(d.data().revision ?? 0) }));
    const scoreValues = scores.docs.filter(d => d.data().snapshotId === session.snapshotId).map(d => ({ teamId: String(d.data().teamId), roundId: String(d.data().roundId), halfPoints: d.data().halfPoints as number | null, revision: Number(d.data().revision) }));
    const result = scope === 'current' ? calculateCurrentResults(roundValues, teamValues, scoreValues)
        : throughRoundId === null ? calculateFinalResults(roundValues, teamValues, scoreValues) : calculateResults(roundValues, throughRoundId, teamValues, scoreValues);
    return { session, result: { ...result, sourceFingerprint: fingerprint([eventId, session.snapshotId, result.sourceFingerprint]) } };
}
export const previewInterimResults = securedOnCall('previewInterimResults', options, async (request) => {
    const data = object(request.data);
    return runAccessTransaction(db(), async (tx) => {
        await staff(request);
        const { session, result } = await previewIn(tx, id(data, 'eventId'), id(data, 'sessionId'), id(data, 'throughRoundId'));
        return { ...result, sessionRevision: session.revision, publishedVersionId: session.interimResults?.versionId ?? null };
    });
});
function withoutResults(session: PrivateLiveSession): PrivateLiveSession {
    const { interimResults, showCue, ...clean } = session;
    void interimResults; void showCue;
    return clean;
}
export const controlInterimResults = securedOnCall('controlInterimResults', options, async (request) => {
    const uid = authorizeStaff(request.auth).uid, data = object(request.data);
    const eventId = id(data, 'eventId'), sessionId = id(data, 'sessionId'), requestId = id(data, 'requestId');
    const action = data.action;
    if (!['publish', 'current', 'hide', 'page', 'static'].includes(action as string))
        throw new HttpsError('invalid-argument', 'Neplatný příkaz výsledků.');
    const allowed = ['eventId', 'sessionId', 'requestId', 'expectedRevision', 'action', ...(action === 'publish' ? ['throughRoundId', 'sourceFingerprint', 'presentationStyle', 'motion'] : action === 'page' ? ['page'] : [])];
    if (Object.keys(data).some(k => !allowed.includes(k)))
        throw new HttpsError('invalid-argument', 'Nepovolená pole.');
    let requestedPagination;
    try { requestedPagination = resultPagination(action === 'current' ? 'show' : data.presentationStyle); }
    catch { throw new HttpsError('invalid-argument', 'Neplatný režim výsledků.'); }
    if (data.motion !== undefined && data.motion !== 'animate' && data.motion !== 'static') throw new HttpsError('invalid-argument', 'Neplatný pohyb.');
    const expected = revision(data), operationId = fingerprint([uid, sessionId, requestId]), commandFingerprint = fingerprint([eventId, sessionId, action, data.expectedRevision, data.throughRoundId ?? null, data.sourceFingerprint ?? null, data.page ?? null,
        ...(data.presentationStyle === undefined && data.motion === undefined ? [] : [data.presentationStyle ?? null, data.motion ?? null])]);
    const sessionRef = db().doc('sessions/' + sessionId), receiptRef = sessionRef.collection('interimOperations').doc(operationId);
    return runAccessTransaction(db(), async (tx) => {
        await staff(request);
        const { session, event } = await bound(tx, eventId, sessionId);
        const receipt = (await tx.get(receiptRef)).data();
        if (receipt) {
            if (receipt.fingerprint !== commandFingerprint)
                throw new HttpsError('already-exists', 'Request ID má jiný obsah.');
            const { showCue, ...old } = receipt.response as { sessionId: string; revision: number; showCue?: ShowCue }; void showCue;
            return { ...old, replayed: true };
        }
        if (session.revision !== expected)
            throw new HttpsError('aborted', 'Prezentace se změnila. Načtěte nový náhled.');
        if (session.status !== 'active')
            throw new HttpsError('failed-precondition', 'Nejprve spusťte prezentaci.');
        if (session.finalReveal?.visible)
            throw new HttpsError('failed-precondition', 'Nejprve skryjte finále.');
        const now = Timestamp.now();
        let updated: PrivateLiveSession;
        let publication: Record<string, unknown> | undefined;
        let rows: PublicResultRow[] = [];
        let restoreSlide: PrivateSlide | undefined;
        let returnRestored = true;
        if (action === 'publish' || action === 'current') {
            const { result } = await previewIn(tx, eventId, sessionId, action === 'current' ? null : id(data, 'throughRoundId'), action === 'current' ? 'current' : 'selected');
            if (action === 'publish' && !result.complete)
                throw new HttpsError('failed-precondition', 'Neúplné nebo prázdné výsledky nelze zveřejnit.');
            if (action === 'publish' && data.sourceFingerprint !== result.sourceFingerprint)
                throw new HttpsError('aborted', 'Náhled je zastaralý. Načtěte novou podobu.');
            const slide = await loadSlide(tx, session.quizId, session.currentSlidePosition, session.snapshotId);
            // Existing navigation lifecycle stops media, clears recap/reveal, preserves position.
            updated = applyLiveSessionAction(withoutResults(session), { type: 'go-to-slide', position: session.currentSlidePosition, slideId: slide.id }, expected, uid, now, slide);
            const previousId = session.interimResults?.versionId ?? session.lastInterimVersionId;
            const previous = previousId ? (await tx.get(sessionRef.collection('interimVersions').doc(previousId))).data() : undefined;
            const previousRanks = previous?.eventId === eventId && previous.sessionId === sessionId && previous.snapshotId === session.snapshotId ? previous.teamRanks as Record<string, number> | undefined : undefined;
            rows = requestedPagination.presentationStyle === 'show' ? attachResultMovement(result.rows, result.rowTeamIds, result.teamRanks, previousRanks) : result.rows;
            updated = { ...updated,
                ...(requestedPagination.presentationStyle === 'show' ? { interimReturn: session.interimReturn ?? captureInterimReturn(session, slide) } : {}),
                lastInterimVersionId: operationId,
                interimResults: { versionId: operationId, roundNumber: result.roundNumber, page: 0, pageCount: Math.ceil(rows.length / requestedPagination.pageSize), ...requestedPagination } };
            publication = { eventId, sessionId, snapshotId: session.snapshotId, sourceFingerprint: result.sourceFingerprint, includedRounds: result.includedRounds, rows,
                ...(action === 'current' ? { scope: 'current', complete: result.complete, expectedScoreCount: result.includedRounds.length * result.rows.length,
                    missingScoreCount: result.missing.length, presentScoreCount: result.includedRounds.length * result.rows.length - result.missing.length } : {}),
                teamRanks: result.teamRanks, rowTeamIds: result.rowTeamIds, ...requestedPagination, actorUid: uid, createdAt: now, versionId: operationId };
        }
        else if (action === 'page' || action === 'static') {
            if (!session.interimResults || (action === 'page' && (!Number.isSafeInteger(data.page) || (data.page as number) < 0 || (data.page as number) >= session.interimResults.pageCount)))
                throw new HttpsError('invalid-argument', 'Neplatná stránka výsledků.');
            const saved = (await tx.get(sessionRef.collection('interimVersions').doc(session.interimResults.versionId))).data();
            if (!saved || saved.eventId !== eventId || saved.sessionId !== sessionId || saved.snapshotId !== session.snapshotId)
                throw new HttpsError('failed-precondition', 'Verze výsledků chybí.');
            const savedPage = normalizeResultPagination(saved), pointerPage = normalizeResultPagination(session.interimResults);
            if (savedPage.pageSize !== pointerPage.pageSize || savedPage.presentationStyle !== pointerPage.presentationStyle || (action === 'static' && savedPage.presentationStyle !== 'show')) throw new HttpsError('failed-precondition', 'Formát potvrzené verze neodpovídá.');
            rows = saved.rows as PublicResultRow[];
            updated = { ...withoutResults(session), revision: expected + 1, updatedAt: now, updatedBy: uid, interimResults: { ...session.interimResults, page: action === 'page' ? data.page as number : session.interimResults.page } };
        }
        else {
            if (!session.interimResults)
                throw new HttpsError('failed-precondition', 'Výsledky nejsou zobrazené.');
            const slide = await loadSlide(tx, session.quizId, session.currentSlidePosition, session.snapshotId);
            let selected: PrivateSlide | undefined;
            const intent = session.interimReturn;
            const allowAnswers = currentMembership().permissions.includes('event.answers.read');
            if (intent && intent.snapshotId === session.snapshotId && intent.recapQuestionPosition !== undefined && allowAnswers) {
                try { selected = await loadSlide(tx, session.quizId, intent.recapQuestionPosition, session.snapshotId); }
                catch { /* A missing old selection must never restore stale answer content. */ }
            }
            const restored = restoreInterimReturn(session, slide, selected, allowAnswers, uid, now);
            updated = restored.session; restoreSlide = restored.slide; returnRestored = restored.restored;
        }
        const pageConfig = updated.interimResults ? normalizeResultPagination(updated.interimResults) : undefined;
        const backdrop = action !== 'hide' && pageConfig?.presentationStyle === 'show' ? staticInterimBackdrop(updated, await loadSlide(tx, session.quizId, updated.currentSlidePosition, session.snapshotId)) : undefined;
        const cue = action !== 'hide' && pageConfig?.presentationStyle === 'show' ? makeShowCue(operationId, 'interim', event.showPreferences, now.toMillis(), action === 'publish' || action === 'current' ? data.motion : 'static') : undefined;
        if (cue) updated = { ...updated, showCue: cue };
        const template = action === 'hide' ? {} : publicResultTemplate((await tx.get(db().doc('quizSnapshots/' + session.snapshotId))).data() ?? {}, 'interim');
        const publicState = action === 'hide' ? buildPublicSessionState(updated, restoreSlide) : {
            ...buildPublicSessionState({ ...updated, status: 'waiting', answerRevealed: false, presentationMode: 'slide' }), status: 'active',
            ...template,
            ...(backdrop ? { interimBackdrop: backdrop } : {}), ...(cue ? { showCue: cue } : {}),
            interimResults: { versionId: updated.interimResults!.versionId, roundNumber: updated.interimResults!.roundNumber, page: updated.interimResults!.page, pageCount: updated.interimResults!.pageCount,
                ...(pageConfig!.presentationStyle === 'show' ? { presentationStyle: 'show', pageSize: 6 } : {}),
                rows: rows.slice(updated.interimResults!.page * pageConfig!.pageSize, (updated.interimResults!.page + 1) * pageConfig!.pageSize).map(r => ({ rank: r.rank, teamName: r.teamName, halfPoints: r.halfPoints,
                ...(pageConfig!.presentationStyle === 'show' && Number.isSafeInteger(r.movement) ? { movement: r.movement } : {}) })) },
        };
        const response = { sessionId, revision: updated.revision, replayed: false, ...(cue ? { showCue: cue } : {}), ...(action === 'hide' ? { returnRestored } : {}) };
        if (publication)
            tx.create(sessionRef.collection('interimVersions').doc(operationId), publication);
        tx.set(sessionRef, updated);
        tx.set(db().doc('publicSessions/' + sessionId), publicState);
        tx.create(receiptRef, { fingerprint: commandFingerprint, response, actorUid: uid, createdAt: now, eventId, action });
        return response;
    });
});
