import { getFirestore, Timestamp, type Transaction } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { canHideInfoSlide, canonicalOfflineJson, offlineEventLimits as limits, normalizeResultTemplates, normalizeShowPreferences, parseQuizAsset, resolveSlideDesign,
  resolveLegacySlideAppearance, youtubeVideoId, type OfflineEventManifest, type OfflineIssue, type OfflineMediaAsset,
  type OfflineRound, type OfflineScore, type OfflineTeam, type Permission } from '@filmovy-kviz/quiz-domain';
import { authorize, type AuthIdentity } from '../access/authorization.js';
import { slideView } from '../access/slide-view.js';
import { assertEventOperational } from '../events/guards.js';
import { publicResultTemplate } from '../live/publication.js';
import { offlineDigest } from './signing.js';
import type { OfflineScope } from './activation.js';

export const offlinePermissions: readonly Permission[] = ['event.read', 'event.export', 'event.answers.read', 'event.answers.export',
  'event.notes.read', 'event.live', 'event.score', 'event.manage'];
export const offlineUnavailable = () => new HttpsError('failed-precondition', 'Offline kvíz nelze bezpečně připravit nebo synchronizovat.');
export function offlineRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function offlineId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,150}$/u.test(value)) throw new HttpsError('invalid-argument', 'Neplatná identita offline akce.');
  return value;
}
export function offlineInput(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key)))
    throw new HttpsError('invalid-argument', 'Neplatný požadavek offline kvízu.');
  return value as Record<string, unknown>;
}

/** A stored export is server-owned and stays bound to its original event and environment, including during recovery. */
export function assertOfflineExportContext(record: Record<string, unknown>, scope: OfflineScope, eventId: string): void {
  const seed = offlineRecord(record.manifestSeed), grant = offlineRecord(record.grant), payload = offlineRecord(grant.payload);
  if (record.schemaVersion !== 1 || seed.environment !== scope.environment || seed.audience !== scope.audience
    || offlineRecord(seed.event).id !== eventId || payload.schemaVersion !== 1
    || payload.environment !== scope.environment || payload.audience !== scope.audience || payload.eventId !== eventId
    || payload.exportId !== record.exportId || payload.sessionId !== record.sessionId || payload.snapshotId !== record.snapshotId
    || payload.manifestDigest !== record.manifestDigest || payload.issuedAtMs !== record.issuedAtMs || payload.expiresAtMs !== record.expiresAtMs
    || typeof grant.keyId !== 'string' || !/^[a-f0-9]{64}$/u.test(grant.keyId)
    || typeof grant.signature !== 'string' || !/^[A-Za-z0-9_-]{86}$/u.test(grant.signature)
    || grant.digest !== offlineDigest(canonicalOfflineJson(payload))) throw offlineUnavailable();
}

function stableStored(value: unknown): unknown {
  if (value instanceof Timestamp) return { seconds: value.seconds, nanoseconds: value.nanoseconds };
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map(stableStored);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, stableStored(item)]));
  return value;
}
export const storedDigest = (value: unknown) => offlineDigest(canonicalOfflineJson(stableStored(value)));

export function offlineSlides(snapshot: Record<string, unknown>, slides: { id: string; data: Record<string, unknown> }[], rounds: { id: string; data: Record<string, unknown> }[]) {
  const roundData = new Map(rounds.map(row => [row.id, row.data]));
  return slides.map(row => {
    const data = row.data, round = typeof data.roundId === 'string' ? roundData.get(data.roundId) : undefined;
    for (const field of ['title', 'text', 'moderatorNote', 'correctAnswer', 'roundId', 'roundTitle', 'questionImage', 'answerImage', 'backgroundImage', 'mediaSource', 'answerExplanation']) {
      if (data[field] !== undefined && data[field] !== null && typeof data[field] !== 'string')
        throw new HttpsError('failed-precondition', `Snímek ${String(data.position)} má neplatné textové pole ${field}. Opravte jej před přípravou offline kvízu.`);
    }
    const sourceQuestionNumber = offlineRecord(data.presentation).sourceQuestionNumber;
    if (sourceQuestionNumber !== undefined && sourceQuestionNumber !== null && typeof sourceQuestionNumber !== 'string') throw offlineUnavailable();
    if (Array.isArray(data.media)) for (const item of data.media as unknown[]) {
      const media = offlineRecord(item);
      for (const field of ['role', 'kind', 'source', 'url', 'value']) if (media[field] !== undefined && typeof media[field] !== 'string') throw offlineUnavailable();
    }
    const appearance = resolveLegacySlideAppearance(snapshot.defaultAppearance, data);
    const { originalMediaSource, ...safe } = slideView(row.id, { ...data, ...appearance, design: resolveSlideDesign(snapshot.defaultDesign, round?.design, data.design) }, true, true, { preserveStoredImages: true });
    void originalMediaSource;
    return safe;
  });
}

