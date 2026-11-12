import { getFirestore, Timestamp, type DocumentReference, type Transaction } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { eventDisposition } from '@filmovy-kviz/quiz-domain';
import { accessActor, runAccessTransaction, securedOnCall } from '../access/authorization.js';
import { eventSessions } from '../live/event-lifecycle.js';
import { expectedRevision, requiredId } from './validation.js';
import { operationHash } from './management.js';

/** Exact server-owned schema. Library quizzes, Storage, identities and global limiters are never targets. */
export const eventDeletionCollections = ['registrations', 'registrationNames', 'registrationAbuse', 'registrationOperations', 'scores', 'scoreOperations', 'refereeAccess', 'emailIntents', 'emailSecrets', 'emailCampaigns', 'eventOperations'] as const;
export const sessionDeletionCollections = ['interimVersions', 'interimOperations', 'finalVersions', 'finalOperations'] as const;
const snapshotCollections = ['slides', 'rounds'] as const;
type Target = { path: string; kind: 'collection' | 'scores' | 'document' };
interface Plan { targets: Target[]; sessionIds: string[]; snapshotIds: string[]; retainedSnapshotIds: string[] }
async function assertChildren(ref: DocumentReference, allowed: readonly string[]) {
  const actual = await ref.listCollections();
  if (actual.some(c => !allowed.includes(c.id))) throw new HttpsError('failed-precondition', 'Nalezena neznámá podkolekce. Mazání je pozastavené; je nutná kontrola schématu.');
}
async function planIn(tx: Transaction, eventId: string, event: Record<string, unknown>, requireEnded = true): Promise<Plan> {
  const db = getFirestore();
  const sessions = await eventSessions(tx, eventId, true);
  if (requireEnded && sessions.some(s => s.session.status !== 'ended')) throw new HttpsError('failed-precondition', 'Aktivní relaci nelze smazat. Nejprve ji ukončete.');
  const owned = await tx.get(db.collection('quizSnapshots').where('eventId', '==', eventId).limit(1001));
  if (owned.size > 1000) throw new HttpsError('resource-exhausted', 'Akce překračuje limit 1000 snapshotů pro plán odstranění.');
  const assignment = event.quizAssignment as { snapshotId?: string } | undefined;
  const candidates = new Set([...owned.docs.map(d => d.id), ...sessions.map(s => s.session.snapshotId).filter((id): id is string => typeof id === 'string'), ...(assignment?.snapshotId ? [assignment.snapshotId] : [])]);
  const snapshotIds: string[] = [], retainedSnapshotIds: string[] = [];
  for (const snapshotId of candidates) {
    const snapshot = (await tx.get(db.doc(`quizSnapshots/${snapshotId}`))).data();
    const events = await tx.get(db.collection('events').where('quizAssignment.snapshotId', '==', snapshotId).limit(3));
    const references = await tx.get(db.collection('sessions').where('snapshotId', '==', snapshotId).limit(201));
    const exclusive = events.docs.every(d => d.id === eventId) && references.size <= 200 && references.docs.every(d => d.data().eventId === eventId);
    // Legacy snapshots are attributed only by exact assignment/session references, never their quiz or filename.
    const belongs = snapshot?.eventId === eventId || (snapshot?.eventId === undefined && (assignment?.snapshotId === snapshotId || sessions.some(s => s.session.snapshotId === snapshotId)));
    (exclusive && belongs ? snapshotIds : retainedSnapshotIds).push(snapshotId);
  }
  const sessionIds = [...new Set([...sessions.map(s => s.session.sessionId), ...(typeof event.liveSessionId === 'string' ? [event.liveSessionId] : [])])];
  if (typeof event.liveSessionId === 'string') { const pointer = (await tx.get(db.doc('sessions/' + event.liveSessionId))).data(); if (pointer && pointer.eventId !== eventId) throw new HttpsError('failed-precondition', 'Neplatná vazba relace.'); }
  const targets: Target[] = eventDeletionCollections.map(name => ({ path: `events/${eventId}/${name}`, kind: name === 'scores' ? 'scores' : 'collection' }));
  for (const id of sessionIds) {
    for (const name of sessionDeletionCollections) targets.push({ path: `sessions/${id}/${name}`, kind: 'collection' });
    targets.push({ path: `publicSessions/${id}`, kind: 'document' }, { path: `sessions/${id}`, kind: 'document' });
  }
  for (const id of snapshotIds) {
    for (const name of snapshotCollections) targets.push({ path: `quizSnapshots/${id}/${name}`, kind: 'collection' });
    targets.push({ path: `quizSnapshots/${id}`, kind: 'document' });
  }
  targets.push({ path: `publicEvents/${eventId}`, kind: 'document' });
  return { targets, sessionIds, snapshotIds, retainedSnapshotIds };
}
async function validateRoots(eventId: string, plan: Plan) {
  const db = getFirestore();
  await assertChildren(db.doc(`events/${eventId}`), eventDeletionCollections);
  for (const id of plan.sessionIds) await assertChildren(db.doc(`sessions/${id}`), sessionDeletionCollections);
  for (const id of plan.snapshotIds) await assertChildren(db.doc(`quizSnapshots/${id}`), snapshotCollections);
}
/** Scope and membership are checked by readAccessData before and after this inventory. */
export async function deletionInventory(eventId: string) {
  const db = getFirestore(), root = db.doc(`events/${eventId}`);
  const event: Record<string, unknown> | undefined = (await root.get()).data();
  if (!event) throw new HttpsError('not-found', 'Akce není dostupná.');
  const counts: Record<string, number> = {};
  for (const collection of eventDeletionCollections) counts[collection] = (await root.collection(collection).count().get()).data().count;
  let history = 0;
  const scores = await root.collection('scores').listDocuments();
  for (const score of scores) history += (await score.collection('history').count().get()).data().count;
  counts.scoreHistory = history;
  const plan = await db.runTransaction(tx => planIn(tx, eventId, event, false));
  let sessionChildren = 0, snapshotChildren = 0;
  for (const sessionId of plan.sessionIds) for (const child of sessionDeletionCollections) sessionChildren += (await db.collection('sessions/' + sessionId + '/' + child).count().get()).data().count;
  for (const snapshotId of plan.snapshotIds) for (const child of snapshotCollections) snapshotChildren += (await db.collection('quizSnapshots/' + snapshotId + '/' + child).count().get()).data().count;
  counts.sessionChildren = sessionChildren; counts.snapshotChildren = snapshotChildren; counts.retainedSharedSnapshots = plan.retainedSnapshotIds.length;
  const job: Record<string, unknown> | undefined = (await db.doc(`eventDeletions/${eventId}`).get()).data();
  return { counts, sessions: plan.sessionIds.length, ownedSnapshots: plan.snapshotIds.length, libraryPreserved: true, storageObjects: 0,
    progress: job ? { state: job.state, deletedCount: job.deletedCount, phase: job.phase, totalPhases: (job.targets as unknown[] | undefined)?.length ?? 0, error: job.error ?? null, retainedSnapshots: (job.retainedSnapshotIds as string[] | undefined)?.length ?? 0 } : null };
}
async function batch(eventId: string) {
  const db = getFirestore(), ref = db.doc(`events/${eventId}`), jobRef = db.doc(`eventDeletions/${eventId}`);
  // Schema discovery cannot be transactional; all app writers share the event lock. Check again before every affected leaf deletion.
  const inspected = (await jobRef.get()).data();
  if (!inspected || inspected.state === 'complete') return true;
  const target = (inspected.targets as Target[])[Number(inspected.phase)];
  let candidates: DocumentReference[] = [], history: DocumentReference[] = [];
  if (target && target.kind !== 'document') {
    candidates = (await db.collection(target.path).listDocuments()).slice(0, target.kind === 'scores' ? 1 : 100);
    for (const doc of candidates) {
      await assertChildren(doc, target.kind === 'scores' ? ['history'] : []);
      if (target.kind === 'scores') {
        history = (await doc.collection('history').listDocuments()).slice(0, 100);
        for (const child of history) await assertChildren(child, []);
      }
    }
  } else if (target) {
    await assertChildren(db.doc(target.path), []);
  } else await assertChildren(ref, []);
  return runAccessTransaction(db, async tx => {
    const event: Record<string, unknown> | undefined = (await tx.get(ref)).data(); const job: Record<string, unknown> | undefined = (await tx.get(jobRef)).data();
    if (job?.state === 'complete') return true;
    if (!event || eventDisposition(event) !== 'deleting' || !job) throw new HttpsError('failed-precondition', 'Chybí zámek mazání.');
    if (job.phase !== inspected.phase || job.deletedCount !== inspected.deletedCount) return false;
    const phase = Number(job.phase), deleted = Number(job.deletedCount);
    const current = (job.targets as Target[])[phase];
    const now = Timestamp.now();
    if (!current) {
      // Root last; retain only ID, immutable owner, revision and technical audit, never title/contacts/answers.
      tx.delete(ref);
      tx.create(db.doc(`eventTombstones/${eventId}`), { eventId, createdBy: event.createdBy, revision: event.revision, deletedAt: now });
      tx.set(jobRef, { eventId, state: 'complete', deletedCount: deleted + 1, phase, completedAt: now, retainedSnapshots: (job.retainedSnapshotIds as string[]).length });
      tx.create(db.doc(`eventAudit/${operationHash([eventId, 'deleted'])}`), { eventId, action: 'deleted', actorUid: job.actorUid, at: now });
      return true;
    }
    let refs: DocumentReference[] = []; let advance: boolean;
    if (current.kind === 'document') { const snapshot = await tx.get(db.doc(current.path)); if (snapshot.exists) refs = [snapshot.ref]; advance = true; }
    else {
      advance = candidates.length === 0;
      if (candidates.length) await tx.getAll(...candidates);
      if (current.kind === 'scores' && candidates.length) {
        if (history.length) await tx.getAll(...history);
        refs = history.length ? history : [candidates[0]!];
      } else refs = candidates;
    }
    for (const item of refs) tx.delete(item);
    tx.update(jobRef, { phase: phase + (advance ? 1 : 0), deletedCount: deleted + refs.length, state: 'running', error: null, updatedAt: now });
    return false;
  });
}
export const deleteEvent = securedOnCall('deleteEvent', { region: 'europe-west1', cors: true, timeoutSeconds: 300, maxInstances: 5 }, async request => {
  const actor = accessActor(request.auth), eventId = requiredId(request.data, 'eventId'), expected = expectedRevision(request.data);
  const authTime = Number(request.auth?.token.auth_time);
  if (!Number.isFinite(authTime) || authTime < Date.now() / 1000 - 300 || authTime > Date.now() / 1000 + 30) throw new HttpsError('unauthenticated', 'Pro trvalé smazání znovu ověřte své heslo.');
  const db = getFirestore(), ref = db.doc(`events/${eventId}`), jobRef = db.doc(`eventDeletions/${eventId}`);
  await runAccessTransaction(db, async tx => {
    const event = (await tx.get(ref)).data(), job = (await tx.get(jobRef)).data();
    if (job?.state === 'complete') return;
    if (!event || !['trash', 'deleting'].includes(eventDisposition(event))) throw new HttpsError('failed-precondition', 'Trvale smazat lze pouze akci z koše.');
    if (event.revision !== expected) throw new HttpsError('aborted', 'Akce se změnila. Zkontrolujte aktuální stav.');
    if ((request.data as Record<string, unknown>).confirmTitle !== event.title) throw new HttpsError('invalid-argument', 'Opište přesný název akce.');
    if (job) return;
    const plan = await planIn(tx, eventId, event);
    await validateRoots(eventId, plan);
    const now = Timestamp.now();
    tx.update(ref, { disposition: 'deleting', registrationPublished: false, registrationStatus: 'closed', revision: expected + 1, updatedAt: now, updatedBy: actor.uid });
    tx.create(jobRef, { ...plan, eventId, actorUid: actor.uid, state: 'running', phase: 0, deletedCount: 0, startedAt: now, updatedAt: now });
    tx.delete(db.doc(`publicEvents/${eventId}`));
    tx.create(db.doc(`eventAudit/${operationHash([eventId, 'deletion-started'])}`), { eventId, action: 'deletion-started', actorUid: actor.uid, at: now });
  });
  try {
    const started = Date.now();
    for (let n = 0; n < 150 && Date.now() - started < 220000; n++) if (await batch(eventId)) return { eventId, state: 'complete' };
    return { eventId, state: 'running' };
  } catch (error) {
    // Failed authorization never writes a late progress update; the persisted cursor is still resumable.
    await runAccessTransaction(db, async tx => {
      const job = (await tx.get(jobRef)).data();
      if (job && job.state !== 'complete') tx.update(jobRef, { state: 'paused', error: error instanceof HttpsError ? error.message : 'Dávka selhala. Znovu ověřte účet a pokračujte v mazání.', updatedAt: Timestamp.now() });
    }).catch(() => undefined);
    throw error;
  }
});
