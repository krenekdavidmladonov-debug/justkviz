import { parseQuizAsset, normalizeSlideDesign, slideDesignKeys, normalizePrintTemplate, printTemplateKeys, type PrintTemplate, type SlideDesign, type ResultTemplates } from '@filmovy-kviz/quiz-domain';
import { HttpsError } from 'firebase-functions/v2/https';

import { QuizEditorError } from './errors.js';
import {
  editorSlideKinds,
  type EditorMediaInput,
  type EditorMediaKind,
  type EditorMediaRole,
  type EditorPresentationInput,
  type EditorSlideInput,
  type EditorSlideKind,
} from './types.js';

const editorKindSet = new Set<string>(editorSlideKinds);
const mediaKindSet = new Set<EditorMediaKind>(['image', 'audio', 'video', 'unknown']);
const mediaRoleSet = new Set<EditorMediaRole>(['prompt', 'answer', 'background', 'unknown']);

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

export function requiredId(data: unknown, field: string): string {
  if (!isObject(data) || typeof data[field] !== 'string') {
    throw new HttpsError('invalid-argument', `${field} is required.`);
  }
  const value = data[field];
  if (value.length === 0 || value.length > 1_500 || value.includes('/')) {
    throw new HttpsError('invalid-argument', `${field} is invalid.`);
  }
  return value;
}

export function expectedRevision(data: unknown): number {
  if (!isObject(data) || !Number.isInteger(data.expectedRevision) || (data.expectedRevision as number) < 0) {
    throw new HttpsError('invalid-argument', 'expectedRevision must be a non-negative integer.');
  }
  return data.expectedRevision as number;
}

export function requestedPosition(data: unknown): number {
  if (!isObject(data) || !Number.isInteger(data.position) || (data.position as number) < 1) {
    throw new HttpsError('invalid-argument', 'position must be a positive integer.');
  }
  return data.position as number;
}

export function requestedDirection(data: unknown): -1 | 1 {
  if (!isObject(data) || (data.direction !== -1 && data.direction !== 1)) {
    throw new HttpsError('invalid-argument', 'direction must be -1 or 1.');
  }
  return data.direction;
}

export function requestedRoundTitle(data: unknown): string {
  if (!isObject(data)) throw new HttpsError('invalid-argument', 'Request data is required.');
  return boundedString(data.title, 'round title', 300, false);
}

export function requestedRoundRemovalMode(data: unknown): 'delete' | 'move' {
  if (!isObject(data) || (data.mode !== 'delete' && data.mode !== 'move')) {
    throw new HttpsError('invalid-argument', 'mode must be delete or move.');
  }
  return data.mode;
}

export function requestedSlide(data: unknown): EditorSlideInput {
  if (!isObject(data)) throw new HttpsError('invalid-argument', 'Request data is required.');
  return validateSlideInput(data.slide);
}

function boundedString(value: unknown, field: string, maximum: number, allowEmpty = true): string {
  if (typeof value !== 'string' || value.length > maximum || (!allowEmpty && value.trim().length === 0)) {
    throw new QuizEditorError('invalid-argument', `${field} is invalid.`);
  }
  return value;
}

