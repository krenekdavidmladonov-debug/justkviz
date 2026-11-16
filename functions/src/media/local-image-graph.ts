import { createHash } from 'node:crypto';
import { getFirestore, type Transaction, type DocumentReference } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import {
  canHideInfoSlide, hasPermission, localImageBackupLimits, normalizeSlideDesign, parseQuizAsset,
  resolveLegacySlideAppearance, type LocalImageAsset, type LocalImageContentType, type LocalImageIdentity,
  type LocalImageManifest, type LocalImageOmission, type LocalImageRole, type LocalImageUse,
} from '@filmovy-kviz/quiz-domain';
import { authorize, type AuthIdentity } from '../access/authorization.js';
import { buildPublicSessionState } from '../live/publication.js';
import type { PrivateLiveSession, PrivateSlide } from '../live/types.js';
import { resolveOriginalImages } from './original-images.js';
import { readAssignedLocalMediaSource } from './local-event-manifest.js';

export const imageBackupUnavailable = () => new HttpsError('failed-precondition', 'Záloha obrázků není pro aktuální kvíz dostupná.');
export const imageDigest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
export const imageEtag = (reference: string, generation: string, contentType: string, size: number) => '"' + imageDigest(JSON.stringify([reference, generation, contentType, size])) + '"';
type Visibility = 'public' | 'answer' | 'unknown';
type RecordData = Record<string, unknown>;
export const imageRecord = (value: unknown): RecordData | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordData : undefined;

export interface ImageCandidate {
  reference: string; ref: DocumentReference; metadata: RecordData; visibility: 'public' | 'answer'; uses: LocalImageUse[];
  generation: string; contentType: LocalImageContentType; size: number;
}

function occurrenceKind(path: string[], data: RecordData, level: 'root' | 'round' | 'slide'): Visibility {
  const [field, child, property] = path;
  if (path.length === 1 && level === 'slide') {
    if (field === 'questionImage' || field === 'backgroundImage') return 'public';
    if (field === 'answerImage') return 'answer';
  }
  if (path.length === 2 && ['backgroundImage', 'logoImage'].includes(child ?? '')) {
    if (field === 'answerDesign' && level === 'slide') return 'answer';
    if ((field === 'design' && level !== 'root') || (field === 'defaultDesign' && level === 'root')) return 'public';
    if (field === 'defaultAppearance' && level === 'root' && child === 'backgroundImage') return 'public';
    if (field === 'printTemplate' && level === 'root' && child === 'logoImage') return 'public';
  }
  if (level === 'slide' && field === 'media' && path.length === 3 && ['source', 'value', 'url'].includes(property ?? '')) {
    const item = Array.isArray(data.media) ? imageRecord(data.media[Number(child)]) : undefined;
    if (item?.kind === 'image') {
      if (item.role === 'answer') return 'answer';
      if (item.role === 'prompt' || item.role === 'background') return 'public';
    }
  }
  return 'unknown';
}

function scanReferences(data: RecordData, level: 'root' | 'round' | 'slide', occurrences: Map<string, Set<Visibility>>) {
  const visit = (value: unknown, path: string[]) => {
    if (typeof value === 'string') {
      if (value.startsWith('quiz-asset:')) {
        const kinds = occurrences.get(value) ?? new Set<Visibility>();
        kinds.add(occurrenceKind(path, data, level)); occurrences.set(value, kinds);
      }
      return;
    }
    if (Array.isArray(value)) { value.forEach((entry, index) => visit(entry, [...path, String(index)])); return; }
    const object = imageRecord(value);
    if (object) Object.entries(object).forEach(([key, entry]) => visit(entry, [...path, key]));
  };
  visit(data, []);
}

/** Mirrors the resolved fields read by SlideRenderer, never the private source model. */
export function publicImageSources(publication: RecordData): { role: LocalImageRole; reference: string }[] {
  const design = normalizeSlideDesign(publication.design);
  const source = (value: unknown) => typeof value === 'string' && value.length ? value : undefined;
  const values: [LocalImageRole, string | undefined][] = [
    ['background-image', source(design.backgroundImage ?? publication.backgroundImage)],
    ['logo-image', design.showLogo === false ? undefined : source(design.logoImage)],
    ['question-image', ['image', 'picture', 'photo'].includes(String(publication.slideKind).toLowerCase()) ? source(publication.questionImage) : undefined],
    ['answer-image', publication.answerRevealed === true && publication.revealedAnswer !== undefined ? source(publication.answerImage) : undefined],
  ];
  return values.flatMap(([role, reference]) => reference ? [{ role, reference }] : []);
}

