import type { MediaPlaybackState } from '../presentation/types';
import type { PublicLiveState, PublicMedia } from './types';
import { youtubeVideoId, normalizeSlideDesign, parseInterimBackdrop, parseShowCue, type SlideDesign } from '@filmovy-kviz/quiz-domain';
import { parseResultPage } from '../leaderboard/types';
import { parseFinalPage } from '../final-reveal/types';

type ReportablePlaybackState = Extract<MediaPlaybackState, 'ready' | 'playing' | 'error' | 'finished'>;

export type ProjectorChannelMessage =
  | { readonly type: 'public-state'; readonly state: PublicLiveState }
  | {
    readonly type: 'playback-state';
    readonly sessionId: string;
    readonly mediaGeneration: number;
    readonly playbackState: ReportablePlaybackState;
  };

export interface ProjectorChannel {
  postMessage(message: unknown): void;
  setMessageHandler(handler: (data: unknown) => void): void;
  close(): void;
}

export type ProjectorPresentationAuthority = 'fast-path-safe' | 'authoritative-only';

const stateKeys = new Set([
  'sessionId', 'quizTitle', 'status', 'slidePosition', 'slideKind', 'title', 'text', 'options', 'media',
  'presentation', 'presentationMode', 'renderMode', 'mediaCommand', 'mediaPlaybackState', 'mediaGeneration',
  'introGeneration', 'questionNumber', 'questionCount', 'backgroundImage', 'questionImage', 'mediaSource',
  'backgroundOverlay', 'clipStartSeconds', 'clipEndSeconds', 'answerRevealed', 'revealedAnswer', 'answerImage',
  'recapQuestionPosition', 'revision',
  'mediaPlaybackMode',
  'design', 'roundTitle', 'subtitle', 'imageLayout', 'answerExplanation', 'showCue', 'interimBackdrop', 'interimResults', 'finalReveal',
]);
const presentationKeys = new Set(['backgroundOverlay', 'answerOverlay', 'sourceQuestionNumber']);
const mediaKeys = new Set(['role', 'kind', 'source']);
const mediaKinds = new Set<PublicMedia['kind']>(['image', 'audio', 'video', 'unknown']);

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && !Array.isArray(value) && typeof value === 'object'
    ? value as Record<string, unknown> : undefined;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function optionalString(value: Record<string, unknown>, key: string): boolean {
  return !Object.hasOwn(value, key) || typeof value[key] === 'string';
}

function optionalNumber(value: Record<string, unknown>, key: string): boolean {
  return !Object.hasOwn(value, key) || finiteNumber(value[key]);
}

function parsePresentation(value: unknown): PublicLiveState['presentation'] | undefined {
  const data = object(value);
  if (data === undefined || !hasOnlyKeys(data, presentationKeys)
    || !optionalNumber(data, 'backgroundOverlay') || !optionalNumber(data, 'answerOverlay')
    || !optionalString(data, 'sourceQuestionNumber')) return undefined;
  return {
    ...(data.backgroundOverlay === undefined ? {} : { backgroundOverlay: data.backgroundOverlay as number }),
    ...(data.answerOverlay === undefined ? {} : { answerOverlay: data.answerOverlay as number }),
    ...(data.sourceQuestionNumber === undefined ? {} : { sourceQuestionNumber: data.sourceQuestionNumber as string }),
  };
}

function parseMedia(value: unknown): readonly PublicMedia[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result: PublicMedia[] = [];
  for (const item of value) {
    const data = object(item);
    if (data === undefined || !hasOnlyKeys(data, mediaKeys)
      || (data.role !== 'prompt' && data.role !== 'background')
      || !mediaKinds.has(data.kind as PublicMedia['kind']) || typeof data.source !== 'string') return undefined;
    result.push({ role: data.role, kind: data.kind as PublicMedia['kind'], source: data.source });
  }
  return result;
}

