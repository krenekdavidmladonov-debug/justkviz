import { validateQuestion, mapEditorSlide, directMediaKind, youtubeVideoId, parseQuizAsset, mergeStoredDesign, canHideInfoSlide, type ResultTemplates } from '@filmovy-kviz/quiz-domain';
import { createHash } from 'node:crypto';

import { QuizEditorError } from './errors.js';
import type {
  EditorMediaInput,
  EditorPresentationInput,
  EditorSlideInput,
  EditorSlideKind,
} from './types.js';

export interface StoredEditorSlide {
  readonly id: string;
  readonly data: Record<string, unknown>;
}

const questionKinds = new Set<EditorSlideKind>([
  'question', 'text', 'classic', 'free', 'image', 'picture', 'photo',
  'audio', 'music', 'video', 'youtube', 'pl', 'legacy',
]);
const roundKinds = new Set<EditorSlideKind>(['round', 'roundheader', 'round-header', 'section']);

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

export function quizRevision(data: Record<string, unknown>): number {
  const value = data.revision;
  if (value === undefined) return 0;
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new QuizEditorError('failed-precondition', 'Quiz revision is malformed.');
  }
  return value as number;
}

export function assertRevision(data: Record<string, unknown>, expected: number): number {
  const current = quizRevision(data);
  if (current !== expected) {
    throw new QuizEditorError('aborted', 'The quiz changed in another editor window.');
  }
  return current;
}

export function quizCreationIdentity(actorUid: string, requestId: string, title: string): {
  readonly quizId: string;
  readonly fingerprint: string;
} {
  const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  return {
    quizId: `quiz_${digest([actorUid, requestId])}`,
    fingerprint: digest({ title }),
  };
}

export function isQuestionKind(kind: EditorSlideKind): boolean {
  return questionKinds.has(kind);
}

export function isRoundKind(kind: EditorSlideKind): boolean {
  return roundKinds.has(kind);
}

export function questionTypeForKind(kind: EditorSlideKind): 'text' | 'image' | 'audio' | 'video' | 'legacy' {
  if (kind === 'image' || kind === 'picture' || kind === 'photo') return 'image';
  if (kind === 'audio' || kind === 'music') return 'audio';
  if (kind === 'video' || kind === 'youtube') return 'video';
  if (kind === 'pl' || kind === 'legacy') return 'legacy';
  if (kind === 'question' || kind === 'text' || kind === 'classic' || kind === 'free') return 'text';
  return 'legacy';
}

function mediaUrl(source: string): { readonly url?: string; readonly domain?: string; readonly validUrl?: boolean } {
  try {
    const parsed = new URL(source);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return {};
    return { url: source, domain: parsed.hostname.toLowerCase(), validUrl: true };
  } catch {
    return {};
  }
}

function mergedMediaEntry(existing: unknown, input: EditorMediaInput): Record<string, unknown> {
  const base = isObject(existing) ? { ...existing } : {};
  const previousSource = [base.value, base.source, base.url].find(value => typeof value === 'string');
  const sameRole = input.role === base.role || (input.role === 'unknown' && typeof base.role === 'string');
  const sameKind = input.kind === base.kind || (input.kind === 'unknown' && typeof base.kind === 'string');
  if (previousSource === input.source && sameRole && sameKind) return base;
  delete base.url;
  delete base.domain;
  delete base.validUrl;
  return {
    ...base,
    role: input.role === 'unknown' && typeof base.role === 'string' && base.role !== 'unknown' ? base.role : input.role,
    kind: input.kind === 'unknown' && typeof base.kind === 'string' && base.kind !== 'unknown' ? base.kind : input.kind,
    value: input.source,
    ...mediaUrl(input.source),
  };
}

export function mergeEditorMedia(current: unknown, inputs: readonly EditorMediaInput[]): readonly unknown[] {
  const existing: unknown[] = Array.isArray(current) ? current.map((item: unknown) => item) : [];
  const patches = new Map<number, EditorMediaInput>();
  const additions: EditorMediaInput[] = [];
  for (const input of inputs) {
    if (input.sourceIndex === undefined) additions.push(input);
    else {
      if (input.sourceIndex >= existing.length) {
        throw new QuizEditorError('invalid-argument', 'Media sourceIndex is outside the current slide.');
      }
      patches.set(input.sourceIndex, input);
    }
  }
  const result = existing.flatMap((item, index) => {
    const input = patches.get(index);
    if (input === undefined) return [item];
    return input.source === '' ? [] : [mergedMediaEntry(item, input)];
  });
  for (const input of additions) {
    if (input.source !== '') result.push(mergedMediaEntry(undefined, input));
  }
  return result;
}

