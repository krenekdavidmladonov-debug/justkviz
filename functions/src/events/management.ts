import { createHash } from 'node:crypto';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { eventDisposition, transitionProblem, type EventManagementAction } from '@filmovy-kviz/quiz-domain';
import { accessActor, runAccessTransaction, securedOnCall } from '../access/authorization.js';
import { closeSessions, eventSessions } from '../live/event-lifecycle.js';
import { expectedRevision, isObject, requiredId } from './validation.js';
import { publicEventPricing } from './pricing.js';
const options = { region: 'europe-west1', cors: true, maxInstances: 10 };
export const operationHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function text(value: unknown, maximum: number) {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > maximum || /[\p{Cf}]/u.test(value)) throw new HttpsError('invalid-argument', 'Poznámka nebo zpráva je neplatná.');
  return value.trim();
}
async function transition(request: CallableRequest, action: EventManagementAction) {
  const actor = accessActor(request.auth), data = request.data as Record<string, unknown>;
  const eventId = requiredId(data, 'eventId'), expected = expectedRevision(data);
  const requestId = data.requestId === undefined ? `legacy_${action}_${expected}` : requiredId(data, 'requestId');
  if (requestId.length > 100) throw new HttpsError('invalid-argument', 'Neplatný identifikátor operace.');
  const note = text(data.reason, 2000), publicMessage = text(data.publicMessage, 1000);
  const db = getFirestore(), ref = db.doc(`events/${eventId}`);
  const key = operationHash([actor.uid, eventId, requestId]);
  const receiptRef = ref.collection('eventOperations').doc(key);
  const fingerprint = operationHash([action, expected, note, publicMessage, data.endLive === true]);
  return runAccessTransaction(db, async tx => {
    const current: Record<string, unknown> | undefined = (await tx.get(ref)).data();
    if (!current) throw new HttpsError('not-found', 'Akce není dostupná.');
    const receipt = (await tx.get(receiptRef)).data() as { fingerprint: string; response: Record<string, unknown> } | undefined;
    if (receipt) {
      if (receipt.fingerprint !== fingerprint) throw new HttpsError('already-exists', 'Tato operace už měla jiný obsah.');
      return receipt.response;
    }
    if (current.revision !== expected) throw new HttpsError('aborted', 'Akci změnil jiný správce. Načtěte aktuální podobu; formulář zůstal zachovaný.');
    const sessions = await eventSessions(tx, eventId);
    const active = sessions.some(s => s.session.status !== 'ended');
    const problem = transitionProblem({ ...current, scoring: isObject(current.scoring) ? current.scoring : {}, hasActiveSession: active }, action);
    if (problem) throw new HttpsError('failed-precondition', problem);
    if (active && !((action === 'cancel' || action === 'complete') && data.endLive === true)) throw new HttpsError('failed-precondition', 'Běží živá relace. Výslovně potvrďte i ukončení prezentace.');
    if (action === 'prepare' && sessions.some(s => s.session.startedAt !== null)) throw new HttpsError('failed-precondition', 'Odehranou akci nelze vrátit do přípravy.');
    const publicRef = db.doc(`publicEvents/${eventId}`), previousPublic = (await tx.get(publicRef)).data();
    const now = Timestamp.now(), revision = expected + 1;
    const patch: Record<string, unknown> = { revision, updatedAt: now, updatedBy: actor.uid };
    if (action === 'cancel') Object.assign(patch, { lifecycleStatus: 'cancelled', cancellation: { at: now, by: actor.uid, reason: note, publicMessage }, capabilityVersion: Number(current.capabilityVersion ?? 0) + 1 });
    if (action === 'complete') Object.assign(patch, { lifecycleStatus: 'completed', completion: { at: now, by: actor.uid, reason: note }, capabilityVersion: Number(current.capabilityVersion ?? 0) + 1 });
    if (action === 'prepare') Object.assign(patch, { lifecycleStatus: current.quizAssignment ? 'ready' : 'scheduled', liveSessionId: FieldValue.delete() });
    if (action === 'archive') Object.assign(patch, { disposition: 'archived', archivedAt: now, archivedBy: actor.uid });
    if (action === 'unarchive') {
      // Legacy outcome was lost before this release: preserve its terminal label and read-only behavior.
      Object.assign(patch, { disposition: 'active' });
    }
    if (action === 'trash') Object.assign(patch, { disposition: 'trash', previousDisposition: eventDisposition(current), trashedAt: now, trashedBy: actor.uid, capabilityVersion: Number(current.capabilityVersion ?? 0) + 1 });
    if (action === 'restore') {
      Object.assign(patch, { disposition: current.previousDisposition === 'archived' ? 'archived' : 'active' });
      // A completed event's ended session is the authority for its confirmed history.
      if (current.lifecycleStatus !== 'completed') patch.liveSessionId = FieldValue.delete();
    }
    Object.assign(patch, { registrationStatus: 'closed', registrationPublished: false });
    if (action === 'cancel' || action === 'complete' || action === 'trash') closeSessions(tx, sessions, actor.uid);
    tx.update(ref, patch);
    if (action === 'cancel' && previousPublic) tx.set(publicRef, { ...previousPublic, pricing: publicEventPricing(current.pricing), lifecycleStatus: 'cancelled', registrationPublished: false, registrationStatus: 'closed', availability: 'closed', cancelled: true, cancellationMessage: publicMessage, revision, updatedAt: now });
    else if (action === 'archive' && previousPublic) tx.set(publicRef, { ...previousPublic, pricing: publicEventPricing(current.pricing), registrationPublished: false, registrationStatus: 'closed', availability: 'closed', revision, updatedAt: now });
    else if (action === 'complete' || action === 'trash' || action === 'prepare' || action === 'restore') tx.delete(publicRef);
    const response = { eventId, revision, lifecycleStatus: patch.lifecycleStatus ?? current.lifecycleStatus, disposition: patch.disposition ?? eventDisposition(current), registrationStatus: 'closed' };
    tx.create(receiptRef, { fingerprint, response, at: now });
    tx.create(db.doc(`eventAudit/${key}`), { eventId, actorUid: actor.uid, action, revision, at: now });
    return response;
  });
}
export const cancelEvent = securedOnCall('cancelEvent', options, request => transition(request, 'cancel'));
export const completeEvent = securedOnCall('completeEvent', options, request => transition(request, 'complete'));
export const archiveEvent = securedOnCall('archiveEvent', options, request => transition(request, 'archive'));
export const trashEvent = securedOnCall('trashEvent', options, request => transition(request, 'trash'));
export const restoreEvent = securedOnCall('restoreEvent', options, request => {
  const action: unknown = (request.data as Record<string, unknown> | undefined)?.action;
  if (action !== 'prepare' && action !== 'unarchive' && action !== 'restore') throw new HttpsError('invalid-argument', 'Neplatná obnova.');
  return transition(request, action);
});