/** Every source query is in the same transaction as the baseline checks/writes. No contacts leave this module. */
export async function readOfflineSource(tx: Transaction, eventId: string, auth: AuthIdentity, operational = true) {
  const member = await authorize(auth, offlinePermissions, { kind: 'event', id: eventId }, tx);
  const db = getFirestore(), eventRef = db.doc('events/' + eventId), event = (await tx.get(eventRef)).data();
  if (!event) throw offlineUnavailable();
  if (operational) assertEventOperational(event);
  const assignment = offlineRecord(event.quizAssignment);
  if (!assignment.snapshotId || !assignment.quizId) throw new HttpsError('failed-precondition', 'Přiřaďte kvíz a uzamkněte akci.', { offlineCheck: 'snapshot' });
  const snapshotId = offlineId(assignment.snapshotId), quizId = offlineId(assignment.quizId);
  if (!Number.isSafeInteger(assignment.quizRevision) || !Number.isSafeInteger(event.revision) || !(event.startsAt instanceof Timestamp)
    || typeof event.title !== 'string' || !event.title.trim()) throw offlineUnavailable();
  if (offlineRecord(event.scoring).unitScale !== 2 || offlineRecord(event.scoring).rankingMode !== 'dense') throw offlineUnavailable();
  const snapshotRef = db.doc('quizSnapshots/' + snapshotId), snapshot = (await tx.get(snapshotRef)).data();
  if (!snapshot || snapshot.status !== 'ready' || snapshot.eventId !== eventId || snapshot.quizId !== quizId || snapshot.quizRevision !== assignment.quizRevision)
    throw new HttpsError('failed-precondition', 'Uzamčená verze kvízu není připravená.', { offlineCheck: 'snapshot' });
  const [slides, rounds, roster, scores, sessions] = await Promise.all([
    tx.get(snapshotRef.collection('slides').orderBy('position').limit(limits.slides + 1)),
    tx.get(snapshotRef.collection('rounds').orderBy('position').limit(limits.rounds + 1)),
    tx.get(eventRef.collection('registrations').where('status', '==', 'accepted').limit(limits.teams + 1)),
    tx.get(eventRef.collection('scores').limit(limits.scoreCells + 1)),
    tx.get(db.collection('sessions').where('eventId', '==', eventId).limit(201)),
  ]);
  if (roster.empty) throw new HttpsError('resource-exhausted', 'Přidejte alespoň jeden potvrzený tým.', { offlineCheck: 'teams' });
  if (slides.size === 0 || slides.size > limits.slides || slides.size !== snapshot.slideCount || rounds.size === 0 || rounds.size > limits.rounds
    || rounds.size !== snapshot.roundCount || roster.size > limits.teams || scores.size > limits.scoreCells || sessions.size > 200
    || rounds.size * roster.size > limits.scoreCells) throw new HttpsError('resource-exhausted', 'Offline kvíz překračuje limit snímků, kol, týmů nebo 200 bodovacích buněk.');
  const normalizedRounds: OfflineRound[] = rounds.docs.map(row => {
    const data = row.data();
    if (typeof data.title !== 'string' || !data.title.trim() || !Number.isSafeInteger(data.position) || data.position < 1) throw offlineUnavailable();
    return { id: row.id, title: data.title, position: data.position as number };
  });
  const teams: OfflineTeam[] = roster.docs.map(row => {
    const data = row.data();
    if (data.eventId !== eventId || typeof data.teamName !== 'string' || !data.teamName.trim() || !Number.isSafeInteger(data.revision)) throw offlineUnavailable();
    return { id: row.id, name: data.teamName, revision: data.revision as number };
  }).sort((a, b) => a.id.localeCompare(b.id, 'en'));
  const knownTeams = new Set(teams.map(team => team.id)), knownRounds = new Set(normalizedRounds.map(round => round.id));
  const existing = new Map<string, OfflineScore>();
  for (const row of scores.docs) {
    const data = row.data();
    if (typeof data.teamId !== 'string' || typeof data.roundId !== 'string' || !knownTeams.has(data.teamId) || !knownRounds.has(data.roundId) || data.snapshotId !== snapshotId
      || !Number.isSafeInteger(data.revision) || data.revision < 1 || (data.halfPoints !== null && (!Number.isSafeInteger(data.halfPoints) || data.halfPoints < 0))
      || row.id !== storedDigest([data.teamId, data.roundId])) throw offlineUnavailable();
    existing.set(JSON.stringify([data.teamId, data.roundId]), { teamId: data.teamId, roundId: data.roundId,
      revision: data.revision as number, halfPoints: data.halfPoints as number | null });
  }
  const baseScores: OfflineScore[] = teams.flatMap(team => normalizedRounds.map(round => existing.get(JSON.stringify([team.id, round.id]))
    ?? { teamId: team.id, roundId: round.id, revision: 0, halfPoints: null }));
  const frozenSlides = offlineSlides(snapshot, slides.docs.map(row => ({ id: row.id, data: row.data() })), rounds.docs.map(row => ({ id: row.id, data: row.data() })));
  const baselineDigest = storedDigest({ event, snapshot, slides: slides.docs.map(row => [row.id, row.data()]), rounds: rounds.docs.map(row => [row.id, row.data()]),
    teams, scores: baseScores, sessions: sessions.docs.map(row => [row.id, row.data()]) });
  // Only score mutations may be explicitly reconciled. Other event/roster/media/session changes stay fail-closed.
  const structuralEvent: Record<string, unknown> = { ...event, scoring: { ...offlineRecord(event.scoring) } };
  for (const field of ['revision', 'updatedAt', 'updatedBy', 'updatedByAccessId']) delete structuralEvent[field];
  delete offlineRecord(structuralEvent.scoring).started;
  const structuralDigest = storedDigest({ event: structuralEvent, snapshot, slides: slides.docs.map(row => [row.id, row.data()]),
    rounds: rounds.docs.map(row => [row.id, row.data()]), teams, sessions: sessions.docs.map(row => [row.id, row.data()]) });
  return { member, eventRef, event, snapshot, snapshotId, quizId, quizRevision: assignment.quizRevision as number,
    rounds: normalizedRounds, teams, baseScores, slides: frozenSlides, baselineDigest, structuralDigest,
    activeOnline: sessions.docs.some(row => row.data().status !== 'ended'),
    rawRecords: [{ level: 'root' as const, position: 0, data: snapshot }, ...rounds.docs.map(row => ({ level: 'round' as const, position: 0, data: row.data() })),
      ...slides.docs.map(row => ({ level: 'slide' as const, position: Number(row.data().position), data: row.data() }))] };
}
export type OfflineSource = Awaited<ReturnType<typeof readOfflineSource>>;