export function mergePresentation(current: unknown, input: EditorPresentationInput): Record<string, unknown> {
  const result = isObject(current) ? { ...current } : {};
  for (const [field, value] of Object.entries(input)) {
    const stored = result[field];
    const malformedStoredValue = field === 'sourceQuestionNumber'
      ? stored !== undefined && typeof stored !== 'string'
      : stored !== undefined && (typeof stored !== 'number' || !Number.isFinite(stored));
    if ((value === null || value === '') && malformedStoredValue) continue;
    if (value === null || value === '') delete result[field];
    else result[field] = value;
  }
  return result;
}

function editorText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  return JSON.stringify(value);
}

function keepMalformedText(current: unknown, input: string): unknown {
  return typeof current !== 'string' && current !== undefined && editorText(current) === input ? current : input;
}

function mergedOptions(current: unknown, input: readonly string[]): readonly unknown[] {
  if (!Array.isArray(current) || current.every((value) => typeof value === 'string')) return [...input];
  if (current.length === input.length && current.every((value, index) => editorText(value) === input[index])) return current;
  return [...input];
}

function applyOptionalNumber(result: Record<string, unknown>, current: Record<string, unknown>, field: string, input: number | null): void {
  const stored = current[field];
  if (input === null) {
    if (stored !== undefined && (typeof stored !== 'number' || !Number.isFinite(stored))) return;
    delete result[field];
  } else result[field] = input;
}

/** Restore unseen legacy values before validating the actual document to be saved. */
function preserveRedactedFields(current: Record<string, unknown>, input: EditorSlideInput, updated: Record<string, unknown>) {
  for (const key of ['title', 'text'] as const) {
    if (Object.hasOwn(current, key) && typeof current[key] !== 'string' && input[key] === '') updated[key] = current[key];
  }
  if (Array.isArray(current.mediaSource) && input.mediaSource === '') updated.mediaSource = current.mediaSource;
  if (Array.isArray(current.options) && current.options.length === input.options.length) {
    const stored: unknown[] = current.options;
    const merged = updated.options as unknown[];
    updated.options = merged.map((value, index) => typeof stored[index] !== 'string' && input.options[index] === '' ? stored[index] : value);
  } else if (Object.hasOwn(current, 'options') && !Array.isArray(current.options) && input.options.length === 0) updated.options = current.options;
}

