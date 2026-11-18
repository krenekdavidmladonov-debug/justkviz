import { runQuizPreflight } from '@filmovy-kviz/quiz-domain';
import type { EditorQuiz, EditorSlide } from '../editor/types';
import type { PreflightFixTarget } from './types';

export { runQuizPreflight };

export function preflightFixUrl(quizId: string, target: PreflightFixTarget): string {
  const params = new URLSearchParams();
  if (target.roundId !== undefined) params.set('roundId', target.roundId);
  if (target.questionId !== undefined) params.set('questionId', target.questionId);
  if (target.systemKey !== undefined) params.set('section', target.systemKey);
  if (target.field !== undefined) params.set('field', target.field);
  const query = params.toString();
  return `/admin/quizzes/${encodeURIComponent(quizId)}/edit${query === '' ? '' : `?${query}`}`;
}

export function quizWithDraft(
  quiz: EditorQuiz,
  values: {
    readonly title: string;
    readonly description: string;
    readonly draft: EditorSlide | null;
    readonly pendingPosition?: number;
    readonly roundId?: string;
    readonly roundTitle?: string;
  },
): EditorQuiz {
  let slides = [...quiz.slides];
  if (values.draft !== null) {
    const existingIndex = slides.findIndex((slide) => slide.id === values.draft?.id);
    if (existingIndex >= 0) slides[existingIndex] = values.draft;
    else if (values.pendingPosition !== undefined) {
      const pendingPosition = values.pendingPosition;
      slides = slides.map((slide) => slide.position >= pendingPosition
        ? { ...slide, position: slide.position + 1 }
        : slide);
      slides.push({ ...values.draft, position: pendingPosition });
    }
  }
  if (values.roundId !== undefined && values.roundTitle !== undefined) {
    slides = slides.map((slide) => slide.roundId === values.roundId
      ? { ...slide, roundTitle: values.roundTitle, ...(slide.id === values.draft?.id ? { title: values.roundTitle } : {}) }
      : slide);
  }
  slides.sort((left, right) => left.position - right.position);
  return {
    ...quiz,
    title: values.title,
    description: values.description,
    slideCount: slides.length,
    questionCount: slides.filter((slide) => slide.isQuestion).length,
    slides,
  };
}
/** Recheck current UI authority even if the editor still holds a previously loaded private model. */
export function preflightVisibleQuiz(quiz: EditorQuiz, answersReadable: boolean): EditorQuiz {
  if (answersReadable) return quiz;
  return { ...quiz, slides: quiz.slides.map(slide => {
    const { answerDesign, ...visible } = slide; void answerDesign;
    return { ...visible, correctAnswer: '', answerImage: '', answerExplanation: '',
      media: slide.media.filter(media => media.role === 'prompt' || media.role === 'background') };
  }) };
}