function playbackSemantics(command: PublicLiveState['mediaCommand'], state: MediaPlaybackState): boolean {
  if (command === 'play' || command === 'replay') return state === 'preparing' || state === 'ready' || state === 'playing';
  if (command === 'finished') return state === 'finished';
  if (command === 'error') return state === 'error';
  return state === 'idle';
}

export function parsePublicLiveState(value: unknown): PublicLiveState | undefined {
  const data = object(value);
  if (data === undefined || !hasOnlyKeys(data, stateKeys)) return undefined;
  let additions: Pick<PublicLiveState, 'design' | 'showCue' | 'interimBackdrop' | 'interimResults' | 'finalReveal'>;
  try {
    let design: SlideDesign | undefined;
    if (data.design !== undefined) {
      const raw = object(data.design); if (!raw) return undefined;
      design = normalizeSlideDesign(raw);
      if (Object.keys(raw).length !== Object.keys(design).length || Object.entries(raw).some(([key, entry]) => design?.[key as keyof SlideDesign] !== entry)) return undefined;
    }
    additions = {
      ...(design === undefined ? {} : { design }),
      ...(data.showCue === undefined ? {} : { showCue: parseShowCue(data.showCue) }),
      ...(data.interimBackdrop === undefined ? {} : { interimBackdrop: parseInterimBackdrop(data.interimBackdrop) }),
      ...(data.interimResults === undefined ? {} : { interimResults: parseResultPage(data.interimResults) }),
      ...(data.finalReveal === undefined ? {} : { finalReveal: parseFinalPage(data.finalReveal) }),
    };
  } catch { return undefined; }
  if (typeof data.sessionId !== 'string' || data.sessionId.length === 0 || data.sessionId.length > 1_500
    || typeof data.quizTitle !== 'string'
    || (data.status !== 'waiting' && data.status !== 'active' && data.status !== 'ended')
    || !nonNegativeInteger(data.slidePosition)
    || !Array.isArray(data.options) || !data.options.every((item) => typeof item === 'string')
    || (data.presentationMode !== 'slide' && data.presentationMode !== 'recap')
    || !['question', 'recap', 'roundIntro', 'agenda', 'rules', 'end'].includes(data.renderMode as string)
    || !['idle', 'play', 'stop', 'replay', 'finished', 'error'].includes(data.mediaCommand as string)
    || !['idle', 'preparing', 'ready', 'playing', 'finished', 'error'].includes(data.mediaPlaybackState as string)
    || !nonNegativeInteger(data.mediaGeneration) || !nonNegativeInteger(data.introGeneration)
    || typeof data.answerRevealed !== 'boolean' || !nonNegativeInteger(data.revision)
    || !optionalString(data, 'slideKind') || !optionalString(data, 'title') || !optionalString(data, 'text')
    || !optionalString(data, 'backgroundImage') || !optionalString(data, 'questionImage')
    || !optionalString(data, 'mediaSource') || !optionalString(data, 'revealedAnswer') || !optionalString(data, 'answerImage')
    || !optionalString(data, 'roundTitle') || !optionalString(data, 'subtitle') || !optionalString(data, 'imageLayout') || !optionalString(data, 'answerExplanation')
    || !optionalNumber(data, 'backgroundOverlay') || !optionalNumber(data, 'clipStartSeconds')
    || !optionalNumber(data, 'clipEndSeconds')
    || (Object.hasOwn(data, 'questionNumber') && !nonNegativeInteger(data.questionNumber))
    || (Object.hasOwn(data, 'questionCount') && !nonNegativeInteger(data.questionCount))
    || (Object.hasOwn(data, 'recapQuestionPosition') && !nonNegativeInteger(data.recapQuestionPosition))) return undefined;
  const media = parseMedia(data.media);
  const presentation = parsePresentation(data.presentation);
  if (media === undefined || presentation === undefined
    || !playbackSemantics(data.mediaCommand as PublicLiveState['mediaCommand'], data.mediaPlaybackState as MediaPlaybackState)) return undefined;

  const hasAnswer = Object.hasOwn(data, 'revealedAnswer') || Object.hasOwn(data, 'answerImage') || Object.hasOwn(data, 'answerExplanation');
  const recapAnswer = data.presentationMode === 'recap' && data.renderMode === 'recap'
    && nonNegativeInteger(data.recapQuestionPosition) && data.recapQuestionPosition > 0
    && data.recapQuestionPosition < data.slidePosition;
  const compatibilityReveal = data.presentationMode === 'slide' && data.renderMode === 'question' && data.answerRevealed === true;
  const directReveal = data.presentationMode === 'slide' && data.renderMode === 'recap'
    && data.status === 'active' && data.slidePosition > 0 && data.answerRevealed === true;
  if ((hasAnswer && (!data.answerRevealed || (!recapAnswer && !compatibilityReveal && !directReveal)))
    || (data.answerRevealed && typeof data.revealedAnswer !== 'string')
    || (data.presentationMode === 'slide' && data.renderMode === 'recap' && !directReveal)
    || (data.presentationMode === 'recap' && data.renderMode !== 'recap')
    || (data.presentationMode === 'slide' && Object.hasOwn(data, 'recapQuestionPosition'))
    || ((data.status === 'waiting' || data.status === 'ended') && (data.answerRevealed || hasAnswer))) return undefined;

  const normalAudio = data.presentationMode === 'slide'
    && (data.slideKind === 'audio' || data.slideKind === 'music');
  if (Object.hasOwn(data, 'mediaPlaybackMode') && (data.mediaPlaybackMode !== 'original' || !data.answerRevealed || data.status !== 'active'
    || data.renderMode !== 'recap' || typeof data.mediaSource !== 'string' || !youtubeVideoId(data.mediaSource)
    || data.clipStartSeconds !== 0 || Object.hasOwn(data, 'clipEndSeconds'))) return undefined;
  if (normalAudio && data.mediaPlaybackMode !== 'original' && (Object.hasOwn(data, 'mediaSource')
    || media.some((item) => item.kind === 'audio' || item.kind === 'video'))) return undefined;

  const result = additions.interimResults ?? additions.finalReveal;
  if (additions.interimResults && additions.finalReveal) return undefined;
  if (result && (data.status !== 'active' || data.answerRevealed || hasAnswer || media.length || data.options.length
    || (data.text !== undefined && data.text !== '')
    || data.presentationMode !== 'slide' || data.renderMode !== 'question' || data.mediaCommand !== 'idle' || data.mediaPlaybackState !== 'idle'
    || ['questionImage', 'backgroundImage', 'mediaSource', 'recapQuestionPosition', 'answerImage', 'answerExplanation'].some(key => Object.hasOwn(data, key)))) return undefined;
  if (additions.interimBackdrop && (!additions.interimResults || additions.interimResults.presentationStyle !== 'show')) return undefined;
  if (additions.showCue && (!result || result.presentationStyle !== 'show')) return undefined;

  return {
    ...additions,
    ...(data.mediaPlaybackMode === 'original' ? { mediaPlaybackMode: 'original' as const } : {}),
    ...(data.roundTitle === undefined ? {} : { roundTitle: data.roundTitle as string }),
    ...(data.subtitle === undefined ? {} : { subtitle: data.subtitle as string }),
    ...(data.imageLayout === undefined ? {} : { imageLayout: data.imageLayout as string }),
    ...(data.answerExplanation === undefined ? {} : { answerExplanation: data.answerExplanation as string }),
    sessionId: data.sessionId,
    quizTitle: data.quizTitle,
    status: data.status,
    slidePosition: data.slidePosition,
    ...(data.slideKind === undefined ? {} : { slideKind: data.slideKind as string }),
    ...(data.title === undefined ? {} : { title: data.title as string }),
    ...(data.text === undefined ? {} : { text: data.text as string }),
    options: [...data.options] as string[],
    media,
    presentation,
    presentationMode: data.presentationMode,
    renderMode: data.renderMode as PublicLiveState['renderMode'],
    mediaCommand: data.mediaCommand as PublicLiveState['mediaCommand'],
    mediaPlaybackState: data.mediaPlaybackState as MediaPlaybackState,
    mediaGeneration: data.mediaGeneration,
    introGeneration: data.introGeneration,
    ...(data.questionNumber === undefined ? {} : { questionNumber: data.questionNumber as number }),
    ...(data.questionCount === undefined ? {} : { questionCount: data.questionCount as number }),
    ...(data.backgroundImage === undefined ? {} : { backgroundImage: data.backgroundImage as string }),
    ...(data.questionImage === undefined ? {} : { questionImage: data.questionImage as string }),
    ...(data.mediaSource === undefined ? {} : { mediaSource: data.mediaSource as string }),
    ...(data.backgroundOverlay === undefined ? {} : { backgroundOverlay: data.backgroundOverlay as number }),
    ...(data.clipStartSeconds === undefined ? {} : { clipStartSeconds: data.clipStartSeconds as number }),
    ...(data.clipEndSeconds === undefined ? {} : { clipEndSeconds: data.clipEndSeconds as number }),
    answerRevealed: data.answerRevealed,
    ...(data.revealedAnswer === undefined ? {} : { revealedAnswer: data.revealedAnswer as string }),
    ...(data.answerImage === undefined ? {} : { answerImage: data.answerImage as string }),
    ...(data.recapQuestionPosition === undefined ? {} : { recapQuestionPosition: data.recapQuestionPosition as number }),
    revision: data.revision,
  };
}

