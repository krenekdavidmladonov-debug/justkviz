import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { securedOnCall, runAccessTransaction } from '../access/authorization.js';
import { bound, id, object, previewIn, revision, staff } from '../leaderboard/callables.js';
import { fingerprint, type ResultRow } from '../leaderboard/model.js';
import { authorizeStaff, loadSlide } from '../live/callables.js';
import { applyLiveSessionAction } from '../live/session-machine.js';
import { buildPublicSessionState, publicResultTemplate } from '../live/publication.js';
import { advanceFinal, initialFinal, publicFinalPage, type FinalAction } from './model.js';
import { defaultShowPreferences, normalizeResultPagination, resultPagination, type ShowCue } from '@filmovy-kviz/quiz-domain';
import { makeShowCue } from '../live/show-mode.js';
const options = { region: 'europe-west1', cors: true, maxInstances: 10 };

export const previewFinalResults = securedOnCall('previewFinalResults', options, async request => {
  const data = object(request.data);
  if (Object.keys(data).some(k => !['eventId', 'sessionId'].includes(k))) throw new HttpsError('invalid-argument', 'Nepovolená pole.');
  return runAccessTransaction(getFirestore(), async tx => {
    await staff(request);
    const { session, result } = await previewIn(tx, id(data, 'eventId'), id(data, 'sessionId'), null);
    return { ...result, sessionRevision: session.revision, publishedVersionId: session.finalReveal?.versionId ?? null };
  });
});