function frozenSlide(id: string, data: RecordData, root: RecordData, rounds: Map<string, RecordData>): PrivateSlide {
  const resolved = resolveOriginalImages(data);
  if (typeof resolved.position !== 'number' || !Number.isSafeInteger(resolved.position) || resolved.position < 1 || resolved.position > 400
    || typeof resolved.kind !== 'string') throw imageBackupUnavailable();
  const slide: PrivateSlide = {
    ...resolved, id, position: resolved.position, kind: resolved.kind, isQuestion: resolved.isQuestion === true,
    title: typeof resolved.title === 'string' ? resolved.title : '', text: typeof resolved.text === 'string' ? resolved.text : '',
    options: Array.isArray(resolved.options) ? resolved.options : [], media: Array.isArray(resolved.media) ? resolved.media : [],
    presentation: imageRecord(resolved.presentation) ?? {},
    defaultDesign: root.defaultDesign, roundDesign: typeof resolved.roundId === 'string' ? rounds.get(resolved.roundId)?.design : undefined,
  };
  return { ...slide, ...resolveLegacySlideAppearance(root.defaultAppearance, slide) };
}

function previewSession(slide: PrivateSlide): PrivateLiveSession {
  return {
    sessionId: 'local-image-preview', quizId: 'local-image-preview', quizTitle: '', slideCount: 400,
    status: 'active', currentSlidePosition: slide.position, currentSlideId: slide.id, answerRevealed: false,
    presentationMode: 'slide', mediaCommand: 'idle', mediaPlaybackState: 'idle', mediaGeneration: 0, introGeneration: 0, revision: 0,
    createdBy: 'local-image-preview', updatedBy: 'local-image-preview', createdAt: null, startedAt: null, endedAt: null, updatedAt: null,
  };
}

export async function readLocalImageGraph(tx: Transaction, eventId: string, auth?: AuthIdentity) {
  const member = auth ? await authorize(auth, ['event.read', 'event.export'], { kind: 'event', id: eventId }, tx) : undefined;
  const source = await readAssignedLocalMediaSource(eventId, tx);
  const answers = member !== undefined && hasPermission(member, 'event.answers.read') && hasPermission(member, 'event.answers.export');
  const [slideDocs, roundDocs] = await Promise.all([
    tx.get(source.snapshotRef.collection('slides').orderBy('position').limit(401)), tx.get(source.snapshotRef.collection('rounds').limit(401)),
  ]);
  if (slideDocs.size > 400 || roundDocs.size > 400 || slideDocs.size !== source.snapshot.slideCount || roundDocs.size !== source.snapshot.roundCount) throw imageBackupUnavailable();
  const rounds = new Map<string, RecordData>(roundDocs.docs.map(doc => [doc.id, doc.data()]));
  const occurrences = new Map<string, Set<Visibility>>();
  scanReferences(source.snapshot, 'root', occurrences);
  rounds.forEach(data => scanReferences(data, 'round', occurrences));
  slideDocs.docs.forEach(doc => scanReferences(doc.data(), 'slide', occurrences));
  const bindings = new Map<string, LocalImageUse[]>();
  const excluded: LocalImageOmission[] = [];
  const seenOmissions = new Set<string>();
  const slides = new Map<number, PrivateSlide>();
  const add = (slide: PrivateSlide, publication: RecordData) => {
    for (const { reference, role } of publicImageSources(publication)) {
      if (!parseQuizAsset(reference)) {
        const key = `${slide.position}:${role}:external-source`;
        if (!seenOmissions.has(key)) {
          seenOmissions.add(key);
          excluded.push({ position: slide.position, role, reason: 'external-source' });
        }
        continue;
      }
      const uses = bindings.get(reference) ?? [];
      if (!uses.some(use => use.slidePosition === slide.position && use.role === role)) uses.push({ slidePosition: slide.position, role });
      bindings.set(reference, uses);
    }
  };
  for (const document of slideDocs.docs) {
    const slide = frozenSlide(document.id, document.data(), source.snapshot, rounds);
    if (slides.has(slide.position)) throw imageBackupUnavailable();
    slides.set(slide.position, slide);
    if (slide.hidden === true && canHideInfoSlide(slide)) continue;
    const session = previewSession(slide);
    add(slide, buildPublicSessionState(session, slide) as unknown as RecordData);
    // Build the revealed model only on the trusted server. No answer fields leave this boundary.
    try { add(slide, buildPublicSessionState({ ...session, answerRevealed: true }, slide) as unknown as RecordData); }
    catch { /* Slides without a valid answer have no supported answer-image use. */ }
  }
  const db = getFirestore();
  const references = [...bindings.keys()].sort();
  const assetRefs = references.flatMap(reference => {
    const parsed = parseQuizAsset(reference)!;
    return parsed.quizId === source.quizId ? [db.doc(`quizzes/${parsed.quizId}/mediaAssets/${parsed.assetId}`)] : [];
  });
  const assetDocs = assetRefs.length ? await tx.getAll(...assetRefs) : [];
  const byId = new Map(assetDocs.map(doc => [doc.ref.path, { ref: doc.ref, data: doc.data() }]));
  const candidates: ImageCandidate[] = [];
  for (const reference of references) {
    const uses = bindings.get(reference)!;
    const kinds = occurrences.get(reference) ?? new Set<Visibility>(['unknown']);
    const parsed = parseQuizAsset(reference)!;
    const answer = kinds.has('answer');
    if (answer && !answers && member) { excluded.push({ position: 0, role: 'answer-image', reason: 'private-export-denied' }); continue; }
    const omit = (reason: string) => uses.forEach(use => excluded.push({ position: use.slidePosition, role: use.role, reason }));
    if (kinds.has('unknown') || (answer && kinds.has('public'))) { omit('ambiguous-private-reference'); continue; }
    const stored = byId.get(`quizzes/${parsed.quizId}/mediaAssets/${parsed.assetId}`), asset = stored?.data;
    if (!asset || parsed.quizId !== source.quizId || asset.assetId !== parsed.assetId || asset.quizId !== source.quizId || asset.status !== 'ready'
      || asset.kind !== 'image' || asset.drive !== undefined || (asset.storageBackend !== undefined && asset.storageBackend !== 'storage')
      || !['image/png', 'image/jpeg', 'image/webp'].includes(String(asset.contentType))
      || typeof asset.generation !== 'string' || !/^[1-9]\d{0,19}$/u.test(asset.generation)) { omit('unsupported-image'); continue; }
    if (typeof asset.size !== 'number' || !Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > localImageBackupLimits.assetBytes) {
      throw new HttpsError('resource-exhausted', 'Obrázek překračuje limit 10 MiB.');
    }
    candidates.push({ reference, ref: stored.ref, metadata: asset, visibility: answer ? 'answer' : 'public', uses,
      generation: asset.generation, contentType: asset.contentType as LocalImageContentType, size: asset.size });
  }
  if (candidates.length > localImageBackupLimits.assets || candidates.reduce((sum, value) => sum + value.size, 0) > localImageBackupLimits.payloadBytes
    || candidates.reduce((sum, value) => sum + value.uses.length, 0) > localImageBackupLimits.uses || excluded.length > localImageBackupLimits.uses) {
    throw new HttpsError('resource-exhausted', 'Záloha překračuje limit 64 obrázků nebo 64 MiB.');
  }
  const scopeKey = member ? imageDigest(JSON.stringify(['local-image-backup-v3', member.uid, member.version, eventId, source.snapshotId])) : '';
  return { source, member, scopeKey, candidates, excluded, slides };
}

