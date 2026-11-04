import { eventDisposition, hasPermission, normalizeSlideDesign, normalizeResultTemplates, normalizePrintTemplate } from '@filmovy-kviz/quiz-domain';
import { assertEventReadable } from '../events/guards.js';
import { storedEventPricing } from '../events/pricing.js';
import { deletionInventory } from '../events/deletion.js';
import { FieldPath, getFirestore, Timestamp, type DocumentSnapshot, type Query, type Transaction } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { mapEditorQuiz, quizAssetReference, type Membership } from '@filmovy-kviz/quiz-domain';
import { slideView } from './slide-view.js';
export { slideView } from './slide-view.js';
import { authorize, freshIdentity, type AuthIdentity, type Resource } from './authorization.js';
import { quizDisposition, quizTrashRevision } from '../quizzes/guards.js';
import { loadSnapshotClipAssets } from '../media/snapshot-clip-store.js';
import { resolveSnapshotClip } from '../media/snapshot-clips.js';

const db = () => getFirestore();
export function pick(data: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter(k => data[k] === null || data[k] instanceof Timestamp || ['string', 'boolean', 'number'].includes(typeof data[k])).map(k => [k, data[k]]));
}
export function wire(value: unknown): unknown {
  if (value instanceof Timestamp) return { $timestamp: value.toMillis() };
  if (Array.isArray(value)) return value.map(wire);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, wire(v)]));
  return value;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 1500 || value.includes('/')) throw new HttpsError('invalid-argument', 'Neplatný identifikátor.');
  return value;
}
function stored(doc: DocumentSnapshot) {
  const data = doc.data();
  if (!data) throw new HttpsError('not-found', 'Obsah není dostupný.');
  return data;
}
const quizFields = ['title', 'description', 'status', 'revision', 'disposition', 'trashedAt', 'trashedBy', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'roundCount', 'questionCount', 'slideCount'];
const roundFields = ['title', 'type', 'position', 'questionCount', 'slideCount'];
const eventFields = ['description', 'disposition', 'previousDisposition', 'trashedAt', 'archivedAt', 'title', 'startsAt', 'timeZone', 'teamCapacity', 'peopleCapacity', 'teamSizeMin', 'teamSizeMax', 'acceptedTeams', 'acceptedPeople', 'registrationPublished', 'registrationOpensAt', 'registrationClosesAt', 'registrationStatus', 'lifecycleStatus', 'revision', 'liveSessionId', 'createdBy'];
function eventView(data: Record<string, unknown>, member: Membership) {
  return { ...pick(data, eventFields), pricing: storedEventPricing(data.pricing), cancellation: data.cancellation ? pick(data.cancellation as Record<string, unknown>, ['at', 'by', 'publicMessage', ...(hasPermission(member, 'event.manage') || hasPermission(member, 'event.notes.read') ? ['reason'] : [])]) : null, venue: pick((data.venue ?? {}) as Record<string, unknown>, ['name', 'publicLocation']),
    scoring: pick((data.scoring ?? {}) as Record<string, unknown>, ['unitScale', 'rankingMode', 'started']),
    quizAssignment: data.quizAssignment ? pick(data.quizAssignment as Record<string, unknown>, ['quizId', 'quizRevision', 'snapshotId', 'quizTitle', 'roundCount', 'questionCount', 'lockedAt']) : null };
}
async function scopedList(tx: Transaction, kind: 'quiz' | 'event', member: Membership) {
  const scope = kind === 'quiz' ? member.quizzes : member.events;
  const collection = db().collection(kind === 'quiz' ? 'quizzes' : 'events');
  if (scope.mode === 'none' || (scope.mode === 'selected' && !scope.ids.length)) return [];
  if (scope.mode === 'selected') {
    const docs = await tx.getAll(...scope.ids.map(value => collection.doc(value)));
    return docs.filter(d => d.exists);
  }
  const query: Query = scope.mode === 'own' ? collection.where('createdBy', '==', member.uid) : collection;
  const result = await tx.get(query.limit(501));
  if (result.size > 500) throw new HttpsError('resource-exhausted', 'Knihovna je příliš velká pro tento přehled.');
  return result.docs;
}
/** An event authorizes only its assigned immutable snapshot, never the source quiz. */
export async function snapshotResource(auth: AuthIdentity, snapshotId: string, tx: Transaction): Promise<Resource> {
  const matches = await tx.get(db().collection('events').where('quizAssignment.snapshotId', '==', snapshotId).limit(2));
  if (matches.size !== 1) throw new HttpsError('permission-denied', 'Připravený kvíz není dostupný.');
  const resource: Resource = { kind: 'event', id: matches.docs[0]!.id };
  const member = await authorize(auth, ['event.read'], resource, tx);
  assertEventReadable(matches.docs[0]!.data(), member);
  return resource;
}
export const readAccessData = onCall({ region: 'europe-west1', cors: true, maxInstances: 20 }, async request => {
  await freshIdentity(request.auth);
  const data = request.data as Record<string, unknown>;
  if (!data || typeof data.operation !== 'string') throw new HttpsError('invalid-argument', 'Chybí typ načtení.');
  return db().runTransaction(async tx => {
    if (data.operation === 'eventPage') {
      const member = await authorize(request.auth, ['event.read'], undefined, tx), scope = member.events;
      const cursor = data.afterId === undefined ? undefined : id(data.afterId);
      if (scope.mode === 'none' || (scope.mode === 'selected' && scope.ids.length === 0)) return { items: [], nextCursor: null };
      let docs: DocumentSnapshot[];
      if (scope.mode === 'selected') {
        const ids = [...scope.ids].sort().filter(value => cursor === undefined || value > cursor).slice(0, 101);
        docs = ids.length ? await tx.getAll(...ids.map(value => db().doc('events/' + value))) : [];
      } else {
        let query: Query = db().collection('events');
        if (scope.mode === 'own') query = query.where('createdBy', '==', member.uid);
        query = query.orderBy(FieldPath.documentId());
        if (cursor) query = query.startAfter(cursor);
        docs = (await tx.get(query.limit(101))).docs;
      }
      const page = docs.slice(0, 100);
      return wire({ items: page.filter(d => d.exists && (!['trash', 'deleting'].includes(eventDisposition(d.data()!)) || hasPermission(member, 'event.manage') || hasPermission(member, 'event.delete'))).map(d => ({ id: d.id, data: eventView(stored(d), member) })), nextCursor: docs.length > 100 ? page.at(-1)!.id : null });
    }
    if (data.operation === 'quizzes' || data.operation === 'events') {
      const kind = data.operation === 'quizzes' ? 'quiz' : 'event';
      const member = await authorize(request.auth, [kind === 'quiz' ? 'quiz.read' : 'event.read'], undefined, tx);
      if (kind === 'quiz' && data.includeTrash !== undefined && typeof data.includeTrash !== 'boolean') throw new HttpsError('invalid-argument', 'Neplatný výběr koše.');
      if (kind === 'quiz' && data.includeTrash === true && !hasPermission(member, 'quiz.delete')) throw new HttpsError('permission-denied', 'K zobrazení koše nemáte oprávnění.');
      const docs = await scopedList(tx, kind, member);
      return wire(docs.filter(d => kind === 'quiz' ? data.includeTrash === true || quizDisposition(stored(d)) !== 'trash' : !['trash', 'deleting'].includes(eventDisposition(d.data()!)) || hasPermission(member, 'event.manage') || hasPermission(member, 'event.delete')).map(d => ({ id: d.id, data: kind === 'quiz' ? { ...pick(stored(d), quizFields), disposition: quizDisposition(stored(d)), revision: quizTrashRevision(stored(d)) } : eventView(stored(d), member) })));
    }
    if (['editor', 'quiz', 'quizSlides', 'mediaAssets'].includes(String(data.operation))) {
      const quizId = id(data.quizId), resource: Resource = { kind: 'quiz', id: quizId };
      const member = await authorize(request.auth, ['quiz.read'], resource, tx);
      const ref = db().doc(`quizzes/${quizId}`), root = stored(await tx.get(ref));
      const slides = await tx.get(ref.collection('slides').orderBy('position').limit(401));
      if (slides.size > 400) throw new HttpsError('resource-exhausted', 'Kvíz je příliš velký.');
      const mapped = slides.docs.map(d => slideView(d.id, d.data(), member.permissions.includes('quiz.answers.read'), member.permissions.includes('quiz.notes.read')));
      if (data.operation === 'quizSlides') return wire(mapped);
      if (data.operation === 'mediaAssets') {
        const assets = await tx.get(ref.collection('mediaAssets').limit(201));
        if (assets.size > 200) throw new HttpsError('resource-exhausted', 'Příliš mnoho médií.');
        const defaults = normalizeSlideDesign(root.defaultDesign), templates = normalizeResultTemplates(root.resultTemplates);
        const visibleSources = new Set([normalizePrintTemplate(root.printTemplate).logoImage, defaults.backgroundImage, defaults.logoImage, templates.interim?.design?.backgroundImage, templates.interim?.design?.logoImage, templates.final?.design?.backgroundImage, templates.final?.design?.logoImage, ...mapped.flatMap(s => [s.backgroundImage, s.questionImage, s.answerImage, s.mediaSource, s.design?.backgroundImage, s.design?.logoImage, s.answerDesign?.backgroundImage, s.answerDesign?.logoImage, ...s.media.map(m => m.source)])]);
        return wire(assets.docs.filter(d => member.permissions.includes('quiz.answers.read') || visibleSources.has(quizAssetReference(quizId, d.id))).map(d => ({ id: d.id, data: pick(d.data(), ['quizId', 'assetId', 'kind', 'contentType', 'size', 'status', 'createdBy', 'createdAt', 'generation']) })));
      }
      const rounds = await tx.get(ref.collection('rounds').orderBy('position').limit(401));
      const titles = new Map(rounds.docs.map(d => [d.id, String(d.data().title ?? '')]));
      if (data.operation === 'editor') return wire(mapEditorQuiz(quizId, root, mapped.map(s => s.roundTitle !== undefined || !s.roundId ? s : { ...s, roundTitle: titles.get(s.roundId) })));
      const roundViews = [];
      for (const round of rounds.docs) {
        const questions = await tx.get(round.ref.collection('questions').orderBy('position').limit(401));
        roundViews.push({ id: round.id, data: pick(round.data(), roundFields), questions: questions.docs.map(q => ({ id: q.id, data: pick(q.data(), ['prompt', 'type', 'position']) })) });
      }
      return wire({ id: quizId, data: pick(root, quizFields), rounds: roundViews });
    }
    if (data.operation === 'snapshotRounds' || data.operation === 'snapshotSlides') {
      const snapshotId = id(data.snapshotId), resource = await snapshotResource(request.auth, snapshotId, tx);
      const member = await authorize(request.auth, ['event.read'], resource, tx);
      const rows = await tx.get(db().collection(`quizSnapshots/${snapshotId}/${data.operation === 'snapshotRounds' ? 'rounds' : 'slides'}`).orderBy('position').limit(401));
      if (data.operation === 'snapshotRounds') return wire(rows.docs.map(d => ({ id: d.id, data: pick(d.data(), roundFields) })));
      if (rows.size > 400) throw new HttpsError('resource-exhausted', 'Kvíz je příliš velký.');
      const root = stored(await tx.get(db().doc(`quizSnapshots/${snapshotId}`)));
      const quizId = id(root.quizId);
      const assets = await loadSnapshotClipAssets(tx, db(), quizId, rows.docs.map(d => d.data()));
      return wire(rows.docs.map(d => slideView(d.id, resolveSnapshotClip(quizId, d.data(), assets), member.permissions.includes('event.answers.read'), member.permissions.includes('event.notes.read'))));
    }
    if (['event', 'registrations', 'roster', 'eventManagement'].includes(String(data.operation))) {
      const eventId = id(data.eventId), resource: Resource = { kind: 'event', id: eventId };
      const member = await authorize(request.auth, data.operation === 'registrations' ? ['event.read', 'event.contacts'] : ['event.read'], resource, tx);
      const ref = db().doc(`events/${eventId}`);
      const root = stored(await tx.get(ref));
      assertEventReadable(root, member, data.operation === 'event' || data.operation === 'eventManagement');
      if (data.operation === 'eventManagement') {
        if (!hasPermission(member, 'event.manage') && !hasPermission(member, 'event.delete')) throw new HttpsError('permission-denied', 'Chybí právo správy akce.');
        return wire(await deletionInventory(eventId));
      }
      if (data.operation === 'event') return wire({ id: eventId, data: eventView(stored(await tx.get(ref)), member) });
      const rows = await tx.get(ref.collection('registrations').limit(1001));
      if (rows.size > 1000) throw new HttpsError('resource-exhausted', 'Příliš mnoho týmů.');
      return wire(rows.docs.map(d => ({ id: d.id, data: {
        ...pick(d.data(), data.operation === 'roster' ? ['teamName', 'status'] : ['eventId', 'teamName', 'memberCount', 'contactEmail', 'source', 'revision', 'status', 'createdAt', 'updatedAt', 'cancelledAt']),
        ...(data.operation === 'registrations' && d.data().emailDelivery ? { emailDelivery: pick(d.data().emailDelivery as Record<string, unknown>, ['status', 'updatedAt']) } : {}),
      } })));
    }
    throw new HttpsError('invalid-argument', 'Neznámý typ načtení.');
  });
});
