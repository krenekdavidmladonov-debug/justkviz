import { eventDisposition } from '@filmovy-kviz/quiz-domain';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { accessActor, runAccessTransaction, securedOnCall } from '../access/authorization.js';
import { expectedRevision, isObject, requiredId, requestedBoolean } from './validation.js';

const unavailable = () => new HttpsError('failed-precondition', 'Chybí potvrzené konečné výsledky dokončené akce.');
const documentId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 1500 && !value.includes('/');
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\p{Cc}\p{Cf}]/u.test(value)) throw unavailable();
  return value;
}

/** Whole immutable confirmed version, never a currently revealed page or mutable scores. */
export function publicResultsProjection(eventId: string, event: Record<string, unknown>, session: Record<string, unknown>, version: Record<string, unknown>) {
  const assignment = event.quizAssignment, reveal = session.finalReveal;
  if (event.lifecycleStatus !== 'completed' || eventDisposition(event) !== 'active'
    || !documentId(event.liveSessionId) || !isObject(assignment) || !documentId(assignment.snapshotId)
    || session.status !== 'ended' || session.sessionId !== event.liveSessionId || session.eventId !== eventId || session.snapshotId !== assignment.snapshotId
    || !isObject(reveal) || !hash(reveal.versionId) || version.versionId !== reveal.versionId
    || version.eventId !== eventId || version.sessionId !== event.liveSessionId || version.snapshotId !== assignment.snapshotId
    || !hash(version.sourceFingerprint) || !(version.createdAt instanceof Timestamp)) throw unavailable();
  if (!Array.isArray(version.rows) || !version.rows.length || version.rows.length > 1000) throw unavailable();
  let rank = 0, previousPoints = Number.POSITIVE_INFINITY;
  const rows = version.rows.map(value => {
    if (!isObject(value) || !Number.isSafeInteger(value.halfPoints) || Number(value.halfPoints) < 0 || Number(value.halfPoints) > previousPoints) throw unavailable();
    const halfPoints = Number(value.halfPoints);
    if (halfPoints !== previousPoints) rank++;
    if (value.rank !== rank) throw unavailable();
    previousPoints = halfPoints;
    return { rank, teamName: text(value.teamName, 80), halfPoints };
  });
  if (!(event.startsAt instanceof Timestamp) || !isObject(event.venue)) throw unavailable();
  return {
    eventId, title: text(event.title, 300), startsAt: event.startsAt, timeZone: text(event.timeZone, 100),
    venueName: text(event.venue.name, 300), publicLocation: text(event.venue.publicLocation, 1000),
    lifecycleStatus: 'completed' as const, rows,
  };
}

export const configurePublicEventResults = securedOnCall('configurePublicEventResults', { region:'europe-west1', cors:true, maxInstances:10 }, async request => {
  const actor = accessActor(request.auth);
  const data:unknown = request.data;
  if (!isObject(data) || Object.keys(data).some(key => !['eventId', 'expectedRevision', 'published'].includes(key))) throw new HttpsError('invalid-argument', 'Nepovolená pole.');
  const eventId = requiredId(data, 'eventId'), expected = expectedRevision(data), published = requestedBoolean(data, 'published');
  const db = getFirestore(), eventRef = db.doc('events/' + eventId), publicRef = db.doc('publicEventResults/' + eventId);
  return runAccessTransaction(db, async tx => {
    const event = (await tx.get(eventRef)).data();
    if (!event) throw new HttpsError('not-found', 'Akce není dostupná.');
    if (event.revision !== expected) throw new HttpsError('aborted', 'Akci změnil jiný správce. Načtěte aktuální stav.');
    let projection;
    if (published) {
      if (!documentId(event.liveSessionId)) throw unavailable();
      const session = (await tx.get(db.doc('sessions/' + event.liveSessionId))).data();
      const reveal:unknown = session?.finalReveal;
      if (!session || !isObject(reveal) || !hash(reveal.versionId)) throw unavailable();
      const version = (await tx.get(db.doc(`sessions/${event.liveSessionId}/finalVersions/${reveal.versionId}`))).data();
      if (!version) throw unavailable();
      projection = publicResultsProjection(eventId, event, session, version);
    }
    const revision = expected + 1, now = Timestamp.now();
    if (projection) tx.set(publicRef, projection); else tx.delete(publicRef);
    tx.update(eventRef, { revision, updatedAt:now, updatedBy:actor.uid });
    tx.create(db.collection('eventAudit').doc(), { eventId, action:published ? 'publish-final-results' : 'hide-final-results', actorUid:actor.uid, revision, at:now });
    return { eventId, revision, published };
  });
});
