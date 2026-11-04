import { LiveSessionError } from './errors.js';
import { originalYoutubeSource, resolveSlideDesign, normalizeResultTemplates, canHideInfoSlide, type ResultTemplate } from '@filmovy-kviz/quiz-domain';
import type {
  LiveRenderMode,
  PrivateLiveSession,
  PrivateSlide,
  PublicLiveSession,
  PublicMedia,
  PublicPresentation,
} from './types.js';

const maximumPublicTextLength = 20_000;
const publicMediaKinds = new Set<PublicMedia['kind']>(['image', 'audio', 'video', 'unknown']);

/** Result copy and style come only from the event's frozen source, never scores or contacts. */
export function publicResultTemplate(snapshot: Record<string, unknown>, kind: 'interim' | 'final'): ResultTemplate {
  const template = normalizeResultTemplates(snapshot.resultTemplates)[kind];
  const design = resolveSlideDesign(snapshot.defaultDesign, undefined, template?.design);
  return { ...(template?.title === undefined ? {} : { title: template.title }), ...(template?.subtitle === undefined ? {} : { subtitle: template.subtitle }), ...(Object.keys(design).length ? { design } : {}) };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

function publicText(value: unknown): string | undefined {
  return typeof value === 'string' ? value.slice(0, maximumPublicTextLength) : undefined;
}

function publicNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function publicNonNegative(value: unknown): number | undefined {
  const number = publicNumber(value);
  return number !== undefined && number >= 0 ? number : undefined;
}

function sanitizeOptions(options: readonly unknown[]): readonly string[] {
  return options.flatMap((option) => {
    if (typeof option === 'string') return [option.slice(0, maximumPublicTextLength)];
    if (typeof option === 'number' && Number.isFinite(option)) return [String(option)];
    if (typeof option === 'boolean') return [String(option)];
    return [];
  });
}

function sanitizePresentation(value: unknown): PublicPresentation {
  if (!isObject(value)) return {};
  return {
    ...(publicNumber(value.backgroundOverlay) === undefined ? {} : { backgroundOverlay: publicNumber(value.backgroundOverlay) }),
    ...(publicNumber(value.answerOverlay) === undefined ? {} : { answerOverlay: publicNumber(value.answerOverlay) }),
    ...(publicText(value.sourceQuestionNumber) === undefined ? {} : { sourceQuestionNumber: publicText(value.sourceQuestionNumber) }),
  };
}

function storedMediaSource(value: Record<string, unknown>): string | undefined {
  return publicText(value.url) ?? publicText(value.value) ?? publicText(value.source);
}

function sanitizedMedia(media: readonly unknown[], allowAudioVideo: boolean): readonly PublicMedia[] {
  return media.flatMap((item) => {
    if (!isObject(item) || (item.role !== 'prompt' && item.role !== 'background')) return [];
    const source = storedMediaSource(item);
    const kind = publicMediaKinds.has(item.kind as PublicMedia['kind'])
      ? item.kind as PublicMedia['kind']
      : 'unknown';
    if (!allowAudioVideo && (kind === 'audio' || kind === 'video')) return [];
    return source === undefined ? [] : [{ role: item.role, kind, source }];
  });
}

function legacyMediaSource(slide: PrivateSlide, kind: 'image' | 'audio' | 'video', role: 'prompt' | 'answer' | 'background'): string | undefined {
  for (const item of slide.media) {
    if (!isObject(item) || item.role !== role || item.kind !== kind) continue;
    const source = storedMediaSource(item);
    if (source !== undefined) return source;
  }
  return undefined;
}

function isImageKind(kind: string): boolean {
  return ['image', 'picture', 'photo'].includes(kind.toLowerCase());
}

function isAudioKind(kind: string): boolean {
  return ['audio', 'music'].includes(kind.toLowerCase());
}

function isVideoKind(kind: string): boolean {
  return ['video', 'youtube'].includes(kind.toLowerCase());
}

function renderMode(slide?: PrivateSlide, recap = false): LiveRenderMode {
  if (recap) return 'recap';
  const kind = slide?.kind.toLowerCase();
  if (kind === 'intro' || ['round', 'roundheader', 'round-header', 'section'].includes(kind ?? '')) return 'roundIntro';
  if (kind === 'agenda') return 'agenda';
  if (kind === 'rules') return 'rules';
  if (kind === 'end') return 'end';
  return 'question';
}

function explicitMediaSource(value: unknown): string | undefined {
  return isObject(value)
    ? publicText(value.source) ?? publicText(value.value)
    : publicText(value);
}

function normalizedMedia(slide: PrivateSlide) {
  const kind = slide.kind.toLowerCase();
  const backgroundImage = publicText(slide.backgroundImage) ?? legacyMediaSource(slide, 'image', 'background');
  const questionImage = publicText(slide.questionImage)
    ?? (isImageKind(kind) ? legacyMediaSource(slide, 'image', 'prompt') : undefined);
  const answerImage = publicText(slide.answerImage) ?? legacyMediaSource(slide, 'image', 'answer');
  const mediaSource = explicitMediaSource(slide.mediaSource)
    ?? (isAudioKind(kind) ? legacyMediaSource(slide, 'audio', 'prompt') : undefined)
    ?? (isVideoKind(kind) ? legacyMediaSource(slide, 'video', 'prompt') : undefined);
  return { backgroundImage, questionImage, answerImage, mediaSource };
}

function questionNumbers(slide: PrivateSlide): { readonly questionNumber?: number; readonly questionCount?: number } {
  if (Number.isInteger(slide.questionNumber) && (slide.questionNumber ?? 0) >= 1
    && Number.isInteger(slide.questionCount) && (slide.questionCount ?? 0) >= (slide.questionNumber ?? 0)) {
    return { questionNumber: slide.questionNumber, questionCount: slide.questionCount };
  }
  if (!isObject(slide.presentation) || typeof slide.presentation.sourceQuestionNumber !== 'string') return {};
  const match = /^\s*(\d+)\s*\/\s*(\d+)\s*$/u.exec(slide.presentation.sourceQuestionNumber);
  if (match === null) return {};
  const questionNumber = Number(match[1]);
  const questionCount = Number(match[2]);
  return questionNumber >= 1 && questionCount >= questionNumber ? { questionNumber, questionCount } : {};
}

export function displayAnswer(value: unknown, kind?: string): string | undefined {
  let rendered: string | undefined;
  if (typeof value === 'string') rendered = value;
  if (typeof value === 'number' && Number.isFinite(value)) rendered = String(value);
  if (typeof value === 'boolean') rendered = String(value);
  if (Array.isArray(value) && value.length > 0 && value.every((item) => (
    typeof item === 'string' || typeof item === 'boolean'
    || (typeof item === 'number' && Number.isFinite(item))
  ))) rendered = value.map(String).join(', ');
  if (rendered === undefined || rendered.trim().length === 0) return undefined;
  if (kind?.toLowerCase() === 'pl') {
    const normalized = rendered.trim().toLocaleLowerCase('cs-CZ');
    if (['true', '1', 'ano', 'pravda'].includes(normalized)) rendered = 'PRAVDA';
    if (['false', '0', 'ne', 'lež', 'lez'].includes(normalized)) rendered = 'LEŽ';
  }
  return rendered.slice(0, maximumPublicTextLength);
}

export function buildPublicSessionState(session: PrivateLiveSession, slide?: PrivateSlide): PublicLiveSession {
  const base: PublicLiveSession = {
    sessionId: session.sessionId,
    status: session.status,
    quizTitle: session.quizTitle,
    slidePosition: session.currentSlidePosition,
    answerRevealed: session.answerRevealed,
    presentationMode: session.presentationMode,
    renderMode: renderMode(slide, session.presentationMode === 'recap'),
    mediaCommand: session.mediaCommand,
    mediaPlaybackState: session.mediaPlaybackState,
    mediaGeneration: session.mediaGeneration,
    introGeneration: session.introGeneration,
    revision: session.revision,
    updatedAt: session.updatedAt,
  };
  if (session.status !== 'active') {
    return { ...base, answerRevealed: false, presentationMode: 'slide', renderMode: 'question', mediaCommand: 'idle', mediaPlaybackState: 'idle' };
  }
  const expectedPosition = session.presentationMode === 'recap'
    ? session.recapQuestionPosition ?? session.currentSlidePosition
    : session.currentSlidePosition;
  if (slide === undefined || slide.position !== expectedPosition) {
    throw new LiveSessionError('failed-precondition', 'Active session slide is unavailable.');
  }
  if (slide.hidden === true && canHideInfoSlide(slide)) throw new LiveSessionError('failed-precondition', 'Hidden information slide cannot be published.');
  const allowAudioVideo = session.presentationMode === 'recap' || isVideoKind(slide.kind);
  const classified = normalizedMedia(slide);
  const presentation = isObject(slide.presentation) ? slide.presentation : {};
  const backgroundOverlay = publicNonNegative(slide.backgroundOverlay) ?? publicNonNegative(presentation.backgroundOverlay);
  const clipStartSeconds = publicNonNegative(slide.clipStartSeconds)
    ?? publicNonNegative(presentation.clipStartSeconds)
    ?? publicNonNegative(presentation.videoStart)
    ?? 0;
  const clipEndSeconds = publicNonNegative(slide.clipEndSeconds)
    ?? publicNonNegative(presentation.clipEndSeconds)
    ?? publicNonNegative(presentation.videoEnd);
  const result: PublicLiveSession = {
    ...base,
    slideKind: publicText(slide.kind) ?? 'legacy',
    title: publicText(slide.title) ?? '',
    text: publicText(slide.text) ?? '',
    ...(publicText(slide.roundTitle) === undefined ? {} : { roundTitle: publicText(slide.roundTitle) }),
    ...(Object.keys(resolveSlideDesign(slide.defaultDesign, slide.roundDesign, slide.design)).length ? { design: resolveSlideDesign(slide.defaultDesign, slide.roundDesign, slide.design) } : {}),
    options: sanitizeOptions(slide.options),
    media: sanitizedMedia(slide.media, allowAudioVideo),
    presentation: sanitizePresentation(slide.presentation),
    ...questionNumbers(slide),
    ...(slide.imageLayout === 'split' || slide.imageLayout === 'stacked' ? { imageLayout: slide.imageLayout } : {}),
    ...(classified.backgroundImage === undefined ? {} : { backgroundImage: classified.backgroundImage }),
    ...(classified.questionImage === undefined ? {} : { questionImage: classified.questionImage }),
    ...(!allowAudioVideo || classified.mediaSource === undefined ? {} : { mediaSource: classified.mediaSource }),
    ...(backgroundOverlay === undefined ? {} : { backgroundOverlay: Math.min(100, backgroundOverlay) }),
    clipStartSeconds,
    ...(clipEndSeconds !== undefined && clipEndSeconds > clipStartSeconds ? { clipEndSeconds } : {}),
    ...(session.presentationMode === 'recap' && session.recapQuestionPosition !== undefined
      ? { recapQuestionPosition: session.recapQuestionPosition } : {}),
  };
  if (session.presentationMode === 'recap' && session.recapQuestionPosition === undefined) return result;
  if (session.presentationMode !== 'recap' && !session.answerRevealed) return result;
  const revealedAnswer = displayAnswer(slide.correctAnswer, slide.kind);
  if (revealedAnswer === undefined) throw new LiveSessionError('failed-precondition', 'This slide has no displayable answer.');
  const originalSource = session.answerRevealed && session.mediaPlaybackMode === 'original' ? originalYoutubeSource(slide) : undefined;
  const { clipEndSeconds: savedEnd, ...revealedResult } = result; void savedEnd;
  return {
    ...(originalSource ? revealedResult : result),
    ...(originalSource ? { mediaPlaybackMode: 'original' as const, mediaSource: originalSource, clipStartSeconds: 0 } : {}),
    answerRevealed: true,
    renderMode: 'recap',
    ...(Object.keys(resolveSlideDesign(slide.defaultDesign, slide.roundDesign, slide.design, slide.answerDesign, true)).length ? { design: resolveSlideDesign(slide.defaultDesign, slide.roundDesign, slide.design, slide.answerDesign, true) } : {}),
    revealedAnswer,
    ...(publicText(slide.answerExplanation) === undefined ? {} : { answerExplanation: publicText(slide.answerExplanation) }),
    ...(classified.answerImage === undefined ? {} : { answerImage: classified.answerImage }),
  };
}
