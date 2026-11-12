import { LiveSessionError } from './errors.js';
import { originalYoutubeSource } from '@filmovy-kviz/quiz-domain';
import { displayAnswer } from './publication.js';
import type { LiveMediaPlaybackState, LiveSessionAction, PrivateLiveSession, PrivateSlide } from './types.js';

const playbackTransitions: Readonly<Record<LiveMediaPlaybackState, readonly LiveMediaPlaybackState[]>> = {
  idle: [],
  preparing: ['ready', 'playing', 'error', 'finished'],
  ready: ['playing', 'error', 'finished'],
  playing: ['ready', 'error', 'finished'],
  finished: [],
  error: [],
};

function assertExpectedRevision(session: PrivateLiveSession, expectedRevision: number): void {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw new LiveSessionError('invalid-argument', 'expectedRevision must be a non-negative integer.');
  }
  if (session.revision !== expectedRevision) throw new LiveSessionError('aborted', 'The live session changed; refresh and retry.');
}

function assertMutable(session: PrivateLiveSession): void {
  if (session.status === 'ended') throw new LiveSessionError('failed-precondition', 'The live session has ended.');
}

function isRecapKind(kind: string): boolean {
  return kind.toLowerCase() === 'recap';
}

function isIntroKind(kind: string): boolean {
  return ['intro', 'round', 'roundheader', 'round-header', 'section'].includes(kind.toLowerCase());
}

function isMediaKind(kind: string): boolean {
  return ['audio', 'music', 'video', 'youtube'].includes(kind.toLowerCase());
}

function withoutRecapSelection(session: PrivateLiveSession): PrivateLiveSession {
  const { recapQuestionPosition, recapQuestionId, mediaPlaybackMode, ...clean } = session;
  void mediaPlaybackMode;
  void recapQuestionPosition;
  void recapQuestionId;
  return clean;
}
function withoutShowState(session: PrivateLiveSession): PrivateLiveSession {
  const { interimReturn, showCue, ...clean } = session; void interimReturn; void showCue;
  return clean;
}
function withoutOriginalPlayback(session: PrivateLiveSession): PrivateLiveSession {
  const { mediaPlaybackMode, ...clean } = session; void mediaPlaybackMode;
  return clean;
}

