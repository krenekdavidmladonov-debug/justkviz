import { correctOptionIndex, normalizeSlideDesign } from '@filmovy-kviz/quiz-domain';
import type {
  MediaPlaybackCommand,
  MediaPlaybackState,
  NormalizedSlideRenderModel,
  SlideContentKind,
  SlideMediaReference,
  SlideRenderInput,
  SlideRenderMode,
} from './types';

export { generatedAgendaOptions, isSafeHttpUrl, youtubeVideoId } from '@filmovy-kviz/quiz-domain';

const questionKinds = new Set(['question', 'text', 'classic']);
const imageKinds = new Set(['image', 'picture', 'photo']);
const audioKinds = new Set(['audio', 'music']);
const videoKinds = new Set(['video', 'youtube']);
const roundKinds = new Set(['round', 'roundheader', 'round-header', 'section']);

export const defaultRules = [
  'Hrajte fér.',
  'Během otázek nepoužívejte mobil ani internet.',
  'Respektujte organizátory a ostatní týmy.',
  'Užijte si kvízový večer.',
] as const;

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function clampOverlay(value: unknown): number {
  const normalized = finiteNonNegative(value);
  return normalized === undefined ? 0 : Math.min(100, normalized);
}

function mediaSource(
  media: readonly SlideMediaReference[],
  role: string,
  kind?: string,
): string | undefined {
  return media.find((item) => item.role === role && (kind === undefined || item.kind === kind) && item.source !== '')?.source;
}

function contentKind(kind: string): SlideContentKind {
  const normalized = kind.toLowerCase();
  if (questionKinds.has(normalized)) return 'question';
  if (normalized === 'free') return 'free';
  if (imageKinds.has(normalized)) return 'image';
  if (audioKinds.has(normalized)) return 'audio';
  if (videoKinds.has(normalized)) return 'video';
  if (normalized === 'pl') return 'pl';
  if (normalized === 'intro') return 'intro';
  if (roundKinds.has(normalized)) return 'roundIntro';
  if (normalized === 'agenda') return 'agenda';
  if (normalized === 'rules') return 'rules';
  if (normalized === 'recap') return 'recap';
  if (normalized === 'end') return 'end';
  if (normalized === 'title' || normalized === 'info') return 'info';
  return 'legacy';
}

function modeForKind(kind: SlideContentKind): SlideRenderMode {
  if (kind === 'recap') return 'recap';
  if (kind === 'intro' || kind === 'roundIntro') return 'roundIntro';
  if (kind === 'agenda') return 'agenda';
  if (kind === 'rules') return 'rules';
  if (kind === 'end') return 'end';
  return 'question';
}

function questionNumbers(input: SlideRenderInput): { questionNumber?: number; questionCount?: number } {
  const explicitNumber = finiteNonNegative(input.questionNumber);
  const explicitCount = finiteNonNegative(input.questionCount);
  if (explicitNumber !== undefined && explicitNumber >= 1 && Number.isInteger(explicitNumber)
    && explicitCount !== undefined && explicitCount >= explicitNumber && Number.isInteger(explicitCount)) {
    return { questionNumber: explicitNumber, questionCount: explicitCount };
  }
  const source = input.presentation?.sourceQuestionNumber;
  const match = typeof source === 'string' ? /^\s*(\d+)\s*\/\s*(\d+)\s*$/u.exec(source) : null;
  if (match === null) return {};
  const questionNumber = Number(match[1]);
  const questionCount = Number(match[2]);
  return questionNumber >= 1 && questionCount >= questionNumber ? { questionNumber, questionCount } : {};
}

