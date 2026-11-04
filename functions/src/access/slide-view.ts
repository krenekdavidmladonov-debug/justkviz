import { mapEditorSlide } from '@filmovy-kviz/quiz-domain';
import { verifiedOriginalYoutubeSource } from '../media/original-source.js';
import { resolveOriginalImages } from '../media/original-images.js';

/** Nominal text fields must not stringify private nested legacy metadata. */
export function slideView(slideId: string, data: Record<string, unknown>, answers: boolean, notes: boolean,
  options: { readonly preserveStoredImages?: boolean } = {}) {
  // The internal media gateway checks retained physical attachments, while browser views use original URLs.
  const safeData = { ...(options.preserveStoredImages ? data : resolveOriginalImages(data)) };
  for (const key of ['title', 'text']) if (typeof safeData[key] !== 'string') safeData[key] = '';
  if (Array.isArray(safeData.mediaSource)) safeData.mediaSource = '';
  if (Array.isArray(safeData.options)) safeData.options = safeData.options.map((value: unknown) => typeof value === 'string' ? value : '');
  const slide = mapEditorSlide(slideId, safeData);
  return { ...slide, correctAnswer: answers ? slide.correctAnswer : '', answerImage: answers ? slide.answerImage : '',
    originalMediaSource: answers ? verifiedOriginalYoutubeSource(safeData) : undefined,
    answerDesign: answers ? slide.answerDesign : undefined,
    answerExplanation: answers ? slide.answerExplanation : '', moderatorNote: notes ? slide.moderatorNote : '',
    media: slide.media.filter(m => m.role === 'prompt' || m.role === 'background' || (answers && m.role === 'answer')),
    presentation: { ...slide.presentation, answerOverlay: answers ? slide.presentation.answerOverlay : null } };
}