export function sanitizedChannelState(state: PublicLiveState): PublicLiveState {
  const candidate = {
    ...(state.mediaPlaybackMode === undefined ? {} : { mediaPlaybackMode: state.mediaPlaybackMode }),
    ...(state.design === undefined ? {} : { design: state.design }),
    ...(state.roundTitle === undefined ? {} : { roundTitle: state.roundTitle }),
    ...(state.subtitle === undefined ? {} : { subtitle: state.subtitle }),
    ...(state.imageLayout === undefined ? {} : { imageLayout: state.imageLayout }),
    ...(state.answerExplanation === undefined ? {} : { answerExplanation: state.answerExplanation }),
    ...(state.interimResults === undefined ? {} : { interimResults: state.interimResults }),
    ...(state.finalReveal === undefined ? {} : { finalReveal: state.finalReveal }),
    ...(state.interimBackdrop === undefined ? {} : { interimBackdrop: state.interimBackdrop }),
    ...(state.showCue === undefined ? {} : { showCue: state.showCue }),
    sessionId: state.sessionId, quizTitle: state.quizTitle, status: state.status, slidePosition: state.slidePosition,
    ...(state.slideKind === undefined ? {} : { slideKind: state.slideKind }),
    ...(state.title === undefined ? {} : { title: state.title }),
    ...(state.text === undefined ? {} : { text: state.text }),
    options: [...state.options],
    media: state.media.map((item) => ({ role: item.role, kind: item.kind, source: item.source })),
    presentation: {
      ...(state.presentation.backgroundOverlay === undefined ? {} : { backgroundOverlay: state.presentation.backgroundOverlay }),
      ...(state.presentation.answerOverlay === undefined ? {} : { answerOverlay: state.presentation.answerOverlay }),
      ...(state.presentation.sourceQuestionNumber === undefined ? {} : { sourceQuestionNumber: state.presentation.sourceQuestionNumber }),
    },
    presentationMode: state.presentationMode, renderMode: state.renderMode,
    mediaCommand: state.mediaCommand, mediaPlaybackState: state.mediaPlaybackState,
    mediaGeneration: state.mediaGeneration, introGeneration: state.introGeneration,
    ...(state.questionNumber === undefined ? {} : { questionNumber: state.questionNumber }),
    ...(state.questionCount === undefined ? {} : { questionCount: state.questionCount }),
    ...(state.backgroundImage === undefined ? {} : { backgroundImage: state.backgroundImage }),
    ...(state.questionImage === undefined ? {} : { questionImage: state.questionImage }),
    ...(state.mediaSource === undefined ? {} : { mediaSource: state.mediaSource }),
    ...(state.backgroundOverlay === undefined ? {} : { backgroundOverlay: state.backgroundOverlay }),
    ...(state.clipStartSeconds === undefined ? {} : { clipStartSeconds: state.clipStartSeconds }),
    ...(state.clipEndSeconds === undefined ? {} : { clipEndSeconds: state.clipEndSeconds }),
    answerRevealed: state.answerRevealed,
    ...(state.revealedAnswer === undefined ? {} : { revealedAnswer: state.revealedAnswer }),
    ...(state.answerImage === undefined ? {} : { answerImage: state.answerImage }),
    ...(state.recapQuestionPosition === undefined ? {} : { recapQuestionPosition: state.recapQuestionPosition }),
    revision: state.revision,
  };
  const parsed = parsePublicLiveState(candidate);
  if (parsed === undefined) throw new Error('Refusing to broadcast an invalid public projector state.');
  return parsed;
}

