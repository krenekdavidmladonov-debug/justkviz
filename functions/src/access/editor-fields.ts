import { mapEditorSlide } from '@filmovy-kviz/quiz-domain';
import { HttpsError } from 'firebase-functions/v2/https';
import type { EditorSlideInput } from '../editor/types.js';
import { currentMembership } from './authorization.js';
import { isQuestionKind } from '../editor/model.js';
import { slideView } from './slide-view.js';
import { resolveOriginalImages } from '../media/original-images.js';

const answerKeys = ['correctAnswer', 'answerImage', 'answerExplanation', 'answerMode', 'answerDesign'] as const;
const mediaKeys = ['backgroundImage', 'questionImage', 'mediaSource'] as const;
const equal = (a: unknown, b: unknown) => JSON.stringify(a ?? '') === JSON.stringify(b ?? '');
const deny = () => { throw new HttpsError('permission-denied', 'Tato změna vyžaduje další oprávnění.'); };
export function protectPrivateMedia(slides: readonly { data: Record<string, unknown> }[], inputs: readonly Record<string, unknown>[]) {
  if (currentMembership().permissions.includes('quiz.answers.read')) return;
  const hidden = new Set<string>();
  for (const slide of slides) for (const data of [slide.data, resolveOriginalImages(slide.data)]) {
    const mapped = mapEditorSlide('source', data);
    for (const source of [mapped.answerImage, mapped.answerDesign?.backgroundImage, mapped.answerDesign?.logoImage,
      ...mapped.media.filter(media => media.role === 'answer').map(media => media.source)]) if (source) hidden.add(source);
  }
  for (const input of inputs) {
    const sources: unknown[] = [input.backgroundImage, input.questionImage, input.mediaSource];
    if (input.design && typeof input.design === 'object') sources.push(...['backgroundImage', 'logoImage'].map(field => (input.design as Record<string, unknown>)[field]));
    if (Array.isArray(input.media)) for (const entry of input.media as unknown[]) {
      if (entry && typeof entry === 'object' && 'role' in entry && (entry.role === 'prompt' || entry.role === 'background') && 'source' in entry) sources.push(entry.source);
    }
    if (sources.some(source => typeof source === 'string' && hidden.has(source))) deny();
  }
}
export function protectSlideFields(current: Record<string, unknown> | undefined, input: EditorSlideInput): EditorSlideInput {
  const member = currentMembership(), allowed = member.permissions;
  const previous = current ? mapEditorSlide('current', resolveOriginalImages(current)) : undefined;
  const visible = current ? slideView('current', current, allowed.includes('quiz.answers.read'), allowed.includes('quiz.notes.read')) : undefined;
  if (!allowed.includes('quiz.answers.edit')) {
    // Options and question kind affect the meaning/validation of a hidden answer.
    if (previous && (previous.isQuestion || isQuestionKind(previous.kind) || isQuestionKind(input.kind))
      && (!equal(input.options, visible?.options) || input.kind !== previous.kind)) deny();
    for (const key of answerKeys) {
      // answerMode describes the editable presentation; its value is not an answer secret.
      const visible = key === 'answerMode' || allowed.includes('quiz.answers.read');
      const expected = visible ? previous?.[key] : '';
      if (!equal(input[key], expected) && !(key === 'answerMode' && !previous && input[key] === 'open')) deny();
    }
    const expectedMedia = allowed.includes('quiz.answers.read') ? previous?.media.filter(m => m.role === 'answer') ?? [] : [];
    if (!equal(input.media.filter(m => m.role === 'answer'), expectedMedia)) deny();
  }
  if (!allowed.includes('quiz.notes.edit') && !equal(input.moderatorNote, allowed.includes('quiz.notes.read') ? previous?.moderatorNote : '')) deny();
  if (!allowed.includes('quiz.media.attach')) {
    if (input.resetAppearance === true && previous?.backgroundImage) deny();
    for (const key of mediaKeys) if (!equal(input[key], visible?.[key])) deny();
    const visibleMedia = (previous?.media ?? []).filter(m => m.role === 'prompt' || m.role === 'background' || (allowed.includes('quiz.answers.read') && m.role === 'answer'));
    if (!equal(input.media, visibleMedia)) deny();
    if (allowed.includes('quiz.answers.read') && !equal(input.answerImage, previous?.answerImage)) deny();
    for (const key of ['design', 'answerDesign'] as const) if (input[key] !== undefined) for (const field of ['backgroundImage', 'logoImage'] as const) if (!equal(input[key]?.[field], visible?.[key]?.[field])) deny();
  }
  if (!previous) return input;
  return {
    ...input,
    ...(!allowed.includes('quiz.answers.edit') ? { correctAnswer: previous.correctAnswer, answerImage: previous.answerImage,
      answerExplanation: previous.answerExplanation, answerMode: previous.answerMode,
      answerDesign: previous.answerDesign,
      media: [...input.media.filter(m => m.role !== 'answer'), ...previous.media.filter(m => m.role === 'answer')],
      presentation: { ...input.presentation, answerOverlay: previous.presentation.answerOverlay } } : {}),
    ...(!allowed.includes('quiz.notes.edit') ? { moderatorNote: previous.moderatorNote } : {}),
  };
}
/** Reapply exact stored protected fields so redacted saves cannot normalize or erase them. */
export function preserveHiddenFields(current: Record<string, unknown>, updated: Record<string, unknown>) {
  const allowed = currentMembership().permissions;
  const protectedKeys: string[] = [...(!allowed.includes('quiz.answers.edit') ? answerKeys : []), ...(!allowed.includes('quiz.notes.edit') ? ['moderatorNote'] : [])];
  for (const key of protectedKeys) {
    if (Object.hasOwn(current, key)) updated[key] = current[key]; else delete updated[key];
  }
  return updated;
}