export function manifestFromSource(source: OfflineSource, header: { exportId: string; sessionId: string; issuedAtMs: number; expiresAtMs: number }, assets: readonly OfflineMediaAsset[], scope: OfflineScope): OfflineEventManifest {
  return { schemaVersion: 1, ...header, ...scope,
    actorId: source.member.uid, membershipVersion: source.member.version,
    event: { id: source.eventRef.id, title: String(source.event.title), startsAtMs: (source.event.startsAt as Timestamp).toMillis(), revision: source.event.revision as number },
    snapshot: { id: source.snapshotId, quizId: source.quizId, quizRevision: source.quizRevision },
    rounds: source.rounds, teams: source.teams, baseScores: source.baseScores, slides: source.slides, assets,
    scoring: { unitScale: 2, rankingMode: 'dense' }, resultTemplates: { interim: publicResultTemplate(source.snapshot, 'interim'), final: publicResultTemplate(source.snapshot, 'final') } };
}

export function requiredOfflineMedia(source: OfflineSource) {
  const required = new Map<string, { kind: 'image' | 'audio' | 'video'; position: number; field: string }>(), issues: OfflineIssue[] = [];
  const show = normalizeShowPreferences(source.event.showPreferences);
  if (show.audioEnabled) for (const cue of Object.keys(show.cues)) issues.push({ slidePosition: 0, field: 'showPreferences.' + cue,
    message: 'Samostatná hudba online vyhlášení není součástí offline přehrávání otázek. Vypněte tuto volitelnou hudbu před přípravou, nebo ji zařaďte jako vlastní zvukový snímek kvízu.' });
  const occurrences = new Map<string, Set<'public' | 'answer' | 'unknown'>>();
  for (const { level, data } of source.rawRecords) {
    const visit = (value: unknown, path: string[], depth: number) => {
      if (depth > 24) throw offlineUnavailable();
      if (typeof value === 'string' && value.startsWith('quiz-asset:')) {
        const [field, child, property] = path;
        let visibility: 'public' | 'answer' | 'unknown' = 'unknown';
        if (level === 'slide' && path.length === 1) {
          if (['questionImage', 'backgroundImage', 'mediaSource'].includes(field ?? '')) visibility = 'public';
          if (field === 'answerImage') visibility = 'answer';
        }
        if (path.length === 2 && ['backgroundImage', 'logoImage'].includes(child ?? '')) {
          if (level === 'slide' && field === 'answerDesign') visibility = 'answer';
          if ((level !== 'root' && field === 'design') || (level === 'root' && field === 'defaultDesign')
            || (level === 'root' && field === 'defaultAppearance' && child === 'backgroundImage') || (level === 'root' && field === 'printTemplate' && child === 'logoImage')) visibility = 'public';
        }
        if (level === 'root' && path.length === 4 && field === 'resultTemplates' && ['interim', 'final'].includes(child ?? '')
          && property === 'design' && ['backgroundImage', 'logoImage'].includes(path[3] ?? '')) visibility = 'public';
        if (level === 'slide' && path.length === 3 && field === 'media' && ['source', 'url', 'value'].includes(property ?? '')) {
          const media = Array.isArray(data.media) ? offlineRecord(data.media[Number(child)]) : {};
          if (media.role === 'answer') visibility = 'answer';
          if (media.role === 'prompt' || media.role === 'background') visibility = 'public';
        }
        const kinds = occurrences.get(value) ?? new Set<'public' | 'answer' | 'unknown'>(); kinds.add(visibility); occurrences.set(value, kinds); return;
      }
      if (Array.isArray(value)) { value.forEach((item, index) => visit(item, [...path, String(index)], depth + 1)); return; }
      if (value !== null && typeof value === 'object') Object.entries(value).forEach(([key, item]) => visit(item, [...path, key], depth + 1));
    };
    visit(data, [], 0);
  }
  function add(value: unknown, kind: 'image' | 'audio' | 'video', position: number, field: string) {
    if (value === '' || value === undefined || value === null) return;
    const parsed = parseQuizAsset(value);
    if (typeof value !== 'string' || !parsed || parsed.quizId !== source.quizId) {
      if (typeof value === 'string' && kind !== 'image' && youtubeVideoId(value)) {
        const replacement = kind === 'audio' ? 'zvukový soubor' : 'soubor MP4';
        issues.push({ slidePosition: position, field, message: `Ukázku z YouTube nelze uložit offline. Nahrajte vlastní ${replacement}, k němuž máte práva.` });
        return;
      }
      issues.push({ slidePosition: position, field, message: 'Externí nebo neznámé médium nelze uložit offline. Nahraďte je vlastním oprávněným souborem.' }); return;
    }
    if (required.has(value) && required.get(value)!.kind !== kind) { issues.push({ slidePosition: position, field, message: 'Médium má neslučitelné použití.' }); return; }
    required.set(value, { kind, position, field });
  }
  for (const slide of source.slides) {
    if (slide.hidden && canHideInfoSlide(slide)) continue;
    if (slide.isQuestion && !slide.correctAnswer.trim()) issues.push({ slidePosition: slide.position, field: 'correctAnswer', message: 'Doplňte správnou odpověď před přípravou offline kvízu.' });
    if (['image', 'picture', 'photo'].includes(slide.kind) && !slide.questionImage)
      issues.push({ slidePosition: slide.position, field: 'questionImage', message: 'Obrázková otázka nemá vlastní obrázek.' });
    add(slide.questionImage, 'image', slide.position, 'questionImage'); add(slide.backgroundImage, 'image', slide.position, 'backgroundImage');
    add(slide.answerImage, 'image', slide.position, 'answerImage');
    for (const [name, design] of [['design', slide.design], ['answerDesign', slide.answerDesign]] as const) {
      add(design?.backgroundImage, 'image', slide.position, name + '.backgroundImage');
      add(design?.logoImage, 'image', slide.position, name + '.logoImage');
    }
    if (['audio', 'music', 'video', 'youtube'].includes(slide.kind)) {
      if (!slide.mediaSource) issues.push({ slidePosition: slide.position, field: 'mediaSource', message: 'Otázka nemá vlastní zvuk nebo video.' });
      else add(slide.mediaSource, ['video', 'youtube'].includes(slide.kind) ? 'video' : 'audio', slide.position, 'mediaSource');
    }
    for (const entry of slide.media) add(entry.source, entry.kind === 'image' ? 'image' : entry.kind === 'audio' ? 'audio' : 'video', slide.position, 'media');
  }
  const templates = normalizeResultTemplates(source.snapshot.resultTemplates);
  for (const name of ['interim', 'final'] as const) {
    const template = templates[name];
    add(template?.design?.backgroundImage, 'image', 0, name + '.backgroundImage'); add(template?.design?.logoImage, 'image', 0, name + '.logoImage');
  }
  if (required.size > limits.assets) issues.push({ slidePosition: 0, field: 'media', message: 'Kvíz překračuje limit 256 vlastních médií.' });
  for (const [reference, use] of required) {
    const visibility = occurrences.get(reference);
    if (!visibility || visibility.has('unknown') || (visibility.has('public') && visibility.has('answer')))
      issues.push({ slidePosition: use.position, field: use.field, message: 'Médium má nejednoznačné soukromé použití nebo sdílí soubor otázky a odpovědi. Použijte oddělené vlastní soubory.' });
  }
  return { required, issues };
}