export function projectorChannelName(sessionId: string): string {
  return `filmovy-kviz-projector-${sessionId}`;
}

export function openProjectorChannel(sessionId: string): ProjectorChannel | undefined {
  if (typeof BroadcastChannel === 'undefined') return undefined;
  const channel = new BroadcastChannel(projectorChannelName(sessionId));
  return {
    postMessage: (message) => channel.postMessage(message),
    setMessageHandler: (handler) => { channel.onmessage = (event) => handler(event.data as unknown); },
    close: () => channel.close(),
  };
}

export function broadcastPublicState(channel: ProjectorChannel | undefined, state: PublicLiveState): void {
  channel?.postMessage({ type: 'public-state', state: sanitizedChannelState(state) } satisfies ProjectorChannelMessage);
}

export function broadcastPlaybackState(
  channel: ProjectorChannel | undefined,
  sessionId: string,
  mediaGeneration: number,
  playbackState: ReportablePlaybackState,
): void {
  channel?.postMessage({ type: 'playback-state', sessionId, mediaGeneration, playbackState } satisfies ProjectorChannelMessage);
}

export function parseProjectorChannelMessage(value: unknown): ProjectorChannelMessage | undefined {
  const message = object(value);
  if (message === undefined) return undefined;
  if (message.type === 'playback-state') {
    if (!hasOnlyKeys(message, new Set(['type', 'sessionId', 'mediaGeneration', 'playbackState']))
      || typeof message.sessionId !== 'string' || message.sessionId.length === 0 || message.sessionId.length > 1_500
      || !nonNegativeInteger(message.mediaGeneration)
      || !['ready', 'playing', 'error', 'finished'].includes(message.playbackState as string)) return undefined;
    return {
      type: 'playback-state', sessionId: message.sessionId, mediaGeneration: message.mediaGeneration,
      playbackState: message.playbackState as ReportablePlaybackState,
    };
  }
  if (message.type !== 'public-state' || !hasOnlyKeys(message, new Set(['type', 'state']))) return undefined;
  const state = parsePublicLiveState(message.state);
  return state === undefined ? undefined : { type: 'public-state', state };
}

export function isProjectorChannelMessage(value: unknown): value is ProjectorChannelMessage {
  return parseProjectorChannelMessage(value) !== undefined;
}

export function projectorPresentationAuthority(state: PublicLiveState): ProjectorPresentationAuthority {
  return state.interimResults || state.finalReveal || state.showCue || state.interimBackdrop || state.answerRevealed
    || state.revealedAnswer !== undefined
    || state.answerImage !== undefined
    ? 'authoritative-only'
    : 'fast-path-safe';
}

export function shouldAcceptProjectorFastPath(
  expectedSessionId: string,
  authoritativeRevision: number,
  visibleRevision: number,
  candidate: PublicLiveState,
): boolean {
  return projectorPresentationAuthority(candidate) === 'fast-path-safe'
    && candidate.sessionId === expectedSessionId
    && authoritativeRevision >= 0
    && candidate.revision === authoritativeRevision + 1
    && candidate.revision > visibleRevision;
}