export function cachedLocalImage(candidate: ImageCandidate): LocalImageIdentity | undefined {
  const cached = imageRecord(candidate.metadata.localImageIntegrityV3);
  if (!cached || cached.reference !== candidate.reference || cached.generation !== candidate.generation || cached.contentType !== candidate.contentType
    || cached.size !== candidate.size || cached.etag !== imageEtag(candidate.reference, candidate.generation, candidate.contentType, candidate.size)
    || typeof cached.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(cached.sha256)
    || typeof cached.width !== 'number' || typeof cached.height !== 'number' || !Number.isSafeInteger(cached.width) || !Number.isSafeInteger(cached.height)
    || cached.width < 1 || cached.height < 1 || cached.width > localImageBackupLimits.dimension || cached.height > localImageBackupLimits.dimension
    || cached.width * cached.height > localImageBackupLimits.pixels) return;
  return { reference: candidate.reference, generation: candidate.generation, contentType: candidate.contentType, size: candidate.size,
    sha256: cached.sha256, width: cached.width, height: cached.height, etag: cached.etag };
}

export function buildLocalImageManifest(graph: Awaited<ReturnType<typeof readLocalImageGraph>>, eventId: string): LocalImageManifest {
  const assets: LocalImageAsset[] = [], missing: LocalImageOmission[] = [];
  for (const candidate of graph.candidates) {
    const identity = cachedLocalImage(candidate);
    if (identity) assets.push({ ...identity, visibility: candidate.visibility, uses: candidate.uses });
    else candidate.uses.forEach(use => missing.push({ position: use.slidePosition, role: use.role, reason: 'integrity-unavailable' }));
  }
  const base = { schemaVersion: 3 as const, eventId, snapshotId: graph.source.snapshotId, quizRevision: graph.source.quizRevision,
    validUntilMs: graph.source.validUntilMs, scopeKey: graph.scopeKey, assets, excluded: graph.excluded, missing };
  const result = { ...base, manifestId: imageDigest(JSON.stringify(base)) };
  if (Buffer.byteLength(JSON.stringify(result)) > localImageBackupLimits.headerBytes) throw imageBackupUnavailable();
  return result;
}
