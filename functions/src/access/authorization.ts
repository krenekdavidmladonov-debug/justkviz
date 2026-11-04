import { AsyncLocalStorage } from 'node:async_hooks';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { HttpsError, onCall, type CallableOptions, type CallableRequest } from 'firebase-functions/v2/https';
import { hasPermission, scopeAllows, type Membership, type Permission } from '@filmovy-kviz/quiz-domain';
import { assertEventOperational, assertEventReadable, isCompletedEventHide } from '../events/guards.js';
import { assertQuizActive } from '../quizzes/guards.js';

export type AuthIdentity = Pick<NonNullable<CallableRequest['auth']>, 'uid' | 'token'> | undefined;
export type Resource = { kind: 'quiz' | 'event'; id: string };
interface Context { request: CallableRequest; name: string; member: Membership }
const context = new AsyncLocalStorage<Context>();
export function identity(auth: AuthIdentity) {
  if (!auth) throw new HttpsError('unauthenticated', 'Přihlaste se ke svému účtu.');
  return { uid: auth.uid, role: 'admin' as const };
}
export function accessActor(auth: AuthIdentity) {
  const actor = identity(auth);
  if (!context.getStore() || context.getStore()?.request.auth?.uid !== actor.uid) {
    throw new HttpsError('permission-denied', 'Chybí ověření aktuálního přístupu.');
  }
  return actor;
}
export async function freshIdentity(auth: AuthIdentity) {
  const actor = identity(auth);
  const user = await getAuth().getUser(actor.uid).catch(() => null);
  if (!user || user.disabled) throw new HttpsError('permission-denied', 'Účet není aktivní.');
  if (!user.emailVerified || auth?.token.email_verified !== true) throw new HttpsError('permission-denied', 'Nejdříve ověřte svůj e-mail a obnovte přihlášení.');
  const validAfter = user.tokensValidAfterTime ? Math.floor(Date.parse(user.tokensValidAfterTime) / 1000) : 0;
  if (Number(auth?.token.auth_time) < validAfter) throw new HttpsError('unauthenticated', 'Přihlaste se znovu.');
  return user;
}
export async function membership(auth: AuthIdentity, tx?: Transaction): Promise<Membership> {
  const { uid } = identity(auth);
  const ref = getFirestore().doc(`memberships/${uid}`);
  const snapshot = tx ? await tx.get(ref) : await ref.get();
  const member = snapshot.data() as Membership | undefined;
  if (!member || member.uid !== uid || member.status !== 'active' || !Array.isArray(member.permissions)
    || auth?.token.email_verified !== true || !Number.isFinite(Number(auth.token.auth_time))
    || Number(auth.token.auth_time) <= member.sessionValidAfter) {
    throw new HttpsError('permission-denied', 'Přístup není aktivní. Přihlaste se znovu nebo kontaktujte správce.');
  }
  return member;
}
export async function authorize(auth: AuthIdentity, required: readonly Permission[], resource?: Resource, tx?: Transaction) {
  const member = await membership(auth, tx);
  if (!required.every(p => hasPermission(member, p))) throw new HttpsError('permission-denied', 'K této činnosti nemáte oprávnění.');
  if (resource) {
    const scope = resource.kind === 'quiz' ? member.quizzes : member.events;
    let createdBy: unknown;
    if (scope.mode === 'own') {
      const ref = getFirestore().doc(`${resource.kind === 'quiz' ? 'quizzes' : 'events'}/${resource.id}`);
      createdBy = (tx ? await tx.get(ref) : await ref.get()).data()?.createdBy;
      if (createdBy === undefined && resource.kind === 'event') {
        const tombstone = getFirestore().doc(`eventTombstones/${resource.id}`);
        createdBy = (tx ? await tx.get(tombstone) : await tombstone.get()).data()?.createdBy;
      }
    }
    if (!scopeAllows(scope, resource.id, member.uid, createdBy)) throw new HttpsError('permission-denied', 'K tomuto obsahu nemáte přístup.');
  }
  return member;
}
function resourceId(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 1500 || value.includes('/')) throw new HttpsError('invalid-argument', 'Neplatný identifikátor.');
  return value;
}
const quizEdits = ['updateQuizMetadata', 'updateQuizSlide', 'createQuizSlide', 'duplicateQuizSlide', 'moveQuizSlide', 'updateQuizRound', 'reorderQuizQuestion', 'moveQuizQuestionToRound', 'duplicateQuizRound', 'moveQuizRound', 'createQuizRound'];
const eventManagement = ['updateEvent', 'cancelEvent', 'archiveEvent', 'configureEventRegistration', 'adminCancelEventRegistration', 'adminAddEventTeam', 'adminUpdateEventTeam', 'listRefereeAccess'];
const live = ['createLiveSession', 'endLiveSession', 'finishMedia', 'goToSlide', 'hideAnswer', 'nextSlide', 'playMedia', 'previousSlide', 'reportMediaPlayback', 'replayMedia', 'revealAnswer', 'selectRecapQuestion', 'startIntro', 'stopMedia'];
const eventLive = ['createEventLiveSession', 'previewInterimResults', 'controlInterimResults', 'previewFinalResults', 'controlFinalReveal', 'configureEventShow', 'readEventShowPreferences'];
const email = ['previewEventTeamMessage', 'createEventTeamMessage', 'listEventTeamMessages', 'getEventTeamMessage'];
/** Every legacy staff callable is enumerated here; unknown names fail closed. */
export async function authorizeOperation(name: string, request: CallableRequest, tx?: Transaction): Promise<Membership> {
  const data = request.data as Record<string, unknown> | undefined;
  const quiz = (): Resource => ({ kind: 'quiz', id: resourceId(data?.quizId) });
  const event = (): Resource => ({ kind: 'event', id: resourceId(data?.eventId) });
  const activeQuiz = async (required: readonly Permission[]) => {
    const resource = quiz(), member = await authorize(request.auth, required, resource, tx);
    const ref = getFirestore().doc(`quizzes/${resource.id}`);
    assertQuizActive((tx ? await tx.get(ref) : await ref.get()).data());
    return member;
  };
  if (name === 'trashQuiz' || name === 'restoreQuiz') return authorize(request.auth, ['quiz.read', 'quiz.delete'], quiz(), tx);
  if (name === 'deleteEvent') return authorize(request.auth, ['event.read', 'event.delete'], event(), tx);
  if (['completeEvent', 'cancelEvent', 'archiveEvent', 'trashEvent', 'restoreEvent'].includes(name)) {
    return authorize(request.auth, (name === 'cancelEvent' || name === 'completeEvent') && data?.endLive === true ? ['event.manage', 'event.live'] : ['event.manage'], event(), tx);
  }
  if (tx && data?.eventId && [...eventManagement, ...eventLive, ...email.filter(operation => !['listEventTeamMessages', 'getEventTeamMessage'].includes(operation)), 'lockEventQuiz', 'saveEventScore', 'issueRefereeAccess', 'changeRefereeAccess'].includes(name)) {
    const resource = event();
    await authorize(request.auth, ['event.read'], resource, tx);
    const ref = getFirestore().doc(`events/${resource.id}`);
    const stored = (tx ? await tx.get(ref) : await ref.get()).data();
    if (!(stored && name === 'configureEventRegistration' && isCompletedEventHide(stored, data))) assertEventOperational(stored);
  }
  if (name === 'createQuiz') return authorize(request.auth, ['quiz.create'], undefined, tx);
  if (name === 'createEvent') return authorize(request.auth, ['event.create'], undefined, tx);
  if (quizEdits.includes(name)) return activeQuiz(['quiz.edit']);
  // Removing a round also deletes its header/recap even when questions are moved.
  if (name === 'deleteQuizSlide' || name === 'removeQuizRound') return activeQuiz(['quiz.edit', 'quiz.delete']);
  if (name === 'repairQuizPreflightIssue') return activeQuiz(data?.kind === 'choice-answer' ? ['quiz.edit', 'quiz.answers.edit'] : ['quiz.edit']);
  if (name === 'beginQuizMediaUpload' || name === 'finalizeQuizMediaUpload') return activeQuiz(['quiz.media.upload']);
  if (name === 'issueRefereeAccess' || name === 'changeRefereeAccess') return authorize(request.auth,
    name === 'changeRefereeAccess' && data?.action === 'revoke' ? ['event.manage'] : ['event.manage', 'event.score'], event(), tx);
  if (eventManagement.includes(name)) return authorize(request.auth, name.startsWith('admin') ? ['event.manage', 'event.contacts'] : ['event.manage'], event(), tx);
  if (email.includes(name)) {
    const member = await authorize(request.auth, ['event.manage', 'event.contacts'], event(), tx);
    if (tx && ['listEventTeamMessages', 'getEventTeamMessage'].includes(name)) {
      assertEventReadable((await tx.get(getFirestore().doc(`events/${event().id}`))).data(), member);
    }
    return member;
  }
  if (name === 'lockEventQuiz') {
    await activeQuiz(['quiz.read', 'quiz.export', 'quiz.answers.read', 'quiz.notes.read']);
    return authorize(request.auth, ['event.manage'], event(), tx);
  }
  if (name === 'saveEventScore') return authorize(request.auth, ['event.score'], event(), tx);
  if (eventLive.includes(name)) return authorize(request.auth, ['event.live'], event(), tx);
  if (live.includes(name)) {
    if (name === 'createLiveSession') return activeQuiz(['quiz.read', 'event.live']);
    const ref = getFirestore().doc(`sessions/${resourceId(data?.sessionId)}`);
    const session = (tx ? await tx.get(ref) : await ref.get()).data();
    if (!session) throw new HttpsError('permission-denied', 'Moderování není dostupné.');
    const eventBound = typeof session.eventId === 'string';
    if (eventBound && tx) {
      const eventRef = getFirestore().doc(`events/${resourceId(session.eventId)}`);
      assertEventOperational((tx ? await tx.get(eventRef) : await eventRef.get()).data());
    }
    const required: Permission[] = ['event.live'];
    if (name === 'revealAnswer' || name === 'selectRecapQuestion' || (name === 'playMedia' && data?.mode === 'original')) required.push(eventBound ? 'event.answers.read' : 'quiz.answers.read');
    return authorize(request.auth, required, eventBound ? { kind: 'event', id: resourceId(session.eventId) } : { kind: 'quiz', id: resourceId(session.quizId) }, tx);
  }
  throw new HttpsError('permission-denied', 'Operace nemá definovanou politiku přístupu.');
}
export function securedOnCall<T>(name: string, options: CallableOptions, handler: (request: CallableRequest) => T | Promise<T>) {
  return onCall(options, async request => {
    await freshIdentity(request.auth);
    const member = await authorizeOperation(name, request);
    return context.run({ name, request, member }, async () => {
      const result = await handler(request);
      await authorizeOperation(name, request);
      return result;
    });
  });
}
/** Reading authority in the same transaction makes revocation conflict with a delayed write. */
export function runAccessTransaction<T>(db: Firestore, handler: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.runTransaction(async tx => {
    const current = context.getStore();
    if (current) current.member = await authorizeOperation(current.name, current.request, tx);
    return handler(tx);
  });
}
export function grantCreatedResource(tx: Transaction, kind: 'quiz' | 'event', id: string) {
  const member = context.getStore()?.member;
  if (!member) throw new HttpsError('permission-denied', 'Chybí aktuální členství.');
  const key = kind === 'quiz' ? 'quizzes' : 'events';
  const scope = member[key];
  if (scope.mode === 'all' || scope.mode === 'own' || scope.ids.includes(id)) return;
  if (scope.ids.length >= 500) throw new HttpsError('resource-exhausted', 'Rozsah obsahuje nejvýše 500 položek.');
  tx.update(getFirestore().doc(`memberships/${member.uid}`), { [key]: { mode: 'selected', ids: [...scope.ids, id] }, version: member.version + 1 });
  tx.create(getFirestore().collection('accessAudit').doc(), { kind: 'resource-created', actorUid: member.uid, targetUid: member.uid, resourceKind: kind, resourceId: id, version: member.version + 1, at: new Date() });
}
export function currentMembership(): Membership {
  const member = context.getStore()?.member;
  if (!member) throw new HttpsError('permission-denied', 'Chybí aktuální členství.');
  return member;
}
