import { parseFinalPage } from '../final-reveal/types';
import { normalizeSlideDesign, normalizeShowPreferences, parseInterimBackdrop, parseShowCue } from '@filmovy-kviz/quiz-domain';
import { parsePublicLiveState } from './projectorChannel';
import { parseResultPage } from '../leaderboard/types';
import type { DocumentData } from 'firebase/firestore';

import type { MediaPlaybackCommand, MediaPlaybackState, SlidePresentationInput } from '../presentation/types';
import type {
  LiveControlMedia,
  LiveControlSlide,
  LiveControlState,
  LivePresentationMode,
  LiveRenderMode,
  LiveSessionStatus,
  PublicLiveState,
  PublicMedia,
} from './types';

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && !Array.isArray(value) && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

function requiredString(data: DocumentData, field: string): string {
  const value: unknown = data[field];
  if (typeof value !== 'string') throw new Error(`Invalid live field: ${field}`);
  return value;
}

function requiredNumber(data: DocumentData, field: string): number {
  const value: unknown = data[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid live field: ${field}`);
  return value;
}

function optionalString(data: DocumentData, field: string): string | undefined {
  const value: unknown = data[field];
  return typeof value === 'string' ? value : undefined;
}

function optionalNumber(data: DocumentData, field: string): number | undefined {
  const value: unknown = data[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function status(data: DocumentData): LiveSessionStatus {
  const value = requiredString(data, 'status');
  if (value !== 'waiting' && value !== 'active' && value !== 'ended') throw new Error('Invalid live field: status');
  return value;
}

function presentationMode(data: DocumentData): LivePresentationMode {
  return data.presentationMode === 'recap' ? 'recap' : 'slide';
}

function renderMode(data: DocumentData): LiveRenderMode {
  const value: unknown = data.renderMode;
  if (value === 'recap' || value === 'roundIntro' || value === 'agenda'
    || value === 'rules' || value === 'end') return value;
  return 'question';
}

function mediaCommand(data: DocumentData): MediaPlaybackCommand {
  const value: unknown = data.mediaCommand;
  if (value === 'play' || value === 'stop' || value === 'replay' || value === 'finished' || value === 'error') return value;
  return 'idle';
}

function mediaPlaybackState(data: DocumentData): MediaPlaybackState {
  const value: unknown = data.mediaPlaybackState;
  if (value === 'idle' || value === 'preparing' || value === 'ready' || value === 'playing'
    || value === 'finished' || value === 'error') return value;
  const command = mediaCommand(data);
  if (command === 'play' || command === 'replay') return 'preparing';
  if (command === 'finished') return 'finished';
  if (command === 'error') return 'error';
  return 'idle';
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function media(value: unknown): readonly LiveControlMedia[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const data = object(entry);
    if (data === undefined || typeof data.role !== 'string' || typeof data.kind !== 'string') return [];
    const source = ['source', 'url', 'value'].map((field) => data[field]).find((item): item is string => typeof item === 'string');
    return source === undefined ? [] : [{ role: data.role, kind: data.kind, source }];
  });
}

function publicMedia(value: unknown): readonly PublicMedia[] {
  return media(value).flatMap((item) => (
    (item.role === 'prompt' || item.role === 'background')
    && ['image', 'audio', 'video', 'unknown'].includes(item.kind)
      ? [{ ...item, role: item.role, kind: item.kind as PublicMedia['kind'] }]
      : []
  ));
}

function presentation(value: unknown): SlidePresentationInput {
  const data = object(value) ?? {};
  return {
    ...(optionalNumber(data, 'backgroundOverlay') === undefined ? {} : { backgroundOverlay: optionalNumber(data, 'backgroundOverlay') }),
    ...(optionalNumber(data, 'answerOverlay') === undefined ? {} : { answerOverlay: optionalNumber(data, 'answerOverlay') }),
    ...(optionalString(data, 'sourceQuestionNumber') === undefined ? {} : { sourceQuestionNumber: optionalString(data, 'sourceQuestionNumber') }),
    ...(optionalNumber(data, 'videoStart') === undefined ? {} : { videoStart: optionalNumber(data, 'videoStart') }),
    ...(optionalNumber(data, 'videoEnd') === undefined ? {} : { videoEnd: optionalNumber(data, 'videoEnd') }),
  };
}

export function mapLiveControlState(id: string, data: DocumentData): LiveControlState {
  return {
    ...(data.mediaPlaybackMode === 'original' ? { mediaPlaybackMode: 'original' as const } : {}),
    ...(data.showPreferences === undefined ? {} : { showPreferences: normalizeShowPreferences(data.showPreferences) }),
    ...(data.showCue === undefined ? {} : { showCue: parseShowCue(data.showCue) }),
    sessionId: id,
    quizId: requiredString(data, 'quizId'),
    ...(typeof data.eventId === 'string' ? { eventId: data.eventId } : {}),
    ...(typeof data.snapshotId === 'string' ? { snapshotId: data.snapshotId } : {}),
    ...(object(data.finalReveal) ? { finalReveal: data.finalReveal as NonNullable<LiveControlState["finalReveal"]> } : {}),
    ...(object(data.interimResults) ? { interimResults: data.interimResults as NonNullable<LiveControlState['interimResults']> } : {}),
    quizTitle: requiredString(data, 'quizTitle'),
    slideCount: requiredNumber(data, 'slideCount'),
    status: status(data),
    currentSlidePosition: requiredNumber(data, 'currentSlidePosition'),
    ...(optionalString(data, 'currentSlideId') === undefined ? {} : { currentSlideId: optionalString(data, 'currentSlideId') }),
    answerRevealed: data.answerRevealed === true,
    presentationMode: presentationMode(data),
    ...(optionalNumber(data, 'recapQuestionPosition') === undefined ? {} : { recapQuestionPosition: optionalNumber(data, 'recapQuestionPosition') }),
    ...(optionalString(data, 'recapQuestionId') === undefined ? {} : { recapQuestionId: optionalString(data, 'recapQuestionId') }),
    mediaCommand: mediaCommand(data),
    mediaPlaybackState: mediaPlaybackState(data),
    mediaGeneration: optionalNumber(data, 'mediaGeneration') ?? 0,
    introGeneration: optionalNumber(data, 'introGeneration') ?? 0,
    revision: requiredNumber(data, 'revision'),
  };
}

export function mapLiveControlSlide(id: string, data: DocumentData): LiveControlSlide {
  return {
    ...(optionalString(data, 'originalMediaSource') === undefined ? {} : { originalMediaSource: optionalString(data, 'originalMediaSource') }),
    ...(data.hidden === true ? { hidden: true } : {}),
    ...(object(data.design) ? { design: normalizeSlideDesign(data.design) } : {}),
    ...(object(data.answerDesign) ? { answerDesign: normalizeSlideDesign(data.answerDesign) } : {}),
    id,
    position: requiredNumber(data, 'position'),
    kind: requiredString(data, 'kind'),
    isQuestion: data.isQuestion === true,
    ...(optionalString(data, 'roundId') === undefined ? {} : { roundId: optionalString(data, 'roundId') }),
    ...(optionalString(data, 'roundTitle') === undefined ? {} : { roundTitle: optionalString(data, 'roundTitle') }),
    ...(optionalNumber(data, 'questionNumber') === undefined ? {} : { questionNumber: optionalNumber(data, 'questionNumber') }),
    ...(optionalNumber(data, 'questionCount') === undefined ? {} : { questionCount: optionalNumber(data, 'questionCount') }),
    title: optionalString(data, 'title') ?? '',
    text: optionalString(data, 'text') ?? '',
    options: stringArray(data.options),
    media: media(data.media),
    presentation: presentation(data.presentation),
    ...(optionalString(data, 'backgroundImage') === undefined ? {} : { backgroundImage: optionalString(data, 'backgroundImage') }),
    ...(optionalString(data, 'questionImage') === undefined ? {} : { questionImage: optionalString(data, 'questionImage') }),
    ...(optionalString(data, 'imageLayout') === undefined ? {} : { imageLayout: optionalString(data, 'imageLayout') }),
    ...(optionalString(data, 'answerExplanation') === undefined ? {} : { answerExplanation: optionalString(data, 'answerExplanation') }),
    ...(optionalString(data, 'answerImage') === undefined ? {} : { answerImage: optionalString(data, 'answerImage') }),
    ...(optionalString(data, 'mediaSource') === undefined ? {} : { mediaSource: optionalString(data, 'mediaSource') }),
    ...(optionalNumber(data, 'backgroundOverlay') === undefined ? {} : { backgroundOverlay: optionalNumber(data, 'backgroundOverlay') }),
    ...(optionalNumber(data, 'clipStartSeconds') === undefined ? {} : { clipStartSeconds: optionalNumber(data, 'clipStartSeconds') }),
    ...(optionalNumber(data, 'clipEndSeconds') === undefined ? {} : { clipEndSeconds: optionalNumber(data, 'clipEndSeconds') }),
    ...(optionalString(data, 'correctAnswer') === undefined ? {} : { correctAnswer: optionalString(data, 'correctAnswer') }),
    ...(optionalString(data, 'moderatorNote') === undefined ? {} : { moderatorNote: optionalString(data, 'moderatorNote') }),
  };
}

export function mapPublicLiveState(id: string, data: DocumentData): PublicLiveState {
  if (data.mediaPlaybackMode !== undefined && (data.mediaPlaybackMode !== 'original' || data.answerRevealed !== true || data.renderMode !== 'recap')) throw new Error('Unsafe original video presentation.');
  if ((data.interimResults || data.finalReveal) && (data.status !== "active" || data.answerRevealed || data.mediaPlaybackState !== "idle" || data.revealedAnswer || data.recapQuestionPosition || data.mediaSource)) throw new Error("Unsafe result presentation.");
  if (data.finalReveal && data.interimResults) throw new Error("Conflicting result presentation.");
  const mapped: PublicLiveState = {
    ...(data.mediaPlaybackMode === 'original' && data.answerRevealed === true && data.renderMode === 'recap' ? { mediaPlaybackMode: 'original' as const } : {}),
    ...(data.showCue === undefined ? {} : { showCue: parseShowCue(data.showCue) }),
    ...(data.interimBackdrop === undefined ? {} : { interimBackdrop: parseInterimBackdrop(data.interimBackdrop) }),
    ...(object(data.design) ? { design: normalizeSlideDesign(data.design) } : {}),
    ...(optionalString(data, 'roundTitle') === undefined ? {} : { roundTitle: optionalString(data, 'roundTitle') }),
    ...(optionalString(data, 'subtitle') === undefined ? {} : { subtitle: optionalString(data, 'subtitle') }),
    sessionId: id,
    ...(data.finalReveal === undefined ? {} : { finalReveal: parseFinalPage(data.finalReveal) }),
    quizTitle: requiredString(data, 'quizTitle'),
    status: status(data),
    slidePosition: requiredNumber(data, 'slidePosition'),
    ...(data.interimResults === undefined ? {} : { interimResults: parseResultPage(data.interimResults) }),
    ...(optionalString(data, 'slideKind') === undefined ? {} : { slideKind: optionalString(data, 'slideKind') }),
    ...(optionalString(data, 'title') === undefined ? {} : { title: optionalString(data, 'title') }),
    ...(optionalString(data, 'text') === undefined ? {} : { text: optionalString(data, 'text') }),
    options: stringArray(data.options),
    media: publicMedia(data.media),
    presentation: presentation(data.presentation),
    presentationMode: presentationMode(data),
    renderMode: renderMode(data),
    mediaCommand: mediaCommand(data),
    mediaPlaybackState: mediaPlaybackState(data),
    mediaGeneration: optionalNumber(data, 'mediaGeneration') ?? 0,
    introGeneration: optionalNumber(data, 'introGeneration') ?? 0,
    ...(optionalNumber(data, 'questionNumber') === undefined ? {} : { questionNumber: optionalNumber(data, 'questionNumber') }),
    ...(optionalNumber(data, 'questionCount') === undefined ? {} : { questionCount: optionalNumber(data, 'questionCount') }),
    ...(optionalString(data, 'backgroundImage') === undefined ? {} : { backgroundImage: optionalString(data, 'backgroundImage') }),
    ...(optionalString(data, 'questionImage') === undefined ? {} : { questionImage: optionalString(data, 'questionImage') }),
    ...(optionalString(data, 'mediaSource') === undefined ? {} : { mediaSource: optionalString(data, 'mediaSource') }),
    ...(optionalNumber(data, 'backgroundOverlay') === undefined ? {} : { backgroundOverlay: optionalNumber(data, 'backgroundOverlay') }),
    ...(optionalNumber(data, 'clipStartSeconds') === undefined ? {} : { clipStartSeconds: optionalNumber(data, 'clipStartSeconds') }),
    ...(optionalNumber(data, 'clipEndSeconds') === undefined ? {} : { clipEndSeconds: optionalNumber(data, 'clipEndSeconds') }),
    answerRevealed: data.answerRevealed === true,
    ...(optionalString(data, 'revealedAnswer') === undefined ? {} : { revealedAnswer: optionalString(data, 'revealedAnswer') }),
    ...(optionalString(data, 'imageLayout') === undefined ? {} : { imageLayout: optionalString(data, 'imageLayout') }),
    ...(optionalString(data, 'answerExplanation') === undefined ? {} : { answerExplanation: optionalString(data, 'answerExplanation') }),
    ...(optionalString(data, 'answerImage') === undefined ? {} : { answerImage: optionalString(data, 'answerImage') }),
    ...(optionalNumber(data, 'recapQuestionPosition') === undefined ? {} : { recapQuestionPosition: optionalNumber(data, 'recapQuestionPosition') }),
    revision: requiredNumber(data, 'revision'),
  };
  // New result payloads are a strict public boundary; do not silently drop private
  // extras or normalize malformed server publications into apparently safe data.
  if (data.mediaPlaybackMode !== undefined || data.interimResults !== undefined || data.finalReveal !== undefined || data.interimBackdrop !== undefined || data.showCue !== undefined) {
    const raw = { ...data }; delete raw.updatedAt;
    if (raw.sessionId !== undefined && raw.sessionId !== id) throw new Error('Invalid public session identity.');
    const parsed = parsePublicLiveState({ ...mapped, ...raw, sessionId: id });
    if (!parsed) throw new Error('Unsafe public result presentation.');
    return parsed;
  }
  return mapped;
}
