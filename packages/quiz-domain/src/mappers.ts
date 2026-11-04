import { originalYoutubeSource } from './original-media.js';
import {
  editableSlideKinds,
  type EditableSlideKind,
  type EditorMedia,
  type EditorMediaKind,
  type EditorMediaRole,
  type EditorPresentation,
  type EditorQuiz,
  type EditorSlide,
} from './types.js';

import { normalizeSlideDesign, normalizeResultTemplates, normalizePrintTemplate } from './design.js';
type DocumentData = Record<string, unknown>;
const kindSet = new Set<string>(editableSlideKinds);
const mediaKinds = new Set<string>(['image', 'audio', 'video', 'unknown']);
const mediaRoles = new Set<string>(['prompt', 'answer', 'background', 'unknown']);

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && !Array.isArray(value) && typeof value === 'object'
    ? value as Record<string, unknown>
    : undefined;
}

function requiredString(data: DocumentData, field: string): string {
  if (typeof data[field] !== 'string') throw new Error(`Invalid editor field: ${field}`);
  return data[field];
}

function requiredCount(data: DocumentData, field: string): number {
  const value = data[field];
  if (!Number.isInteger(value) || (value as number) < 0) throw new Error(`Invalid editor field: ${field}`);
  return value as number;
}

function optionalText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  return JSON.stringify(value);
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function mapPresentation(value: unknown): EditorPresentation {
  const data = object(value) ?? {};
  return {
    videoStart: nullableNumber(data.videoStart),
    videoEnd: nullableNumber(data.videoEnd),
    audioTrigger: nullableNumber(data.audioTrigger),
    backgroundOverlay: nullableNumber(data.backgroundOverlay),
    answerOverlay: nullableNumber(data.answerOverlay),
    sourceQuestionNumber: typeof data.sourceQuestionNumber === 'string' ? data.sourceQuestionNumber : null,
  };
}

function mediaSource(data: Record<string, unknown>): string {
  for (const field of ['value', 'source', 'url']) {
    if (typeof data[field] === 'string') return data[field];
  }
  return '';
}

function mediaByRoleAndKind(value: unknown, role: string, kind: string): string {
  if (!Array.isArray(value)) return '';
  for (const entry of value) {
    const data = object(entry);
    if (data?.role === role && data.kind === kind) return mediaSource(data);
  }
  return '';
}

function normalizedSource(value: unknown): string {
  const data = object(value);
  return data === undefined ? optionalText(value) : mediaSource(data);
}

function mapMedia(value: unknown): readonly EditorMedia[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, sourceIndex) => {
    const data = object(entry);
    if (data === undefined) return [];
    const source = mediaSource(data);
    if (source === '') return [];
    const storedRole = typeof data.role === 'string' ? data.role : 'unknown';
    const storedKind = typeof data.kind === 'string' ? data.kind : 'unknown';
    return [{
      sourceIndex,
      role: (mediaRoles.has(storedRole) ? storedRole : 'unknown') as EditorMediaRole,
      kind: (mediaKinds.has(storedKind) ? storedKind : 'unknown') as EditorMediaKind,
      source,
    }];
  });
}

