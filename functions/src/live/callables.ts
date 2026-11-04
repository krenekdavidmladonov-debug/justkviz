import { assertPlayableQuizSource } from '../quizzes/playable.js';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp, type DocumentSnapshot, type Transaction } from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { accessActor, securedOnCall, runAccessTransaction } from '../access/authorization.js';
import { canHideInfoSlide, resolveLegacySlideAppearance, normalizeResultPagination, parseShowCue } from '@filmovy-kviz/quiz-domain';
import { verifiedOriginalYoutubeSource } from '../media/original-source.js';
import { resolveOriginalImages } from '../media/original-images.js';
import { loadSnapshotClipAssets } from '../media/snapshot-clip-store.js';
import { resolveSnapshotClip } from '../media/snapshot-clips.js';

import { LiveSessionError } from './errors.js';
import { buildPublicSessionState } from './publication.js';
import { applyLiveSessionAction, applyMediaPlaybackReport } from './session-machine.js';
import { parseInterimReturn } from './show-mode.js';
import { adjacentVisibleSlidePosition, requestedNavigationDirection } from './navigation.js';
import type {
  LiveMediaCommand,
  LiveMediaPlaybackState,
  LivePresentationMode,
  LiveSessionAction,
  PrivateLiveSession,
  PrivateSlide,
} from './types.js';

if (getApps().length === 0) initializeApp();
const db = getFirestore();
const callableOptions = { region: 'europe-west1', cors: true } as const;

type StaffRole = 'admin' | 'moderator';
type MutationKind =
  | 'go-to-slide' | 'next-slide' | 'previous-slide'
  | 'reveal-answer' | 'hide-answer' | 'select-recap-question'
  | 'play-media' | 'stop-media' | 'replay-media' | 'finish-media'
  | 'start-intro' | 'end-session';

interface StaffActor { readonly uid: string; readonly role: StaffRole }