export function applyKnownSlideUpdate(
  current: Record<string, unknown>,
  input: EditorSlideInput,
): Record<string, unknown> {
  const storedKind = typeof current.kind === 'string' ? current.kind : undefined;
  const preserveUnknownKind = input.kind === 'legacy'
    && storedKind !== undefined
    && !questionKinds.has(storedKind as EditorSlideKind)
    && !roundKinds.has(storedKind as EditorSlideKind);
  const result: Record<string, unknown> = {
    ...current,
    kind: preserveUnknownKind ? storedKind : input.kind,
    isQuestion: preserveUnknownKind ? current.isQuestion === true : isQuestionKind(input.kind),
    title: keepMalformedText(current.title, input.title),
    text: keepMalformedText(current.text, input.text),
    options: mergedOptions(current.options, input.options),
    media: mergeEditorMedia(current.media, input.media),
    presentation: mergePresentation(current.presentation, input.presentation),
  };
  for (const field of ['design', 'answerDesign'] as const) if (input[field] !== undefined) result[field] = mergeStoredDesign(current[field], input[field]);
  if (input.hidden !== undefined) {
    if (!canHideInfoSlide({ kind: String(result.kind), isQuestion: result.isQuestion === true, ...(typeof result.roundId === 'string' ? { roundId: result.roundId } : {}) })) throw new QuizEditorError('invalid-argument', 'Only standalone information slides can be hidden.');
    result.hidden = input.hidden;
  }
  if (input.moderatorNote === '' && !Object.hasOwn(current, 'moderatorNote')) delete result.moderatorNote;
  else result.moderatorNote = keepMalformedText(current.moderatorNote, input.moderatorNote);
  if (input.correctAnswer === '' && !Object.hasOwn(current, 'correctAnswer')) delete result.correctAnswer;
  else result.correctAnswer = keepMalformedText(current.correctAnswer, input.correctAnswer);
  const mapped = mapEditorSlide('current', { position: 1, ...current, kind: current.kind ?? input.kind });
  for (const field of ['backgroundImage', 'questionImage', 'answerImage', 'mediaSource'] as const) {
    // Equal mapped values mean no edit, retaining absent, malformed and legacy fields.
    // Explicit empty replacement shadows the legacy role without deleting its history.
    if (mapped[field] !== input[field]) result[field] = input[field];
  }
  for (const field of ['authoringStatus','answerMode','imageLayout','answerExplanation'] as const) if (input[field] !== undefined) result[field] = input[field];
  if (result.authoringStatus !== undefined && result.isQuestion !== true) throw new QuizEditorError('invalid-argument', 'Only questions can be drafts.');
  const timed = ['audio', 'music', 'video', 'youtube'].includes(input.kind);
  if (timed && input.mediaSource !== '' && mapped.mediaSource !== input.mediaSource && youtubeVideoId(input.mediaSource) === undefined
      && directMediaKind(input.mediaSource) !== (['audio', 'music'].includes(input.kind) ? 'audio' : 'video')
      && !parseQuizAsset(input.mediaSource)) {
    throw new QuizEditorError('invalid-argument', 'Nepodporovaný zdroj ukázky.');
  }
  if (input.authoringStatus !== 'draft' && timed && input.mediaSource !== '' && mapped.mediaSource !== input.mediaSource
      && (input.clipStartSeconds === null || input.clipEndSeconds === null || input.clipEndSeconds <= input.clipStartSeconds)) {
    throw new QuizEditorError('invalid-argument', 'Změna zdroje vyžaduje platný začátek a konec ukázky.');
  }
  applyOptionalNumber(result, current, 'backgroundOverlay', input.backgroundOverlay);
  const preserveLegacyZeroTiming = input.clipStartSeconds === null
    && input.clipEndSeconds === null
    && input.presentation.videoStart === 0
    && input.presentation.videoEnd === 0
    && (current.clipStartSeconds === undefined || current.clipStartSeconds === 0)
    && current.clipEndSeconds === undefined;
  if (!preserveLegacyZeroTiming) {
    applyOptionalNumber(result, current, 'clipStartSeconds', input.clipStartSeconds);
    applyOptionalNumber(result, current, 'clipEndSeconds', input.clipEndSeconds);
  }
  preserveRedactedFields(current, input, result);
  if (input.resetAppearance === true) {
    result.backgroundImage = '';
    delete result.backgroundOverlay;
    delete result.imageLayout;
    const presentation = isObject(result.presentation) ? { ...result.presentation } : {};
    delete presentation.backgroundOverlay;
    result.presentation = presentation;
  }
  if ((result.authoringStatus === 'ready' || (input.answerMode !== undefined && result.authoringStatus !== 'draft')) && validateQuestion(mapEditorSlide('current', { position: 1, ...result })).some(issue => issue.severity === 'error')) throw new QuizEditorError('invalid-argument', 'Otázka není dokončená. Uložte ji jako soukromý koncept.');
  return result;
}

export function createSlideData(
  input: EditorSlideInput,
  position: number,
  roundId?: string,
): Record<string, unknown> {
  return applyKnownSlideUpdate({
    position,
    options: [],
    media: [],
    presentation: {},
    ...(roundId === undefined ? {} : { roundId }),
  }, input);
}

export function duplicateSlideData(current: Record<string, unknown>, position: number): Record<string, unknown> {
  return { ...current, position };
}

export function mergeStoredResultTemplates(current: unknown, input: ResultTemplates): Record<string, unknown> {
  const result = isObject(current) ? { ...current } : {};
  for (const key of ['interim', 'final'] as const) {
    const previous = isObject(result[key]) ? result[key] : {};
    const template = input[key];
    const preserved = { ...previous };
    for (const field of ['title', 'subtitle', 'design']) delete preserved[field];
    const extensionDesign = mergeStoredDesign(previous.design, {});
    if (Object.keys(extensionDesign).length) preserved.design = extensionDesign;
    if (template === undefined) { if (Object.keys(preserved).length) result[key] = preserved; else delete result[key]; }
    else result[key] = { ...preserved, ...template, ...(template.design === undefined ? {} : { design: mergeStoredDesign(previous.design, template.design) }) };
  }
  return result;
}

export function sortedSlides(slides: readonly StoredEditorSlide[]): readonly StoredEditorSlide[] {
  const result = [...slides].sort((left, right) => Number(left.data.position) - Number(right.data.position));
  result.forEach((slide, index) => {
    if (!Number.isInteger(slide.data.position) || slide.data.position !== index + 1) {
      throw new QuizEditorError('failed-precondition', 'Slide positions must be unique and contiguous.');
    }
  });
  return result;
}

export function validateExistingRoundHeaderTarget(slides: readonly StoredEditorSlide[], roundId: string, position: number): void {
  const members = slides.filter(slide => slide.data.roundId === roundId);
  if (!members.length || members.some(slide => isRoundKind(slide.data.kind as EditorSlideKind) || (slide.data.kind === 'intro' && slide.data.isQuestion !== true)) || position !== members[0]?.data.position) throw new QuizEditorError('failed-precondition', 'Existing round needs an introduction at its first position.');
}