interface FinalResponse { sessionId: string; versionId: string; revision: number; winnerRevealed: boolean; replayed: boolean; showCue?: ShowCue }
export const controlFinalReveal = securedOnCall('controlFinalReveal', options, async request => {
  const uid = authorizeStaff(request.auth).uid, data = object(request.data);
  const eventId = id(data, 'eventId'), sessionId = id(data, 'sessionId'), requestId = id(data, 'requestId');
  const action = data.action as FinalAction, expected = revision(data);
  if (!['start', 'replace', 'reveal', 'reveal-lower', 'hide', 'resume', 'page', 'history-page', 'table', 'static'].includes(action)) throw new HttpsError('invalid-argument', 'Neplatný příkaz finále.');
  const confirming = action === 'start' || action === 'replace';
  const animate = confirming || action === 'reveal' || action === 'reveal-lower';
  const allowed = ['eventId', 'sessionId', 'requestId', 'action', 'expectedRevision', 'versionId', ...(confirming ? ['sourceFingerprint', 'presentationStyle'] : ['page', 'history-page'].includes(action) ? ['page'] : []), ...(animate ? ['motion'] : [])];
  if (Object.keys(data).some(k => !allowed.includes(k)) || (data.versionId !== null && (typeof data.versionId !== 'string' || !/^[a-f0-9]{64}$/u.test(data.versionId)))) throw new HttpsError('invalid-argument', 'Neplatná verze nebo nepovolená pole.');
  if (confirming && (typeof data.sourceFingerprint !== 'string' || !/^[a-f0-9]{64}$/u.test(data.sourceFingerprint))) throw new HttpsError('invalid-argument', 'Chybí potvrzený náhled.');
  let requestedPagination;
  try { requestedPagination = resultPagination(data.presentationStyle); }
  catch { throw new HttpsError('invalid-argument', 'Neplatný režim výsledků.'); }
  if (data.motion !== undefined && data.motion !== 'animate' && data.motion !== 'static') throw new HttpsError('invalid-argument', 'Neplatný pohyb.');
  const db = getFirestore(), ref = db.doc('sessions/' + sessionId);
  const operationId = fingerprint([uid, sessionId, requestId]);
  const receiptRef = ref.collection('finalOperations').doc(operationId);
  const commandFingerprint = fingerprint([eventId, sessionId, action, expected, data.versionId, data.sourceFingerprint ?? null, data.page ?? null,
    ...(data.presentationStyle === undefined && data.motion === undefined ? [] : [data.presentationStyle ?? null, data.motion ?? null])]);
  return runAccessTransaction(db, async tx => {
    await staff(request); // Current role, including every transaction retry.
    const { session } = await bound(tx, eventId, sessionId);
    const receipt = (await tx.get(receiptRef)).data();
    if (receipt) {
      if (receipt.fingerprint !== commandFingerprint) throw new HttpsError('already-exists', 'Request ID má jiný obsah.');
      // Historical acknowledgment only: no replayed mutation or sound authorization.
      const { showCue, ...old } = receipt.response as FinalResponse; void showCue;
      return { ...old, replayed: true, winnerRevealed: false };
    }
    if (session.revision !== expected || (session.finalReveal?.versionId ?? null) !== data.versionId) throw new HttpsError('aborted', 'Verze nebo prezentace se změnila. Načtěte aktuální stav.');
    if (session.status !== 'active') throw new HttpsError('failed-precondition', 'Nejprve spusťte prezentaci.');
    const now = Timestamp.now();
    let publication: Record<string, unknown> | undefined;
    let rows: ResultRow[];
    let state;
    if (confirming) {
      if ((action === 'start') !== !session.finalReveal) throw new HttpsError('failed-precondition', 'Existující finále vyžaduje výslovné nahrazení.');
      const { result } = await previewIn(tx, eventId, sessionId, null);
      if (!result.complete) throw new HttpsError('failed-precondition', 'Neúplné nebo prázdné finále nelze zahájit.');
      if (result.sourceFingerprint !== data.sourceFingerprint) throw new HttpsError('aborted', 'Náhled je zastaralý. Načtěte nový a zkontrolujte jej.');
      rows = result.rows;
      state = initialFinal(operationId, rows, requestedPagination);
      publication = { eventId, sessionId, snapshotId: session.snapshotId, versionId: operationId, rows,
        ...requestedPagination, teamRanks: result.teamRanks, rowTeamIds: result.rowTeamIds,
        sourceFingerprint: result.sourceFingerprint, includedRounds: result.includedRounds, actorUid: uid, createdAt: now,
        replacesVersionId: session.finalReveal?.versionId ?? null };
    } else {
      if (!session.finalReveal) throw new HttpsError('failed-precondition', 'Finále ještě nebylo potvrzeno.');
      const saved = (await tx.get(ref.collection('finalVersions').doc(session.finalReveal.versionId))).data();
      if (!saved || saved.eventId !== eventId || saved.sessionId !== sessionId || saved.snapshotId !== session.snapshotId) throw new HttpsError('failed-precondition', 'Potvrzená verze chybí.');
      const savedPage = normalizeResultPagination(saved), pointerPage = normalizeResultPagination(session.finalReveal);
      if (savedPage.pageSize !== pointerPage.pageSize || savedPage.presentationStyle !== pointerPage.presentationStyle) throw new HttpsError('failed-precondition', 'Formát potvrzené verze neodpovídá.');
      rows = saved.rows as ResultRow[];
      state = advanceFinal(session.finalReveal, rows, action, data.page as number | undefined);
    }
    // Reset existing reveal/recap/media lifecycle on entry, hiding and resuming.
    const slide = await loadSlide(tx, session.quizId, session.currentSlidePosition, session.snapshotId);
    const { interimResults, interimReturn, showCue: oldCue, ...clean } = session; void interimResults; void interimReturn; void oldCue;
    const reset = confirming || action === 'hide' || action === 'resume';
    const show = normalizeResultPagination(state).presentationStyle === 'show';
    if (action === 'static' && !show) throw new HttpsError('failed-precondition', 'Klasické výsledky nemají show animaci.');
    const cueKind: ShowCue['kind'] = state.mode === 'intro' ? 'final-intro' : state.mode === 'lower' ? 'lower'
      : state.rank === 1 ? 'winners' : state.rank === 2 ? 'second' : state.rank === 3 ? 'third' : 'reveal';
    const cue = show && state.visible ? makeShowCue(operationId, cueKind, { ...defaultShowPreferences, motion: 'show' }, now.toMillis(), animate ? data.motion : 'static') : undefined;
    const updated = { ...(reset ? applyLiveSessionAction(clean, { type: 'go-to-slide', position: session.currentSlidePosition, slideId: slide.id }, expected, uid, now, slide)
      : { ...clean, revision: expected + 1, updatedBy: uid, updatedAt: now }), finalReveal: state };
    const finalUpdated = { ...updated, ...(cue ? { showCue: cue } : {}) };
    const publicState = state.visible ? {
      ...buildPublicSessionState({ ...updated, status: 'waiting', presentationMode: 'slide', answerRevealed: false }), status: 'active',
      ...publicResultTemplate((await tx.get(db.doc('quizSnapshots/' + session.snapshotId))).data() ?? {}, 'final'),
      finalReveal: publicFinalPage(state, rows),
      ...(cue ? { showCue: cue } : {}),
    } : buildPublicSessionState(updated, slide);
    const response: FinalResponse = { sessionId, versionId: state.versionId, revision: updated.revision, winnerRevealed: action === 'reveal' && state.rank === 1, replayed: false, ...(cue ? { showCue: cue } : {}) };
    if (publication) tx.create(ref.collection('finalVersions').doc(operationId), publication);
    tx.set(ref, finalUpdated);
    tx.set(db.doc('publicSessions/' + sessionId), publicState);
    tx.create(receiptRef, { fingerprint: commandFingerprint, response, actorUid: uid, createdAt: now, eventId, action, versionId: state.versionId });
    return response;
  });
});
