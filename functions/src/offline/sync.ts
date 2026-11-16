import { getFirestore, Timestamp, type Transaction } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { applyOfflineOperation, canonicalOfflineJson, eventDisposition, initialOfflineState, offlineEventLimits as limits,
  offlineOperationContent, parseOfflineManifest, parseOfflineOperations, parseQuizAsset,
  type OfflineEventManifest, type OfflineOperation, type OfflineScore, type OfflineState, type OfflineSyncConflict,
  type OfflineSyncPreview, type OfflineSyncReceipt, type OfflineSyncResolution } from '@filmovy-kviz/quiz-domain';
import { authorize, freshIdentity, type AuthIdentity } from '../access/authorization.js';
import { calculateFinalResults } from '../leaderboard/model.js';
import { buildPublicSessionState } from '../live/publication.js';
import { initialFinal } from '../final-reveal/model.js';
import { offlineDigest } from './signing.js';
import { exportAssets, exportMediaPins, pinnedMedia } from './prepare.js';
import { offlineCors, requireOfflineRuntime, type OfflineScope } from './activation.js';
import { assertOfflineExportContext, offlineId, offlineInput, offlinePermissions, offlineRecord, offlineSlides,
  offlineUnavailable, readOfflineSource, storedDigest } from './source.js';

const options = { region: 'europe-west1', cors: offlineCors, maxInstances: 2, concurrency: 1, timeoutSeconds: 120 };
interface ScoreHistory {
  operationId: string; sequence: number; observedAtMs: number; teamId: string; roundId: string;
  revision: number; previousHalfPoints: number | null; halfPoints: number | null; reason: string;
  resolutionChoice?: 'offline'; resolutionDigest?: string; serverResolution?: true;
}
function replay(manifest: OfflineEventManifest, operations: readonly OfflineOperation[]) {
  let state = initialOfflineState(manifest), previousTime = manifest.issuedAtMs;
  const history: ScoreHistory[] = [];
  for (const operation of operations) {
    const { hash, ...content } = operation;
    if (offlineDigest(offlineOperationContent(content)) !== hash || operation.observedAtMs < previousTime
      || operation.observedAtMs < manifest.issuedAtMs || operation.observedAtMs > manifest.expiresAtMs) throw new HttpsError('invalid-argument', 'Pořadí, čas nebo obsah uložené historie nesouhlasí.');
    if (operation.type === 'round-scores') {
      for (const change of operation.payload.changes) {
        const previous = state.scores.find(score => score.teamId === change.teamId && score.roundId === operation.payload.roundId);
        history.push({ operationId: operation.operationId, sequence: operation.sequence, observedAtMs: operation.observedAtMs,
          teamId: change.teamId, roundId: operation.payload.roundId, revision: (previous?.revision ?? 0) + 1,
          previousHalfPoints: previous?.halfPoints ?? null, halfPoints: change.halfPoints, reason: change.reason });
      }
    }
    try { state = applyOfflineOperation(manifest, state, operation); }
    catch { throw new HttpsError('invalid-argument', 'Uložený příkaz neodpovídá předchozímu průběhu kvízu.'); }
    previousTime = operation.observedAtMs;
  }
  if (history.length > limits.scoreMutations) throw offlineUnavailable();
  return { state, history };
}
function result(manifest: OfflineEventManifest, scores: readonly OfflineScore[]) {
  return calculateFinalResults([...manifest.rounds], [...manifest.teams], [...scores]);
}
function summary(manifest: OfflineEventManifest, state: OfflineState, changed: number, operations: number) {
  const final = result(manifest, state.scores);
  return { scoreChanges: changed, operationCount: operations, rows: final.rows, complete: final.complete && state.status === 'ended' };
}
async function storedManifest(tx: Transaction, record: Record<string, unknown>, eventId: string): Promise<OfflineEventManifest> {
  const seed = offlineRecord(record.manifestSeed), snapshotId = offlineId(record.snapshotId);
  const db = getFirestore(), ref = db.doc('quizSnapshots/' + snapshotId), snapshot = (await tx.get(ref)).data();
  if (!snapshot || snapshot.eventId !== eventId || snapshot.status !== 'ready') throw offlineUnavailable();
  const [slides, rounds] = await Promise.all([
    tx.get(ref.collection('slides').orderBy('position').limit(limits.slides + 1)),
    tx.get(ref.collection('rounds').orderBy('position').limit(limits.rounds + 1)),
  ]);
  if (slides.size !== snapshot.slideCount || slides.size > limits.slides || rounds.size !== snapshot.roundCount || rounds.size > limits.rounds) throw offlineUnavailable();
  const manifest = parseOfflineManifest(JSON.parse(canonicalOfflineJson({ ...seed, slides: offlineSlides(snapshot, slides.docs.map(row => ({ id: row.id, data: row.data() })), rounds.docs.map(row => ({ id: row.id, data: row.data() }))), assets: exportAssets(record) })) as unknown);
  if (manifest.event.id !== eventId || manifest.exportId !== record.exportId || manifest.snapshot.id !== snapshotId
    || offlineDigest(canonicalOfflineJson(manifest)) !== record.manifestDigest) throw offlineUnavailable();
  return manifest;
}

