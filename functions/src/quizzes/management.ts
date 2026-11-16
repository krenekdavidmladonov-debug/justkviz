import { FieldValue, getFirestore, Timestamp, type Transaction } from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { accessActor, runAccessTransaction, securedOnCall } from '../access/authorization.js';
import { isObject, requiredId } from '../events/validation.js';
import { quizDisposition, quizTrashRevision } from './guards.js';

const options = { region: 'europe-west1', cors: true, maxInstances: 10 };
const dependencyLimit = 100;
const unsafeDependency = () => new HttpsError('failed-precondition', 'Kvíz zatím nelze přesunout do koše: používá ho živé moderování nebo akce bez úplné uložené kopie.');
function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 1500 && !value.includes('/');
}

/** Inspect only dependencies of this quiz; never return event/session identities. */
async function assertSafeDependencies(tx: Transaction, quizId: string) {
  const db = getFirestore();
  const sessions = await tx.get(db.collection('sessions').where('quizId', '==', quizId).limit(dependencyLimit + 1));
  const events = await tx.get(db.collection('events').where('quizAssignment.quizId', '==', quizId).limit(dependencyLimit + 1));
  if (sessions.size > dependencyLimit || events.size > dependencyLimit) throw unsafeDependency();
  if (sessions.docs.some(doc => doc.data().status !== 'ended' && !validId(doc.data().snapshotId))) throw unsafeDependency();
  for (const event of events.docs) {
    const assignment: unknown = event.data().quizAssignment;
    if (!isObject(assignment) || !validId(assignment.snapshotId)) throw unsafeDependency();
    const ref = db.doc(`quizSnapshots/${assignment.snapshotId}`);
    const snapshot = (await tx.get(ref)).data();
    if (!snapshot || snapshot.status !== 'ready' || snapshot.eventId !== event.id || snapshot.quizId !== quizId
      || snapshot.quizRevision !== assignment.quizRevision || !Number.isSafeInteger(snapshot.quizRevision) || (snapshot.quizRevision as number) < 0
      || !Number.isSafeInteger(snapshot.slideCount) || (snapshot.slideCount as number) < 1 || (snapshot.slideCount as number) > 400
      || !Number.isSafeInteger(snapshot.roundCount) || (snapshot.roundCount as number) < 0 || (snapshot.roundCount as number) > 400
      || !Number.isSafeInteger(snapshot.questionCount) || (snapshot.questionCount as number) < 0 || (snapshot.questionCount as number) > (snapshot.slideCount as number)
      || snapshot.roundCount !== assignment.roundCount || snapshot.questionCount !== assignment.questionCount) throw unsafeDependency();
    const slides = await tx.get(ref.collection('slides').orderBy('position').limit(401));
    const rounds = await tx.get(ref.collection('rounds').limit(401));
    if (slides.size !== snapshot.slideCount || rounds.size !== snapshot.roundCount
      || slides.docs.some((slide, index) => slide.data().position !== index + 1)) throw unsafeDependency();
  }
}

async function transition(request: CallableRequest, target: 'active' | 'trash') {
  const actor = accessActor(request.auth), data: unknown = request.data;
  if (!isObject(data) || Object.keys(data).some(key => !['quizId', 'expectedRevision'].includes(key))
    || !Number.isSafeInteger(data.expectedRevision) || (data.expectedRevision as number) < 0) {
    throw new HttpsError('invalid-argument', 'Neplatný požadavek na změnu kvízu.');
  }
  const quizId = requiredId(data, 'quizId'), expected = data.expectedRevision as number;
  const db = getFirestore(), ref = db.doc(`quizzes/${quizId}`);
  return runAccessTransaction(db, async tx => {
    const quiz = (await tx.get(ref)).data();
    if (!quiz) throw new HttpsError('not-found', 'Kvíz není dostupný.');
    const revision = quizTrashRevision(quiz);
    if (revision !== expected) throw new HttpsError('aborted', 'Kvíz změnil jiný správce. Načtěte aktuální přehled.');
    if (quizDisposition(quiz) === target) throw new HttpsError('failed-precondition', target === 'trash' ? 'Kvíz už je v koši.' : 'Kvíz není v koši.');
    if (target === 'trash') await assertSafeDependencies(tx, quizId);
    const now = Timestamp.now();
    tx.update(ref, {
      disposition: target, revision: revision + 1, updatedAt: now, updatedBy: actor.uid,
      ...(target === 'trash' ? { trashedAt: now, trashedBy: actor.uid } : { trashedAt: FieldValue.delete(), trashedBy: FieldValue.delete(), restoredAt: now, restoredBy: actor.uid }),
    });
    return { quizId, revision: revision + 1, disposition: target };
  });
}

export const trashQuiz = securedOnCall('trashQuiz', options, request => transition(request, 'trash'));
export const restoreQuiz = securedOnCall('restoreQuiz', options, request => transition(request, 'active'));