export function validateSlideDesign(value: unknown): SlideDesign {
  if (!isObject(value) || Object.keys(value).some(key => !(slideDesignKeys as readonly string[]).includes(key))) throw new QuizEditorError('invalid-argument', 'Design is invalid.');
  const normalized = normalizeSlideDesign(value);
  if (Object.keys(normalized).length !== Object.keys(value).length) throw new QuizEditorError('invalid-argument', 'Design is invalid.');
  return normalized;
}
export function validateResultTemplates(value: unknown): ResultTemplates {
  if (!isObject(value) || Object.keys(value).some(key => !['interim', 'final'].includes(key))) throw new QuizEditorError('invalid-argument', 'Result templates are invalid.');
  return Object.fromEntries(Object.entries(value).map(([key, template]) => {
    if (!isObject(template) || Object.keys(template).some(field => !['title', 'subtitle', 'design'].includes(field))) throw new QuizEditorError('invalid-argument', 'Result template is invalid.');
    return [key, { ...(template.title === undefined ? {} : { title: boundedString(template.title, 'result title', 500) }), ...(template.subtitle === undefined ? {} : { subtitle: boundedString(template.subtitle, 'result subtitle', 2000) }), ...(template.design === undefined ? {} : { design: validateSlideDesign(template.design) }) }];
  }));
}
export function validatePrintTemplate(value: unknown): PrintTemplate {
  if (!isObject(value) || Object.keys(value).some(key => !(printTemplateKeys as readonly string[]).includes(key))) throw new QuizEditorError('invalid-argument', 'Print template is invalid.');
  for (const [field, maximum] of [['title', 120], ['instructions', 400], ['footer', 160], ['logoText', 40]] as const) if (value[field] !== undefined) boundedString(value[field], field, maximum);
  const normalized = normalizePrintTemplate(value);
  if (Object.keys(normalized).length !== Object.keys(value).length) throw new QuizEditorError('invalid-argument', 'Print template is invalid.');
  return normalized;
}
export function validateQuizMetadata(value: unknown): { readonly title: string; readonly description: string; readonly status?: 'draft' | 'ready'; readonly printTemplate?: PrintTemplate; readonly defaultDesign?: SlideDesign; readonly resultTemplates?: ResultTemplates; readonly defaultAppearance?: { readonly backgroundImage: string; readonly backgroundOverlay: number; readonly imageLayout: 'split' | 'stacked' } } {
  if (!isObject(value)) throw new QuizEditorError('invalid-argument', 'Quiz metadata is required.');
  if (value.status !== undefined && value.status !== 'draft' && value.status !== 'ready') throw new QuizEditorError('invalid-argument', 'Quiz status is invalid.');
  let defaultAppearance;
  if (value.defaultAppearance !== undefined) {
    const appearance = value.defaultAppearance;
    if (!isObject(appearance) || !['split','stacked'].includes(appearance.imageLayout as string)) throw new QuizEditorError('invalid-argument', 'Default appearance is invalid.');
    const overlay = nullableNumber(appearance.backgroundOverlay,'default background overlay',100);
    if (overlay === null) throw new QuizEditorError('invalid-argument', 'Default overlay is required.');
    defaultAppearance = {backgroundImage:validateNormalizedImage(appearance.backgroundImage,'default background'),backgroundOverlay:overlay,imageLayout:appearance.imageLayout as 'split' | 'stacked'};
  }
  return {
    ...(value.status === undefined ? {} : { status: value.status }),
    ...(value.printTemplate === undefined ? {} : { printTemplate: validatePrintTemplate(value.printTemplate) }),
    ...(value.defaultDesign === undefined ? {} : { defaultDesign: validateSlideDesign(value.defaultDesign) }),
    ...(value.resultTemplates === undefined ? {} : { resultTemplates: validateResultTemplates(value.resultTemplates) }),
    ...(defaultAppearance === undefined ? {} : {defaultAppearance}),
    title: boundedString(value.title, 'title', 300, false),
    description: boundedString(value.description, 'description', 5_000),
  };
}

export function requestedQuizCreation(data: unknown): { readonly title: string; readonly requestId: string } {
  if (!isObject(data)) throw new QuizEditorError('invalid-argument', 'Request data is required.');
  const unknownField = Object.keys(data).find((field) => field !== 'title' && field !== 'requestId');
  if (unknownField !== undefined) throw new QuizEditorError('invalid-argument', 'Quiz creation request is invalid.');
  const requestId = requiredId(data, 'requestId');
  if (requestId.length > 150) throw new QuizEditorError('invalid-argument', 'requestId is too long.');
  return {
    title: boundedString(data.title, 'title', 300, false).trim(),
    requestId,
  };
}

function nullableNumber(value: unknown, field: string, maximum: number): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximum) {
    throw new QuizEditorError('invalid-argument', `${field} is invalid.`);
  }
  return value;
}

