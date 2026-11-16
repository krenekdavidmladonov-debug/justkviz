import { getFirestore, Timestamp, type Transaction } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { parseSession } from './callables.js';
import { applyLiveSessionAction } from './session-machine.js';
import { buildPublicSessionState } from './publication.js';
// Called before event writes, in that same transaction. Public results never survive closure.
export async function eventSessions(tx: Transaction, eventId: string, allowMissingPointer = false) {
  const rows = await tx.get(getFirestore().collection('sessions').where('eventId', '==', eventId).limit(201));
  if (rows.size > 200) throw new HttpsError('resource-exhausted', 'Akce má příliš mnoho relací pro bezpečné atomické uzavření.');
  const event = (await tx.get(getFirestore().doc('events/' + eventId))).data();
  if (typeof event?.liveSessionId === 'string' && !rows.docs.some(d => d.id === event.liveSessionId)) {
    const pointer = await tx.get(getFirestore().doc('sessions/' + event.liveSessionId));
    if (pointer.exists || !allowMissingPointer) throw new HttpsError('failed-precondition', 'Vazba živé relace je poškozená. Akci nelze bezpečně změnit bez opravy vazby.');
    const references = await tx.get(getFirestore().collection('events').where('liveSessionId', '==', event.liveSessionId).limit(2));
    if (references.docs.some(d => d.id !== eventId)) throw new HttpsError('failed-precondition', 'Osiřelá relace je sdílená; vlastnictví není jednoznačné.');
  }
  return rows.docs.map(doc => ({ ref: doc.ref, session: parseSession(doc) }));
}
export function closeSessions(tx: Transaction, sessions: Awaited<ReturnType<typeof eventSessions>>, actorUid: string) {
  for (const { ref, session } of sessions) {
    const { interimResults, interimReturn, showCue, ...clean } = session;
    void interimResults; void interimReturn; void showCue;
    // The confirmed private version is historical authority, independent of publication.
    const hidden = { ...clean, ...(session.finalReveal ? { finalReveal: { ...session.finalReveal, visible: false } } : {}) };
    const ended = session.status === 'ended' ? hidden : applyLiveSessionAction(hidden, { type: 'end-session' }, session.revision, actorUid, Timestamp.now());
    tx.set(ref, ended);
    tx.set(getFirestore().doc('publicSessions/' + session.sessionId), buildPublicSessionState(ended));
  }
}
export async function closeEventPresentation(tx: Transaction, eventId: string, actorUid: string): Promise<void> {
  closeSessions(tx, await eventSessions(tx, eventId), actorUid);
}