export function applyLiveSessionAction(
  session: PrivateLiveSession,
  action: LiveSessionAction,
  expectedRevision: number,
  actorUid: string,
  now: unknown,
  slide?: PrivateSlide,
): PrivateLiveSession {
  assertExpectedRevision(session, expectedRevision);
  assertMutable(session);
  const common = { revision: session.revision + 1, updatedAt: now, updatedBy: actorUid };
  if (action.type === 'end-session') {
    return {
      ...withoutShowState(withoutRecapSelection(session)), ...(session.finalReveal ? { finalReveal: { ...session.finalReveal, visible: false } } : {}), ...common, status: 'ended', answerRevealed: false, presentationMode: 'slide',
      mediaCommand: 'idle', mediaPlaybackState: 'idle', mediaGeneration: session.mediaGeneration + 1, endedAt: now,
    };
  }
  if (action.type === 'go-to-slide' || action.type === 'next-slide' || action.type === 'previous-slide') {
    const position = action.type === 'go-to-slide'
      ? action.position
      : session.currentSlidePosition + (action.type === 'next-slide' ? 1 : -1);
    if (!Number.isInteger(position) || position < 1 || position > session.slideCount) {
      throw new LiveSessionError('invalid-argument', 'Slide position is outside the quiz range.');
    }
    if (slide === undefined || slide.position !== position || slide.id !== action.slideId) {
      throw new LiveSessionError('failed-precondition', 'The requested slide is unavailable.');
    }
    const recap = isRecapKind(slide.kind);
    return {
      ...withoutShowState(withoutRecapSelection(session)),
      ...(session.finalReveal ? { finalReveal: { ...session.finalReveal, visible: false } } : {}),
      ...common,
      status: 'active',
      currentSlidePosition: position,
      currentSlideId: slide.id,
      answerRevealed: false,
      presentationMode: recap ? 'recap' : 'slide',
      mediaCommand: 'idle',
      mediaPlaybackState: 'idle',
      mediaGeneration: session.mediaGeneration + 1,
      startedAt: session.startedAt ?? now,
    };
  }
  if (session.status !== 'active' || slide === undefined) {
    throw new LiveSessionError('failed-precondition', 'There is no active slide.');
  }
  if (action.type === 'select-recap-question') {
    if (session.presentationMode !== 'recap' || !slide.isQuestion || slide.position !== action.position
      || slide.id !== action.slideId || displayAnswer(slide.correctAnswer, slide.kind) === undefined) {
      throw new LiveSessionError('failed-precondition', 'The requested recap question is unavailable.');
    }
    return {
      ...withoutOriginalPlayback(session), ...common, answerRevealed: true,
      recapQuestionPosition: slide.position, recapQuestionId: slide.id,
      mediaCommand: 'idle', mediaPlaybackState: 'idle', mediaGeneration: session.mediaGeneration + 1,
    };
  }
  const expectedPosition = session.presentationMode === 'recap'
    ? session.recapQuestionPosition
    : session.currentSlidePosition;
  const expectedId = session.presentationMode === 'recap' ? session.recapQuestionId : session.currentSlideId;
  if (slide.position !== expectedPosition || slide.id !== expectedId) {
    throw new LiveSessionError('failed-precondition', 'The active presentation slide is unavailable.');
  }
  if (action.type === 'reveal-answer') {
    if (session.presentationMode !== 'slide' || !slide.isQuestion || displayAnswer(slide.correctAnswer, slide.kind) === undefined) {
      throw new LiveSessionError('failed-precondition', 'This slide has no displayable answer.');
    }
    return { ...withoutOriginalPlayback(session), ...common, answerRevealed: true, mediaCommand: 'idle', mediaPlaybackState: 'idle', mediaGeneration: session.mediaGeneration + 1 };
  }
  if (action.type === 'hide-answer') return { ...withoutOriginalPlayback(session), ...common, answerRevealed: false, mediaCommand: 'idle', mediaPlaybackState: 'idle', mediaGeneration: session.mediaGeneration + 1 };
  if (action.type === 'start-intro') {
    if (!isIntroKind(slide.kind) || session.presentationMode !== 'slide') {
      throw new LiveSessionError('failed-precondition', 'The current slide has no intro animation.');
    }
    return { ...session, ...common, introGeneration: session.introGeneration + 1 };
  }
  if (!isMediaKind(slide.kind)) throw new LiveSessionError('failed-precondition', 'The current slide has no playable media.');
  const command = action.type === 'play-media' ? 'play'
    : action.type === 'replay-media' ? 'replay'
      : action.type === 'stop-media' ? 'stop'
        : action.type === 'finish-media' ? 'finished'
          : undefined;
  if (command === undefined) throw new LiveSessionError('invalid-argument', 'Unsupported live action.');
  const mode = action.type === 'play-media' ? action.mode === 'original' ? 'original' : undefined : session.mediaPlaybackMode;
  if (mode === 'original' && (!session.answerRevealed || !slide.isQuestion || !originalYoutubeSource(slide))) {
    throw new LiveSessionError('failed-precondition', 'Original video requires an explicitly revealed answer and a supported source.');
  }
  const mediaPlaybackState = command === 'play' || command === 'replay' ? 'preparing'
    : command === 'finished' ? 'finished' : 'idle';
  const { mediaPlaybackMode, ...clean } = session; void mediaPlaybackMode;
  return { ...clean, ...common, ...(mode ? { mediaPlaybackMode: mode } : {}), mediaCommand: command, mediaPlaybackState, mediaGeneration: session.mediaGeneration + 1 };
}

export function applyMediaPlaybackReport(
  session: PrivateLiveSession,
  playbackState: Extract<LiveMediaPlaybackState, 'ready' | 'playing' | 'error' | 'finished'>,
  mediaGeneration: number,
  actorUid: string,
  now: unknown,
): PrivateLiveSession {
  assertMutable(session);
  if (session.status !== 'active' || mediaGeneration !== session.mediaGeneration) {
    throw new LiveSessionError('aborted', 'A stale media callback was ignored.');
  }
  if (session.mediaPlaybackState === playbackState) return session;
  if (!playbackTransitions[session.mediaPlaybackState].includes(playbackState)) {
    throw new LiveSessionError('aborted', 'An out-of-order media callback was ignored.');
  }
  return {
    ...session,
    mediaPlaybackState: playbackState,
    mediaCommand: playbackState === 'error' ? 'error'
      : playbackState === 'finished' ? 'finished' : session.mediaCommand,
    revision: session.revision + 1,
    updatedBy: actorUid,
    updatedAt: now,
  };
}