function validatePresentation(value: unknown): EditorPresentationInput {
  if (!isObject(value)) throw new QuizEditorError('invalid-argument', 'presentation is required.');
  const result: EditorPresentationInput = {
    videoStart: nullableNumber(value.videoStart, 'videoStart', 86_400),
    videoEnd: nullableNumber(value.videoEnd, 'videoEnd', 86_400),
    audioTrigger: nullableNumber(value.audioTrigger, 'audioTrigger', 86_400),
    backgroundOverlay: nullableNumber(value.backgroundOverlay, 'backgroundOverlay', 100),
    answerOverlay: nullableNumber(value.answerOverlay, 'answerOverlay', 100),
    sourceQuestionNumber: value.sourceQuestionNumber === null
      ? null
      : boundedString(value.sourceQuestionNumber, 'sourceQuestionNumber', 100),
  };
  if (result.videoStart !== null && result.videoEnd !== null
    && !(result.videoStart === 0 && result.videoEnd === 0)
    && result.videoStart >= result.videoEnd) {
    throw new QuizEditorError('invalid-argument', 'videoEnd must be greater than videoStart.');
  }
  return result;
}

function validateNormalizedImage(value: unknown, field: string): string {
  const source = value === undefined ? '' : boundedString(value, field, 4_096);
  if (source === '' || parseQuizAsset(source)) return source;
  let parsed: URL;
  try { parsed = new URL(source); }
  catch { throw new QuizEditorError('invalid-argument', `${field} must be an http(s) URL.`); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new QuizEditorError('invalid-argument', `${field} must be an http(s) URL.`);
  }
  return source;
}

function validateNormalizedMediaSource(value: unknown): string {
  const source = value === undefined ? '' : boundedString(value, 'mediaSource', 4_096);
  if (source === '' || parseQuizAsset(source) || /^[\w-]{11}$/u.test(source)) return source;
  try {
    const parsed = new URL(source);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return source;
  } catch {
    // Fall through to one sanitized error without echoing the source.
  }
  throw new QuizEditorError('invalid-argument', 'mediaSource must be an http(s) URL or YouTube video ID.');
}