async function boundExport(tx: Transaction, auth: AuthIdentity, eventId: string, exportId: string, scope: OfflineScope) {
  const member = await authorize(auth, offlinePermissions, { kind: 'event', id: eventId }, tx), db = getFirestore();
  const [eventDoc, exportDoc] = await tx.getAll(db.doc('events/' + eventId), db.doc('events/' + eventId + '/offlineExports/' + exportId));
  const event = eventDoc!.data(), record = exportDoc!.data();
  if (!event || ['trash', 'deleting', 'archived'].includes(eventDisposition(event)) || !record || record.exportId !== exportId
    || record.actorId !== member.uid || record.membershipVersion !== member.version) throw new HttpsError('permission-denied', 'Původní offline oprávnění již neodpovídá aktuálnímu přístupu k akci. Data zůstala místně uložená.');
  assertOfflineExportContext(record, scope, eventId);
  return { member, event, record, exportRef: exportDoc!.ref };
}
function parseRequest(data: unknown, commit: boolean) {
  const input = offlineInput(data, ['eventId', 'exportId', 'operations', 'resolutions', 'completeRecovery', ...(commit ? ['previewDigest'] : [])]);
  const eventId = offlineId(input.eventId), exportId = offlineId(input.exportId);
  let operations: OfflineOperation[];
  try { operations = parseOfflineOperations(input.operations); }
  catch { throw new HttpsError('invalid-argument', 'Soubor průběhu je poškozený nebo překračuje podporované limity.'); }
  if (!operations.length) throw new HttpsError('failed-precondition', 'Offline průběh zatím nemá potvrzené operace.');
  if (commit && (typeof input.previewDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(input.previewDigest))) throw new HttpsError('invalid-argument', 'Nejdříve ověřte náhled synchronizace.');
  if (input.completeRecovery !== undefined && typeof input.completeRecovery !== 'boolean') throw offlineUnavailable();
  const completeRecovery = input.completeRecovery === true;
  if (input.resolutions !== undefined && (!Array.isArray(input.resolutions) || input.resolutions.length > limits.scoreCells)) throw offlineUnavailable();
  const resolutions: OfflineSyncResolution[] = (input.resolutions as unknown[] | undefined ?? []).map((value): OfflineSyncResolution => {
    const choice = offlineInput(value, ['teamId', 'roundId', 'choice', 'reason']);
    const teamId = offlineId(choice.teamId), roundId = offlineId(choice.roundId);
    if ((choice.choice !== 'online' && choice.choice !== 'offline') || typeof choice.reason !== 'string' || choice.reason.length > 300
      || /[\p{Cc}\p{Cf}]/u.test(choice.reason) || (choice.choice === 'offline' && !choice.reason.trim())) throw new HttpsError('invalid-argument', 'U nahrazení online bodů doplňte důvod rozhodnutí.');
    return { teamId, roundId, choice: choice.choice, reason: choice.reason };
  }).sort((a, b) => {
    const left = JSON.stringify([a.teamId, a.roundId]), right = JSON.stringify([b.teamId, b.roundId]); return left < right ? -1 : left > right ? 1 : 0;
  });
  if (new Set(resolutions.map(choice => JSON.stringify([choice.teamId, choice.roundId]))).size !== resolutions.length) throw offlineUnavailable();
  return { eventId, exportId, operations, resolutions, completeRecovery, journalDigest: offlineDigest(canonicalOfflineJson(operations)),
    decisionDigest: offlineDigest(canonicalOfflineJson({ operations, resolutions, completeRecovery })), previewDigest: input.previewDigest };
}
async function previewIn(tx: Transaction, auth: AuthIdentity, input: ReturnType<typeof parseRequest>, scope: OfflineScope) {
  const bound = await boundExport(tx, auth, input.eventId, input.exportId, scope), manifest = await storedManifest(tx, bound.record, input.eventId);
  const replayed = replay(manifest, input.operations), local = summary(manifest, replayed.state, replayed.history.length, input.operations.length);
  // A fresh, explicit online completion is a server action, never a forged backdated offline end.
  if (input.completeRecovery && replayed.state.status === 'active') local.complete = result(manifest, replayed.state.scores).complete;
  const receipt = bound.record.receipt as OfflineSyncReceipt | undefined;
  if (receipt) {
    if (bound.record.journalDigest !== input.journalDigest || (input.resolutions.length && bound.record.decisionDigest !== input.decisionDigest))
      throw new HttpsError('already-exists', 'Tato offline relace byla synchronizována s jiným průběhem nebo rozhodnutím. Nic se nepřepsalo.');
    const merged = { ...local, rows: receipt.rows, complete: true };
    return { ...bound, manifest, ...replayed, receipt,
      preview: { exportId: input.exportId, previewDigest: String(bound.record.previewDigest), conflicts: [], server: merged, local, merged,
        resolutionAllowed: false, resolutions: input.resolutions } satisfies OfflineSyncPreview };
  }
  const current = await readOfflineSource(tx, input.eventId, auth), conflicts: OfflineSyncConflict[] = [], scoreConflicts: OfflineSyncConflict[] = [];
  if (current.snapshotId !== manifest.snapshot.id) conflicts.push({ reason: 'Akce nyní používá jiný uzamčený kvíz. Původní data se nepřepíšou.' });
  if (current.activeOnline) conflicts.push({ reason: 'Běží online projekce. Nejprve ji bezpečně ukončete; poté zkontrolujte rozdíly.' });
  for (const base of manifest.baseScores) {
    const online = current.baseScores.find(score => score.teamId === base.teamId && score.roundId === base.roundId);
    const localScore = replayed.state.scores.find(score => score.teamId === base.teamId && score.roundId === base.roundId);
    if (!online || online.revision !== base.revision || online.halfPoints !== base.halfPoints)
      scoreConflicts.push({ teamId: base.teamId, roundId: base.roundId, reason: 'Online body se od přípravy změnily.', base, ...(online ? { online } : {}), ...(localScore ? { local: localScore } : {}) });
  }
  for (const { reference, pin } of exportMediaPins(bound.record)) {
    const parsed = parseQuizAsset(reference)!;
    const media = (await tx.get(getFirestore().doc('quizzes/' + parsed.quizId + '/mediaAssets/' + parsed.assetId))).data();
    if (!media || storedDigest(pinnedMedia(media)) !== storedDigest(pin)) conflicts.push({ reason: 'Vlastní médium bylo nahrazeno nebo změnilo generaci.' });
  }
  const structuralMatch = typeof bound.record.structuralDigest === 'string' && current.structuralDigest === bound.record.structuralDigest;
  if (current.baselineDigest !== bound.record.baselineDigest && (!structuralMatch || !scoreConflicts.length))
    conflicts.push({ reason: 'Online akce, seznam týmů, výsledky nebo průběh se od přípravy změnily.' });
  const resolutionAllowed = structuralMatch && conflicts.length === 0 && scoreConflicts.length > 0;
  if (input.resolutions.length && !resolutionAllowed) throw new HttpsError('failed-precondition', 'Změna kvízu, týmů nebo průběhu neumožňuje bezpečně sloučit body. Původní data zůstala zachovaná.');
  const conflictKeys = new Set(scoreConflicts.map(cell => JSON.stringify([cell.teamId, cell.roundId])));
  for (const choice of input.resolutions) if (!conflictKeys.has(JSON.stringify([choice.teamId, choice.roundId])))
    throw new HttpsError('invalid-argument', 'Rozhodnutí nepatří do aktuálního náhledu konfliktů.');
  const choiceKeys = new Set(input.resolutions.map(choice => JSON.stringify([choice.teamId, choice.roundId])));
  conflicts.push(...scoreConflicts.filter(cell => !resolutionAllowed || !choiceKeys.has(JSON.stringify([cell.teamId, cell.roundId]))));
  let importState = replayed.state, importHistory = replayed.history;
  let merged: OfflineSyncPreview['merged'];
  if (resolutionAllowed && input.resolutions.length === scoreConflicts.length) {
    const scores = [...current.baseScores];
    for (const localScore of replayed.state.scores) {
      const key = JSON.stringify([localScore.teamId, localScore.roundId]);
      if (!conflictKeys.has(key)) scores[scores.findIndex(score => score.teamId === localScore.teamId && score.roundId === localScore.roundId)] = localScore;
    }
    importHistory = replayed.history.filter(item => !conflictKeys.has(JSON.stringify([item.teamId, item.roundId])));
    for (const choice of input.resolutions) {
      if (choice.choice === 'online') continue;
      const index = scores.findIndex(score => score.teamId === choice.teamId && score.roundId === choice.roundId), online = scores[index];
      const localScore = replayed.state.scores.find(score => score.teamId === choice.teamId && score.roundId === choice.roundId);
      const original = [...replayed.history].reverse().find(item => item.teamId === choice.teamId && item.roundId === choice.roundId);
      if (!online || !localScore) throw offlineUnavailable();
      if (online.halfPoints === localScore.halfPoints) continue;
      if (online.revision >= Number.MAX_SAFE_INTEGER) throw offlineUnavailable();
      const score = { ...localScore, revision: online.revision + 1 }; scores[index] = score;
      importHistory.push({ ...(original ?? { operationId: 'resolution-' + input.decisionDigest.slice(0, 40), sequence: 0, observedAtMs: 0,
        teamId: choice.teamId, roundId: choice.roundId }), revision: score.revision, previousHalfPoints: online.halfPoints, halfPoints: score.halfPoints,
        reason: choice.reason, resolutionChoice: 'offline', resolutionDigest: input.decisionDigest, ...(!original ? { serverResolution: true as const } : {}) });
    }
    importState = { ...replayed.state, scores };
    merged = summary(manifest, importState, importHistory.length, input.operations.length);
    if (input.completeRecovery && importState.status === 'active') merged = { ...merged, complete: result(manifest, importState.scores).complete };
    if (importHistory.length > limits.scoreMutations || new Set(importHistory.map(item => JSON.stringify([item.teamId, item.roundId]))).size + importHistory.length + 6 > 456)
      conflicts.push({ reason: 'Zvolená sloučení přesahují bezpečný limit historie. Zvolte ponechání online bodů; původní offline průběh zůstane v nouzovém souboru.' });
  }
  const currentManifest = { ...manifest, rounds: current.rounds, teams: current.teams, baseScores: current.baseScores };
  const serverResult = result(currentManifest, current.baseScores);
  const server = { scoreChanges: 0, operationCount: 0, rows: serverResult.rows, complete: serverResult.complete };
  const previewDigest = offlineDigest(canonicalOfflineJson([input.exportId, input.decisionDigest, current.baselineDigest, replayed.state.headHash, conflicts]));
  return { ...bound, manifest, current, ...replayed, importState, importHistory, receipt: undefined,
    preview: { exportId: input.exportId, previewDigest, conflicts, server, local, resolutionAllowed, resolutions: input.resolutions,
      ...(merged ? { merged } : {}) } satisfies OfflineSyncPreview };
}