export function buildSlideRenderModel(
  input: SlideRenderInput,
  requestedMode?: SlideRenderMode,
): NormalizedSlideRenderModel {
  const kind = contentKind(input.kind);
  const design = normalizeSlideDesign(input.design) ?? {};
  const numbers = questionNumbers(input);
  const presentationStart = finiteNonNegative(input.presentation?.clipStartSeconds)
    ?? finiteNonNegative(input.presentation?.videoStart);
  const presentationEnd = finiteNonNegative(input.presentation?.clipEndSeconds)
    ?? finiteNonNegative(input.presentation?.videoEnd);
  const clipStartSeconds = finiteNonNegative(input.clipStartSeconds) ?? presentationStart ?? 0;
  const endCandidate = finiteNonNegative(input.clipEndSeconds) ?? presentationEnd;
  const clipEndSeconds = endCandidate !== undefined && endCandidate > clipStartSeconds ? endCandidate : undefined;
  const promptImage = mediaSource(input.media, 'prompt', 'image');
  const promptAudio = mediaSource(input.media, 'prompt', 'audio');
  const promptVideo = mediaSource(input.media, 'prompt', 'video');
  const fallbackMedia = kind === 'audio' ? promptAudio : kind === 'video' ? promptVideo : undefined;
  const backgroundOverlay = clampOverlay(design.backgroundOverlay ?? input.backgroundOverlay ?? input.presentation?.backgroundOverlay);
  const isQuestionLike = ['question', 'free', 'image', 'audio', 'video', 'pl'].includes(kind);
  return {
    design,
    ...(input.roundTitle === undefined ? {} : { roundTitle: input.roundTitle }),
    contentKind: kind,
    renderMode: requestedMode ?? modeForKind(kind),
    title: input.title,
    text: input.text,
    options: input.options,
    ...numbers,
    ...(design.backgroundImage ?? input.backgroundImage ?? mediaSource(input.media, 'background', 'image')
      ? { backgroundImage: design.backgroundImage ?? input.backgroundImage ?? mediaSource(input.media, 'background', 'image') }
      : {}),
    ...(input.questionImage ?? (kind === 'image' ? promptImage : undefined)
      ? { questionImage: input.questionImage ?? promptImage }
      : {}),
    ...(input.answerImage ?? mediaSource(input.media, 'answer', 'image')
      ? { answerImage: input.answerImage ?? mediaSource(input.media, 'answer', 'image') }
      : {}),
    ...(input.mediaSource ?? fallbackMedia ? { mediaSource: input.mediaSource ?? fallbackMedia } : {}),
    ...(input.mediaPlaybackMode === 'original' ? { mediaPlaybackMode: 'original' as const } : {}),
    backgroundOverlay,
    clipStartSeconds,
    ...(clipEndSeconds === undefined ? {} : { clipEndSeconds }),
    ...(input.revealedAnswer === undefined ? {} : { revealedAnswer: input.revealedAnswer }),
    isQuestionLike,
    isLegacyPl: kind === 'pl',
  };
}

export function formatPlAnswer(value: string): string {
  const normalized = value.trim().toLocaleLowerCase('cs-CZ');
  if (['true', '1', 'ano', 'pravda'].includes(normalized)) return 'PRAVDA';
  if (['false', '0', 'ne', 'lež', 'lez'].includes(normalized)) return 'LEŽ';
  return value;
}

/** Resolve only the already revealed answer against the public question options. */
export function recapAnswer(model: Pick<NormalizedSlideRenderModel, 'revealedAnswer' | 'options' | 'isLegacyPl'>): { readonly text: string; readonly optionLetter?: string } | undefined {
  if (model.revealedAnswer === undefined) return undefined;
  if (model.isLegacyPl) return { text: formatPlAnswer(model.revealedAnswer) };
  const optionIndex = correctOptionIndex({ options: model.options, correctAnswer: model.revealedAnswer });
  return optionIndex === undefined
    ? { text: model.revealedAnswer }
    : { text: model.options[optionIndex]!, optionLetter: String.fromCharCode(65 + optionIndex) };
}

export interface ProjectorMediaPlan {
  readonly mountPlayer: boolean;
  readonly showQuestion: boolean;
  readonly vinylPlaying: boolean;
  readonly startSeconds: number;
  readonly endSeconds?: number;
}

export function projectorMediaPlan(
  model: NormalizedSlideRenderModel,
  command: MediaPlaybackCommand,
  playbackState: MediaPlaybackState = 'idle',
  locallyFinished = false,
  locallyFailed = false,
): ProjectorMediaPlan {
  const commanded = command === 'play' || command === 'replay';
  const failed = playbackState === 'error' || locallyFailed;
  const finished = playbackState === 'finished' || locallyFinished;
  if (model.renderMode === 'recap' && (model.contentKind === 'audio' || model.contentKind === 'video')) {
    const original = model.mediaPlaybackMode === 'original';
    return { mountPlayer: model.mediaSource !== undefined && !failed, showQuestion: true, vinylPlaying: false,
      startSeconds: original ? 0 : model.clipStartSeconds,
      ...(!original && model.clipEndSeconds !== undefined ? { endSeconds: model.clipEndSeconds } : {}) };
  }
  if (model.contentKind === 'audio') {
    return { mountPlayer: false, showQuestion: true, vinylPlaying: commanded && playbackState === 'playing' && !finished && !failed, startSeconds: model.clipStartSeconds,
      ...(model.clipEndSeconds === undefined ? {} : { endSeconds: model.clipEndSeconds }) };
  }
  if (model.contentKind === 'video') {
    const showVideo = commanded && !finished && !failed && model.mediaSource !== undefined;
    return { mountPlayer: model.mediaSource !== undefined && !failed, showQuestion: !showVideo, vinylPlaying: false,
      startSeconds: model.clipStartSeconds,
      ...(model.clipEndSeconds === undefined ? {} : { endSeconds: model.clipEndSeconds }) };
  }
  return { mountPlayer: false, showQuestion: true, vinylPlaying: false, startSeconds: 0 };
}