export function mapEditorSlide(id: string, data: DocumentData): EditorSlide {
  const storedKind = requiredString(data, 'kind');
  const position = requiredCount(data, 'position');
  if (position < 1) throw new Error('Invalid editor field: position');
  const mappedPresentation = mapPresentation(data.presentation);
  const normalizedKind = storedKind.toLowerCase();
  const explicitBackgroundOverlay = nullableNumber(data.backgroundOverlay);
  const explicitClipStart = nullableNumber(data.clipStartSeconds);
  const explicitClipEnd = nullableNumber(data.clipEndSeconds);
  const legacyZeroTiming = mappedPresentation.videoStart === 0
    && mappedPresentation.videoEnd === 0
    && (!Object.hasOwn(data, 'clipStartSeconds') || data.clipStartSeconds === 0)
    && !Object.hasOwn(data, 'clipEndSeconds');
  return {
    id,
    ...(originalYoutubeSource(data) === undefined ? {} : { originalMediaSource: originalYoutubeSource(data) }),
    position,
    ...(typeof data.hidden === 'boolean' ? { hidden: data.hidden } : {}),
    ...(object(data.design) ? { design: normalizeSlideDesign(data.design) } : {}),
    ...(object(data.answerDesign) ? { answerDesign: normalizeSlideDesign(data.answerDesign) } : {}),
    storedKind,
    kind: (kindSet.has(storedKind) ? storedKind : 'legacy') as EditableSlideKind,
    isQuestion: data.isQuestion === true,
    ...(data.automaticAgenda === true ? { automaticAgenda: true } : {}),
    ...(typeof data.roundId === 'string' ? { roundId: data.roundId } : {}),
    ...(typeof data.roundTitle === 'string' ? { roundTitle: data.roundTitle } : {}),
    title: optionalText(data.title),
    text: optionalText(data.text),
    moderatorNote: optionalText(data.moderatorNote),
    options: Array.isArray(data.options) ? data.options.map(optionalText) : [],
    correctAnswer: optionalText(data.correctAnswer),
    media: mapMedia(data.media),
    presentation: mappedPresentation,
    ...(Number.isInteger(data.questionNumber) ? { questionNumber: data.questionNumber as number } : {}),
    ...(Number.isInteger(data.questionCount) ? { questionCount: data.questionCount as number } : {}),
    ...(data.authoringStatus === 'draft' || data.authoringStatus === 'ready' ? { authoringStatus: data.authoringStatus } : {}),
    ...(data.answerMode === 'open' || data.answerMode === 'choice' ? { answerMode: data.answerMode } : {}),
    ...(data.imageLayout === 'split' || data.imageLayout === 'stacked' ? { imageLayout: data.imageLayout } : {}),
    ...(typeof data.answerExplanation === 'string' ? { answerExplanation: data.answerExplanation } : {}),
    backgroundImage: typeof data.backgroundImage === 'string' ? data.backgroundImage : mediaByRoleAndKind(data.media, 'background', 'image'),
    questionImage: typeof data.questionImage === 'string' ? data.questionImage : (['image', 'picture', 'photo'].includes(normalizedKind) ? mediaByRoleAndKind(data.media, 'prompt', 'image') : ''),
    answerImage: typeof data.answerImage === 'string' ? data.answerImage : mediaByRoleAndKind(data.media, 'answer', 'image'),
    mediaSource: typeof data.mediaSource === 'string' ? data.mediaSource : normalizedSource(data.mediaSource) || (['audio', 'music'].includes(normalizedKind) ? mediaByRoleAndKind(data.media, 'prompt', 'audio') : '')
      || (['video', 'youtube'].includes(normalizedKind) ? mediaByRoleAndKind(data.media, 'prompt', 'video') : ''),
    backgroundOverlay: explicitBackgroundOverlay ?? mappedPresentation.backgroundOverlay,
    clipStartSeconds: legacyZeroTiming ? null : explicitClipStart ?? mappedPresentation.videoStart,
    clipEndSeconds: legacyZeroTiming ? null : explicitClipEnd ?? mappedPresentation.videoEnd,
    hasLegacyData: object(data.legacy) !== undefined || !kindSet.has(storedKind),
  };
}

export function mapEditorQuiz(id: string, data: DocumentData, slides: readonly EditorSlide[]): EditorQuiz {
  const appearance = object(data.defaultAppearance);
  const revision = data.revision === undefined ? 0 : requiredCount(data, 'revision');
  const ordered = [...slides].sort((left, right) => left.position - right.position);
  ordered.forEach((slide, index) => {
    if (slide.position !== index + 1) throw new Error('Pořadí slidů není souvislé.');
  });
  const slideCount = requiredCount(data, 'slideCount');
  if (slideCount !== ordered.length) throw new Error('Počet slidů neodpovídá uloženému streamu.');
  return {
    id,
    title: requiredString(data, 'title'),
    description: requiredString(data, 'description'),
    status: data.status === 'ready' || data.status === 'archived' ? data.status : 'draft',
    revision,
    slideCount,
    questionCount: requiredCount(data, 'questionCount'),
    roundCount: requiredCount(data, 'roundCount'),
    slides: ordered,
    ...(object(data.printTemplate) ? { printTemplate: normalizePrintTemplate(data.printTemplate) } : {}),
    ...(object(data.defaultDesign) ? { defaultDesign: normalizeSlideDesign(data.defaultDesign) } : {}),
    ...(object(data.resultTemplates) ? { resultTemplates: normalizeResultTemplates(data.resultTemplates) } : {}),
    ...(appearance ? {defaultAppearance: {
      backgroundImage: typeof appearance.backgroundImage === 'string' ? appearance.backgroundImage : '',
      backgroundOverlay: typeof appearance.backgroundOverlay === 'number' ? appearance.backgroundOverlay : 0,
      imageLayout: appearance.imageLayout === 'stacked' ? 'stacked' as const : 'split' as const,
    }} : {}),
  };
}