interface ControlResponse {
  readonly sessionId: string;
  readonly status: PrivateLiveSession['status'];
  readonly currentSlidePosition: number;
  readonly answerRevealed: boolean;
  readonly presentationMode: LivePresentationMode;
  readonly mediaCommand: LiveMediaCommand;
  readonly mediaPlaybackState: LiveMediaPlaybackState;
  readonly mediaGeneration: number;
  readonly revision: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

export function authorizeStaff(auth: CallableRequest<unknown>['auth']): StaffActor {
  return accessActor(auth);
}

function snapshotData(snapshot: DocumentSnapshot, location: string): Record<string, unknown> {
  const value: unknown = snapshot.data();
  if (!isObject(value)) throw new LiveSessionError('failed-precondition', `${location} is malformed.`);
  return value;
}

function requiredId(data: unknown, field: string): string {
  if (!isObject(data) || typeof data[field] !== 'string') throw new HttpsError('invalid-argument', `${field} is required.`);
  const value = data[field];
  if (value.length === 0 || value.length > 1_500 || value.includes('/')) throw new HttpsError('invalid-argument', `${field} is invalid.`);
  return value;
}

function expectedRevision(data: unknown): number {
  if (!isObject(data) || !Number.isInteger(data.expectedRevision) || (data.expectedRevision as number) < 0) {
    throw new HttpsError('invalid-argument', 'expectedRevision must be a non-negative integer.');
  }
  return data.expectedRevision as number;
}

function requestedPosition(data: unknown): number {
  if (!isObject(data) || !Number.isInteger(data.position)) throw new HttpsError('invalid-argument', 'position must be an integer.');
  return data.position as number;
}

function requestedMediaGeneration(data: unknown): number {
  if (!isObject(data) || !Number.isInteger(data.mediaGeneration) || (data.mediaGeneration as number) < 0) {
    throw new HttpsError('invalid-argument', 'mediaGeneration must be a non-negative integer.');
  }
  return data.mediaGeneration as number;
}

function requestedPlaybackState(data: unknown): Extract<LiveMediaPlaybackState, 'ready' | 'playing' | 'error' | 'finished'> {
  if (!isObject(data)) throw new HttpsError('invalid-argument', 'playbackState is required.');
  const value = data.playbackState;
  if (value !== 'ready' && value !== 'playing' && value !== 'error' && value !== 'finished') {
    throw new HttpsError('invalid-argument', 'playbackState is invalid.');
  }
  return value;
}

function requiredString(data: Record<string, unknown>, field: string, location: string): string {
  const value: unknown = data[field];
  if (typeof value !== 'string') throw new LiveSessionError('failed-precondition', `${location} is malformed.`);
  return value;
}

function requiredNumber(data: Record<string, unknown>, field: string, location: string): number {
  const value: unknown = data[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new LiveSessionError('failed-precondition', `${location} is malformed.`);
  return value;
}

function optionalInteger(data: Record<string, unknown>, field: string): number | undefined {
  const value: unknown = data[field];
  return Number.isInteger(value) && (value as number) >= 0 ? value as number : undefined;
}

export function parseSession(snapshot: DocumentSnapshot): PrivateLiveSession {
  if (!snapshot.exists) throw new LiveSessionError('not-found', 'Live session was not found.');
  const data = snapshotData(snapshot, 'Live session');
  const status = data.status;
  if (status !== 'waiting' && status !== 'active' && status !== 'ended') throw new LiveSessionError('failed-precondition', 'Live session is malformed.');
  const presentationMode = data.presentationMode === 'recap' ? 'recap' : 'slide';
  const commandSet = new Set<LiveMediaCommand>(['idle', 'play', 'stop', 'replay', 'finished', 'error']);
  const mediaCommand = commandSet.has(data.mediaCommand as LiveMediaCommand) ? data.mediaCommand as LiveMediaCommand : 'idle';
  const playbackSet = new Set<LiveMediaPlaybackState>(['idle', 'preparing', 'ready', 'playing', 'finished', 'error']);
  const mediaPlaybackState = playbackSet.has(data.mediaPlaybackState as LiveMediaPlaybackState)
    ? data.mediaPlaybackState as LiveMediaPlaybackState
    : mediaCommand === 'play' || mediaCommand === 'replay' ? 'preparing'
      : mediaCommand === 'finished' ? 'finished'
        : mediaCommand === 'error' ? 'error' : 'idle';
  const currentSlideId = typeof data.currentSlideId === 'string' ? data.currentSlideId : undefined;
  const recapQuestionId = typeof data.recapQuestionId === 'string' ? data.recapQuestionId : undefined;
  const recapQuestionPosition = optionalInteger(data, 'recapQuestionPosition');
  if (isObject(data.interimResults)) normalizeResultPagination(data.interimResults);
  if (isObject(data.finalReveal)) normalizeResultPagination(data.finalReveal);
  return {
    sessionId: snapshot.id,
    ...(typeof data.eventId === "string" ? { eventId: data.eventId } : {}),
    ...(typeof data.snapshotId === "string" ? { snapshotId: data.snapshotId } : {}),
    ...(isObject(data.finalReveal) ? { finalReveal: data.finalReveal as unknown as NonNullable<PrivateLiveSession["finalReveal"]> } : {}),
    ...(isObject(data.interimResults) ? { interimResults: data.interimResults as unknown as NonNullable<PrivateLiveSession["interimResults"]> } : {}),
    ...(data.interimReturn === undefined ? {} : { interimReturn: parseInterimReturn(data.interimReturn) }),
    ...(typeof data.lastInterimVersionId === 'string' ? { lastInterimVersionId: data.lastInterimVersionId } : {}),
    ...(data.showCue === undefined ? {} : { showCue: parseShowCue(data.showCue) }),
    quizId: requiredString(data, 'quizId', 'Live session'),
    quizTitle: requiredString(data, 'quizTitle', 'Live session'),
    slideCount: requiredNumber(data, 'slideCount', 'Live session'),
    status,
    currentSlidePosition: requiredNumber(data, 'currentSlidePosition', 'Live session'),
    ...(currentSlideId === undefined ? {} : { currentSlideId }),
    answerRevealed: data.answerRevealed === true,
    presentationMode,
    ...(recapQuestionPosition === undefined ? {} : { recapQuestionPosition }),
    ...(recapQuestionId === undefined ? {} : { recapQuestionId }),
    mediaCommand,
    ...(data.mediaPlaybackMode === 'original' ? { mediaPlaybackMode: 'original' as const } : {}),
    mediaPlaybackState,
    mediaGeneration: optionalInteger(data, 'mediaGeneration') ?? 0,
    introGeneration: optionalInteger(data, 'introGeneration') ?? 0,
    revision: requiredNumber(data, 'revision', 'Live session'),
    createdBy: requiredString(data, 'createdBy', 'Live session'),
    updatedBy: requiredString(data, 'updatedBy', 'Live session'),
    createdAt: data.createdAt,
    startedAt: data.startedAt ?? null,
    endedAt: data.endedAt ?? null,
    updatedAt: data.updatedAt,
  };
}

function parseSlide(snapshot: DocumentSnapshot, resolvedData?: Record<string, unknown>): PrivateSlide {
  if (!snapshot.exists) throw new LiveSessionError('not-found', 'Quiz slide was not found.');
  const data = resolveOriginalImages(resolvedData ?? snapshotData(snapshot, 'Quiz slide'));
  const copy = (field: string) => Object.hasOwn(data, field) ? { [field]: data[field] } : {};
  return {
    id: snapshot.id,
    position: requiredNumber(data, 'position', 'Quiz slide'),
    kind: requiredString(data, 'kind', 'Quiz slide'),
    isQuestion: data.isQuestion === true,
    ...(typeof data.hidden === 'boolean' ? { hidden: data.hidden } : {}),
    ...(typeof data.roundId === 'string' ? { roundId: data.roundId } : {}),
    ...(typeof data.roundTitle === 'string' ? { roundTitle: data.roundTitle } : {}),
    ...(Number.isInteger(data.questionNumber) ? { questionNumber: data.questionNumber as number } : {}),
    ...(Number.isInteger(data.questionCount) ? { questionCount: data.questionCount as number } : {}),
    title: typeof data.title === 'string' ? data.title : '',
    text: typeof data.text === 'string' ? data.text : '',
    options: Array.isArray(data.options) ? data.options : [],
    media: Array.isArray(data.media) ? data.media : [],
    presentation: isObject(data.presentation) ? data.presentation : {},
    ...copy('backgroundImage'), ...copy('questionImage'), ...copy('answerImage'), ...copy('mediaSource'),
    ...(verifiedOriginalYoutubeSource(data) === undefined ? {} : { originalMediaSource: verifiedOriginalYoutubeSource(data) }),
    ...copy('backgroundOverlay'), ...copy('clipStartSeconds'), ...copy('clipEndSeconds'),
    ...copy('imageLayout'), ...copy('answerExplanation'), ...copy('correctAnswer'), ...copy('moderatorNote'), ...copy('legacy'), ...copy('design'), ...copy('answerDesign'),
  };
}

export async function loadSlide(transaction: Transaction, quizId: string, position: number, snapshotId?: string): Promise<PrivateSlide> {
  const rootRef = db.collection(snapshotId ? 'quizSnapshots' : 'quizzes').doc(snapshotId ?? quizId);
  const query = rootRef.collection('slides').where('position', '==', position).limit(2);
  const snapshot = await transaction.get(query);
  if (snapshot.size !== 1) throw new LiveSessionError('failed-precondition', 'Quiz slide position is missing or ambiguous.');
  const frozen = snapshot.docs[0]!;
  let slide = parseSlide(frozen);
  const metadata = await transaction.getAll(rootRef, ...(slide.roundId ? [rootRef.collection('rounds').doc(slide.roundId)] : []));
  const root = metadata[0]!.data();
  if (snapshotId) {
    if (root?.quizId !== quizId) throw new LiveSessionError('failed-precondition', 'Snapshot source does not match the session.');
    const raw = snapshotData(frozen, 'Quiz slide');
    const assets = await loadSnapshotClipAssets(transaction, db, root.quizId as string, [raw]);
    slide = parseSlide(frozen, resolveSnapshotClip(root.quizId as string, raw, assets));
  }
  const roundDesign: unknown = metadata[1]?.data()?.design;
  const appearance = resolveLegacySlideAppearance(root?.defaultAppearance, slide);
  return { ...slide, ...(root?.defaultDesign === undefined ? {} : { defaultDesign: root.defaultDesign }), ...(roundDesign === undefined ? {} : { roundDesign }),
    ...appearance };
}

function response(session: PrivateLiveSession): ControlResponse {
  return {
    sessionId: session.sessionId,
    status: session.status,
    currentSlidePosition: session.currentSlidePosition,
    answerRevealed: session.answerRevealed,
    presentationMode: session.presentationMode,
    mediaCommand: session.mediaCommand,
    mediaPlaybackState: session.mediaPlaybackState,
    mediaGeneration: session.mediaGeneration,
    revision: session.revision,
  };
}

function mapError(error: unknown): never {
  if (error instanceof HttpsError) throw error;
  if (error instanceof LiveSessionError) throw new HttpsError(error.code, error.message);
  throw new HttpsError('internal', 'Live session operation failed.');
}

export const createLiveSession = securedOnCall('createLiveSession', callableOptions, async (request): Promise<ControlResponse> => {
  try {
    const actor = authorizeStaff(request.auth);
    const quizId = requiredId(request.data, 'quizId');
    const quizRef = db.collection('quizzes').doc(quizId);
    const sessionRef = db.collection('sessions').doc();
    const publicRef = db.collection('publicSessions').doc(sessionRef.id);
    return await runAccessTransaction(db, async (transaction) => {
      const quizSnapshot = await transaction.get(quizRef);
      if (!quizSnapshot.exists) throw new LiveSessionError('not-found', 'Quiz was not found.');
      const quiz = snapshotData(quizSnapshot, 'Quiz');
      const slideCount = requiredNumber(quiz, 'slideCount', 'Quiz');
      if (!Number.isInteger(slideCount) || slideCount < 1) throw new LiveSessionError('failed-precondition', 'Quiz has no ordered slides.');
      const sourceSlides = await transaction.get(quizRef.collection('slides'));
      assertPlayableQuizSource(slideCount, sourceSlides.docs.map(slide => slide.data()));
      const now = Timestamp.now();
      const session: PrivateLiveSession = {
        sessionId: sessionRef.id, quizId, quizTitle: requiredString(quiz, 'title', 'Quiz'), slideCount,
        status: 'waiting', currentSlidePosition: 0, answerRevealed: false, presentationMode: 'slide',
        mediaCommand: 'idle', mediaPlaybackState: 'idle', mediaGeneration: 0, introGeneration: 0, revision: 0,
        createdBy: actor.uid, updatedBy: actor.uid, createdAt: now, startedAt: null, endedAt: null, updatedAt: now,
      };
      transaction.create(sessionRef, session);
      transaction.create(publicRef, buildPublicSessionState(session));
      return response(session);
    });
  } catch (error) { return mapError(error); }
});

async function mutateSession(request: CallableRequest<unknown>, kind: MutationKind): Promise<ControlResponse> {
  try {
    if (kind === 'go-to-slide') {
      const direction = requestedNavigationDirection(request.data);
      if (direction !== undefined) kind = direction === 1 ? 'next-slide' : 'previous-slide';
    }
    const actor = authorizeStaff(request.auth);
    const sessionId = requiredId(request.data, 'sessionId');
    const revision = expectedRevision(request.data);
    const requested = kind === 'go-to-slide' || kind === 'select-recap-question' ? requestedPosition(request.data) : undefined;
    const finishGeneration = kind === 'finish-media' ? requestedMediaGeneration(request.data) : undefined;
    const mode = kind === 'play-media' && isObject(request.data) ? request.data.mode : undefined;
    if (mode !== undefined && mode !== 'clip' && mode !== 'original') throw new HttpsError('invalid-argument', 'Unsupported playback mode.');
    const sessionRef = db.collection('sessions').doc(sessionId);
    const publicRef = db.collection('publicSessions').doc(sessionId);
    return await runAccessTransaction(db, async (transaction) => {
      const session = parseSession(await transaction.get(sessionRef));
      const boundEvent = session.eventId ? (await transaction.get(db.doc('events/' + session.eventId))).data() : undefined;
      if (session.eventId) {
        const event = boundEvent;
        if (!event || event.liveSessionId !== sessionId || !isObject(event.quizAssignment) || event.quizAssignment.snapshotId !== session.snapshotId || !['ready', 'live', 'finalizing'].includes(event.lifecycleStatus as string)) throw new HttpsError('failed-precondition', 'Akce není dostupná.');
      }
      if (finishGeneration !== undefined && finishGeneration !== session.mediaGeneration) {
        throw new LiveSessionError('aborted', 'A stale media callback was ignored.');
      }
      if ((session.interimResults || session.finalReveal?.visible) && kind !== 'end-session' && kind !== 'go-to-slide') throw new HttpsError('failed-precondition', 'Nejprve skryjte výsledky nebo finále.');
      let slide: PrivateSlide | undefined;
      let action: LiveSessionAction;
      if (kind === 'end-session') action = { type: kind };
      else if (kind === 'go-to-slide' || kind === 'next-slide' || kind === 'previous-slide') {
        let position = requested;
        if (kind !== 'go-to-slide') {
          const rootRef = db.collection(session.snapshotId ? 'quizSnapshots' : 'quizzes').doc(session.snapshotId ?? session.quizId);
          const direction = kind === 'next-slide' ? 1 : -1;
          position = await adjacentVisibleSlidePosition(transaction, rootRef, session.currentSlidePosition, direction);
        }
        if (position === undefined) throw new LiveSessionError('invalid-argument', 'No visible slide remains in this direction.');
        if (!Number.isInteger(position) || position < 1 || position > session.slideCount) {
          throw new LiveSessionError('invalid-argument', 'Slide position is outside the quiz range.');
        }
        slide = await loadSlide(transaction, session.quizId, position, session.snapshotId);
        if (slide.hidden === true && canHideInfoSlide(slide)) throw new LiveSessionError('failed-precondition', 'Hidden information slide cannot be published.');
        action = { type: 'go-to-slide', position, slideId: slide.id };
      } else if (kind === 'select-recap-question') {
        if (session.presentationMode !== 'recap' || session.currentSlidePosition < 1) {
          throw new LiveSessionError('failed-precondition', 'Recap mode is not active.');
        }
        const recap = await loadSlide(transaction, session.quizId, session.currentSlidePosition, session.snapshotId);
        slide = await loadSlide(transaction, session.quizId, requested!, session.snapshotId);
        if (recap.kind.toLowerCase() !== 'recap' || !slide.isQuestion || slide.position >= recap.position
          || (recap.roundId !== undefined && slide.roundId !== recap.roundId)) {
          throw new LiveSessionError('failed-precondition', 'Question does not belong to the active recap.');
        }
        action = { type: kind, position: slide.position, slideId: slide.id };
      } else {
        const position = session.presentationMode === 'recap' ? session.recapQuestionPosition : session.currentSlidePosition;
        if (position === undefined || position < 1) throw new LiveSessionError('failed-precondition', 'There is no active presentation slide.');
        slide = await loadSlide(transaction, session.quizId, position, session.snapshotId);
        action = kind === 'play-media' ? { type: kind, ...(mode === undefined ? {} : { mode }) } : { type: kind };
      }
      const { interimResults, ...presentationSession } = session; void interimResults;
      const updated = applyLiveSessionAction(presentationSession, action, revision, actor.uid, Timestamp.now(), slide);
      transaction.set(sessionRef, updated);
      transaction.set(publicRef, buildPublicSessionState(updated, slide));
      return response(updated);
    });
  } catch (error) { return mapError(error); }
}

export const reportMediaPlayback = securedOnCall('reportMediaPlayback', callableOptions, async (request): Promise<ControlResponse> => {
  try {
    const actor = authorizeStaff(request.auth);
    const sessionId = requiredId(request.data, 'sessionId');
    const generation = requestedMediaGeneration(request.data);
    const playbackState = requestedPlaybackState(request.data);
    const sessionRef = db.collection('sessions').doc(sessionId);
    const publicRef = db.collection('publicSessions').doc(sessionId);
    return await runAccessTransaction(db, async (transaction) => {
      const session = parseSession(await transaction.get(sessionRef));
      if (session.eventId) {
        const event = (await transaction.get(db.doc('events/' + session.eventId))).data();
        if (!event || event.liveSessionId !== sessionId || !isObject(event.quizAssignment) || event.quizAssignment.snapshotId !== session.snapshotId || !['ready', 'live', 'finalizing'].includes(event.lifecycleStatus as string)) throw new HttpsError('failed-precondition', 'Akce není dostupná.');
      }
      if (session.interimResults || session.finalReveal?.visible || session.status !== 'active' || generation !== session.mediaGeneration) {
        throw new LiveSessionError('aborted', 'A stale media callback was ignored.');
      }
      const position = session.presentationMode === 'recap' ? session.recapQuestionPosition : session.currentSlidePosition;
      if (position === undefined || position < 1) throw new LiveSessionError('failed-precondition', 'There is no active presentation slide.');
      const slide = await loadSlide(transaction, session.quizId, position, session.snapshotId);
      if (!['audio', 'music', 'video', 'youtube'].includes(slide.kind.toLowerCase())) {
        throw new LiveSessionError('failed-precondition', 'The active slide has no playable media.');
      }
      const now = Timestamp.now();
      const updated = applyMediaPlaybackReport(session, playbackState, generation, actor.uid, now);
      if (updated === session) return response(session);
      transaction.set(sessionRef, updated);
      transaction.set(publicRef, buildPublicSessionState(updated, slide));
      return response(updated);
    });
  } catch (error) { return mapError(error); }
});

export const goToSlide = securedOnCall('goToSlide', callableOptions, (request) => mutateSession(request, 'go-to-slide'));
export const nextSlide = securedOnCall('nextSlide', callableOptions, (request) => mutateSession(request, 'next-slide'));
export const previousSlide = securedOnCall('previousSlide', callableOptions, (request) => mutateSession(request, 'previous-slide'));
export const revealAnswer = securedOnCall('revealAnswer', callableOptions, (request) => mutateSession(request, 'reveal-answer'));
export const hideAnswer = securedOnCall('hideAnswer', callableOptions, (request) => mutateSession(request, 'hide-answer'));
export const selectRecapQuestion = securedOnCall('selectRecapQuestion', callableOptions, (request) => mutateSession(request, 'select-recap-question'));
export const playMedia = securedOnCall('playMedia', callableOptions, (request) => mutateSession(request, 'play-media'));
export const stopMedia = securedOnCall('stopMedia', callableOptions, (request) => mutateSession(request, 'stop-media'));
export const replayMedia = securedOnCall('replayMedia', callableOptions, (request) => mutateSession(request, 'replay-media'));
export const finishMedia = securedOnCall('finishMedia', callableOptions, (request) => mutateSession(request, 'finish-media'));
export const startIntro = securedOnCall('startIntro', callableOptions, (request) => mutateSession(request, 'start-intro'));
export const endLiveSession = securedOnCall('endLiveSession', callableOptions, (request) => mutateSession(request, 'end-session'));