export const previewOfflineSync = onCall(options, async request => {
  request.rawRequest.res?.setHeader('Cache-Control', 'no-store');
  const scope = requireOfflineRuntime(offlineId(offlineRecord(request.data).eventId), request.rawRequest.get('origin'), 'sync');
  const input = parseRequest(request.data, false); await freshIdentity(request.auth);
  const value = await getFirestore().runTransaction(tx => previewIn(tx, request.auth, input, scope));
  await freshIdentity(request.auth); return value.preview;
});

export const commitOfflineSync = onCall(options, async request => {
  request.rawRequest.res?.setHeader('Cache-Control', 'no-store');
  const scope = requireOfflineRuntime(offlineId(offlineRecord(request.data).eventId), request.rawRequest.get('origin'), 'sync');
  const input = parseRequest(request.data, true); await freshIdentity(request.auth);
  const receipt = await getFirestore().runTransaction(async tx => {
    const value = await previewIn(tx, request.auth, input, scope);
    if (value.receipt) return { ...value.receipt, replayed: true };
    if (value.preview.conflicts.length || value.preview.previewDigest !== input.previewDigest) throw new HttpsError('aborted', 'Online data nebo náhled se změnily. Nic nebylo přepsáno; načtěte a zkontrolujte nový souhrn.');
    if (!(value.preview.merged ?? value.preview.local).complete || (value.state.status !== 'ended' && !input.completeRecovery)) throw new HttpsError('failed-precondition', 'Nejprve doplňte body a ukončete offline kvíz nebo výslovně potvrďte dokončení uloženého průběhu na serveru.');
    const db = getFirestore(), now = Timestamp.now(), actorUid = value.member.uid, { manifest } = value, state = value.importState, history = value.importHistory;
    const changed = new Map<string, OfflineScore>();
    for (const item of history) {
      const score = state.scores.find(score => score.teamId === item.teamId && score.roundId === item.roundId)!;
      changed.set(JSON.stringify([score.teamId, score.roundId]), score);
    }
    // At most 200 final cells + 250 individual history mutations + 6 canonical records.
    if (changed.size + history.length + 6 > 456) throw new HttpsError('resource-exhausted', 'Historie přesahuje limit bezpečné atomické synchronizace.');
    const sessionId = manifest.sessionId, versionId = offlineDigest(canonicalOfflineJson([input.exportId, input.journalDigest, 'final']));
    const sessionRef = db.doc('sessions/' + sessionId), versionRef = sessionRef.collection('finalVersions').doc(versionId);
    const previousSession = await tx.get(sessionRef);
    if (previousSession.exists) throw new HttpsError('already-exists', 'Identita offline relace již patří jinému záznamu.');
    const final = result(manifest, state.scores), finalReveal = { ...initialFinal(versionId, final.rows, { pageSize: 6, presentationStyle: 'show' }), visible: false };
    const lastSlide = manifest.slides.find(slide => slide.position === state.slidePosition) ?? manifest.slides[0]!;
    const session = { sessionId, eventId: input.eventId, snapshotId: manifest.snapshot.id, quizId: manifest.snapshot.quizId, quizTitle: value.current.snapshot.quizTitle as string,
      slideCount: manifest.slides.length, status: 'ended' as const, currentSlidePosition: lastSlide.position, currentSlideId: lastSlide.id,
      answerRevealed: false, presentationMode: 'slide' as const, mediaCommand: 'idle' as const, mediaPlaybackState: 'idle' as const,
      mediaGeneration: state.mediaGeneration, introGeneration: 0, revision: state.sequence, createdBy: actorUid, updatedBy: actorUid,
      createdAt: now, startedAt: now, endedAt: now, updatedAt: now, finalReveal, offlineExportId: input.exportId };
    const response: OfflineSyncReceipt = { exportId: input.exportId, sessionId, receiptId: versionId, headHash: state.headHash,
      operationCount: input.operations.length, rows: final.rows, replayed: false,
      ...(input.completeRecovery && state.status === 'active' ? { completedFromRecovery: true as const } : {}) };
    const completeRecord = { ...value.record, status: 'synchronized', receipt: response, previewDigest: value.preview.previewDigest,
      journalDigest: input.journalDigest, journal: input.operations, resolutions: input.resolutions, completeRecovery: input.completeRecovery,
      decisionDigest: input.decisionDigest, synchronizedAt: now };
    if (Buffer.byteLength(canonicalOfflineJson({ ...completeRecord, synchronizedAt: now.toMillis(), createdAt: null })) > 900 * 1024)
      throw new HttpsError('resource-exhausted', 'Záznam synchronizace přesahuje bezpečnou velikost. Nic nebylo uloženo.');
    for (const score of changed.values()) tx.set(value.current.eventRef.collection('scores').doc(storedDigest([score.teamId, score.roundId])),
      { ...score, snapshotId: manifest.snapshot.id, updatedAt: now, updatedBy: actorUid });
    for (const item of history) {
      const { operationId, sequence, observedAtMs, teamId, roundId, serverResolution, ...entry } = item;
      tx.create(value.current.eventRef.collection('scores').doc(storedDigest([teamId, roundId])).collection('history').doc(String(item.revision)),
        { ...entry, actorUid, createdAt: now, offlineExportId: input.exportId,
          ...(serverResolution ? { serverResolution: true } : { offlineOperationId: operationId, offlineSequence: sequence, offlineObservedAtMs: observedAtMs }) });
    }
    tx.create(sessionRef, session);
    tx.create(versionRef, { versionId, eventId: input.eventId, sessionId, snapshotId: manifest.snapshot.id, rows: final.rows,
      pageSize: 6, presentationStyle: 'show', teamRanks: final.teamRanks, rowTeamIds: final.rowTeamIds, sourceFingerprint: storedDigest([input.eventId, manifest.snapshot.id, final.sourceFingerprint]),
      includedRounds: final.includedRounds, actorUid, createdAt: now, replacesVersionId: null, offlineExportId: input.exportId });
    tx.set(db.doc('publicSessions/' + sessionId), buildPublicSessionState(session));
    tx.update(value.current.eventRef, { lifecycleStatus: 'completed', liveSessionId: sessionId, 'scoring.started': true,
      revision: Number(value.event.revision) + 1, updatedAt: now, updatedBy: actorUid, completion: { at: now, by: actorUid,
        reason: input.completeRecovery && state.status === 'active' ? 'Uložený offline průběh výslovně dokončen při online obnově.' : 'Dokončeno v offline režimu.' },
      capabilityVersion: Number(value.event.capabilityVersion ?? 0) + 1, registrationPublished: false, registrationStatus: 'closed' });
    tx.delete(db.doc('publicEvents/' + input.eventId));
    tx.set(value.exportRef, completeRecord);
    return response;
  });
  await freshIdentity(request.auth); return receipt;
});