function validateMediaSource(source: unknown, role: EditorMediaRole, kind: EditorMediaKind): string {
  const value = boundedString(source, 'media source', 4_096);
  if (value === '') return value;
  let parsed: URL | undefined;
  try {
    parsed = new URL(value);
  } catch {
    parsed = undefined;
  }
  const looksLikeScheme = /^[a-z][a-z\d+.-]*:/iu.test(value);
  if (parsed !== undefined && parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new QuizEditorError('invalid-argument', 'Media URL must use http or https.');
  }
  if (looksLikeScheme && parsed === undefined) {
    throw new QuizEditorError('invalid-argument', 'Media URL is invalid.');
  }
  if ((role === 'background' || role === 'answer' || kind === 'image')
    && (parsed === undefined || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:'))) {
    throw new QuizEditorError('invalid-argument', 'Image media must be an http(s) URL.');
  }
  return value;
}

function validateMedia(value: unknown): readonly EditorMediaInput[] {
  if (!Array.isArray(value) || value.length > 20) {
    throw new QuizEditorError('invalid-argument', 'media must be an array with at most 20 entries.');
  }
  const seenIndexes = new Set<number>();
  return value.map((item) => {
    if (!isObject(item) || !mediaRoleSet.has(item.role as EditorMediaRole)
      || !mediaKindSet.has(item.kind as EditorMediaKind)) {
      throw new QuizEditorError('invalid-argument', 'Media entry is invalid.');
    }
    const sourceIndex = item.sourceIndex;
    if (sourceIndex !== undefined
      && (!Number.isInteger(sourceIndex) || (sourceIndex as number) < 0 || seenIndexes.has(sourceIndex as number))) {
      throw new QuizEditorError('invalid-argument', 'Media sourceIndex is invalid.');
    }
    if (sourceIndex !== undefined) seenIndexes.add(sourceIndex as number);
    const role = item.role as EditorMediaRole;
    const kind = item.kind as EditorMediaKind;
    return {
      ...(sourceIndex === undefined ? {} : { sourceIndex: sourceIndex as number }),
      role,
      kind,
      source: validateMediaSource(item.source, role, kind),
    };
  });
}

export function validateSlideInput(value: unknown): EditorSlideInput {
  if (!isObject(value) || !editorKindSet.has(value.kind as string)) {
    throw new QuizEditorError('invalid-argument', 'Slide type is invalid.');
  }
  if (!Array.isArray(value.options) || value.options.length > 30) {
    throw new QuizEditorError('invalid-argument', 'options must contain at most 30 values.');
  }
  if (value.hidden !== undefined && typeof value.hidden !== 'boolean') throw new QuizEditorError('invalid-argument', 'hidden is invalid.');
  if (value.resetAppearance !== undefined && value.resetAppearance !== true) throw new QuizEditorError('invalid-argument', 'Appearance reset is invalid.');
  const options = value.options.map((option) => boundedString(option, 'option', 1_000));
  const presentation = validatePresentation(value.presentation);
  const clipStartSeconds = value.clipStartSeconds === undefined
    ? presentation.videoStart
    : nullableNumber(value.clipStartSeconds, 'clipStartSeconds', 86_400);
  const clipEndSeconds = value.clipEndSeconds === undefined
    ? presentation.videoEnd
    : nullableNumber(value.clipEndSeconds, 'clipEndSeconds', 86_400);
  if (clipStartSeconds !== null && clipEndSeconds !== null && clipStartSeconds >= clipEndSeconds) {
    throw new QuizEditorError('invalid-argument', 'clipEndSeconds must be greater than clipStartSeconds.');
  }
  for (const [field, allowed] of Object.entries({ authoringStatus: ['draft','ready'], answerMode: ['open','choice'], imageLayout: ['split','stacked'] })) {
    if (value[field] !== undefined && !allowed.includes(value[field] as string)) throw new QuizEditorError('invalid-argument', field + ' is invalid.');
  }
  return {
    ...(value.resetAppearance === true ? { resetAppearance: true as const } : {}),
    ...(value.hidden === undefined ? {} : { hidden: value.hidden }),
    ...(value.design === undefined ? {} : { design: validateSlideDesign(value.design) }),
    ...(value.answerDesign === undefined ? {} : { answerDesign: validateSlideDesign(value.answerDesign) }),
    ...(value.authoringStatus === undefined ? {} : { authoringStatus: value.authoringStatus as 'draft' | 'ready' }),
    ...(value.answerMode === undefined ? {} : { answerMode: value.answerMode as 'open' | 'choice' }),
    ...(value.imageLayout === undefined ? {} : { imageLayout: value.imageLayout as 'split' | 'stacked' }),
    ...(value.answerExplanation === undefined ? {} : { answerExplanation: boundedString(value.answerExplanation, 'answerExplanation', 5000) }),
    kind: value.kind as EditorSlideKind,
    title: boundedString(value.title, 'slide title', 500),
    text: boundedString(value.text, 'slide text', 20_000),
    moderatorNote: boundedString(value.moderatorNote, 'moderatorNote', 10_000),
    options,
    correctAnswer: boundedString(value.correctAnswer, 'correctAnswer', 20_000),
    media: validateMedia(value.media),
    presentation,
    backgroundImage: validateNormalizedImage(value.backgroundImage, 'backgroundImage'),
    questionImage: validateNormalizedImage(value.questionImage, 'questionImage'),
    answerImage: validateNormalizedImage(value.answerImage, 'answerImage'),
    mediaSource: validateNormalizedMediaSource(value.mediaSource),
    backgroundOverlay: value.backgroundOverlay === undefined
      ? presentation.backgroundOverlay
      : nullableNumber(value.backgroundOverlay, 'backgroundOverlay', 100),
    clipStartSeconds,
    clipEndSeconds,
  };
}
