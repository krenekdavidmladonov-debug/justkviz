import { FunctionsError, httpsCallable } from 'firebase/functions';

import { getFirebaseServices } from '../../services/firebase/client';
import type { EditorAppearance, SlideDesign, ResultTemplates, PrintTemplate } from '@filmovy-kviz/quiz-domain';
import type { EditorMutationResponse, EditorSlide } from './types';

export const staleEditorMessage = 'Kvíz byl mezitím změněn v jiném okně. Načtěte prosím aktuální verzi a své změny zopakujte.';

function callable(name: string) {
  return httpsCallable<Record<string, unknown>, EditorMutationResponse>(getFirebaseServices().functions, name);
}

function slidePayload(slide: EditorSlide) {
  return {
    kind: slide.kind,
    ...(slide.resetAppearance === true ? { resetAppearance: true } : {}),
    ...(slide.hidden === undefined ? {} : { hidden: slide.hidden }),
    ...(slide.design === undefined ? {} : { design: slide.design }),
    ...(slide.answerDesign === undefined ? {} : { answerDesign: slide.answerDesign }),
    ...(slide.automaticAgenda === undefined ? {} : { automaticAgenda: slide.automaticAgenda }),
    ...(slide.authoringStatus === undefined ? {} : { authoringStatus: slide.authoringStatus }),
    ...(slide.answerMode === undefined ? {} : { answerMode: slide.answerMode }),
    ...(slide.imageLayout === undefined ? {} : { imageLayout: slide.imageLayout }),
    ...(slide.answerExplanation === undefined ? {} : { answerExplanation: slide.answerExplanation }),
    title: slide.title,
    text: slide.text,
    moderatorNote: slide.moderatorNote,
    options: [...slide.options],
    correctAnswer: slide.correctAnswer,
    media: slide.media.map((media) => ({ ...media })),
    presentation: { ...slide.presentation },
    backgroundImage: slide.backgroundImage,
    questionImage: slide.questionImage,
    answerImage: slide.answerImage,
    mediaSource: slide.mediaSource,
    backgroundOverlay: slide.backgroundOverlay,
    clipStartSeconds: slide.clipStartSeconds,
    clipEndSeconds: slide.clipEndSeconds,
  };
}

async function invoke(name: string, data: Record<string, unknown>): Promise<EditorMutationResponse> {
  try {
    return (await callable(name)(data)).data;
  } catch (error) {
    if (error instanceof FunctionsError && error.code === 'functions/aborted') {
      throw new Error(staleEditorMessage, { cause: error });
    }
    throw error;
  }
}

export const createQuiz = (title: string, requestId: string) => (
  invoke('createQuiz', { title, requestId })
);
export const updateQuizMetadata = (quizId: string, revision: number, title: string, description: string, defaultAppearance?: EditorAppearance, defaultDesign?: SlideDesign, resultTemplates?: ResultTemplates, printTemplate?: PrintTemplate, status?: 'draft' | 'ready') => (
  invoke('updateQuizMetadata', { quizId, expectedRevision: revision, quiz: { title, description, ...(defaultAppearance === undefined ? {} : { defaultAppearance }), ...(defaultDesign === undefined ? {} : { defaultDesign }), ...(resultTemplates === undefined ? {} : { resultTemplates }), ...(printTemplate === undefined ? {} : { printTemplate }), ...(status === undefined ? {} : { status }) } })
);
export const updateQuizSlide = (quizId: string, revision: number, slide: EditorSlide) => (
  invoke('updateQuizSlide', { quizId, slideId: slide.id, expectedRevision: revision, slide: slidePayload(slide) })
);
export const repairQuizChoiceAnswer = (quizId: string, revision: number, slideId: string, optionIndex: number) => (
  invoke('repairQuizPreflightIssue', {
    quizId, slideId, expectedRevision: revision, kind: 'choice-answer', optionIndex,
  })
);
export const repairQuizVideoTiming = (
  quizId: string,
  revision: number,
  slideId: string,
  clipStartSeconds: number,
  clipEndSeconds: number,
) => invoke('repairQuizPreflightIssue', {
  quizId, slideId, expectedRevision: revision, kind: 'video-timing', clipStartSeconds, clipEndSeconds,
});
export const createQuizSlide = (quizId: string, revision: number, position: number, slide: EditorSlide, scope?: 'quiz', roundId?: string) => (
  invoke('createQuizSlide', { quizId, expectedRevision: revision, position, slide: slidePayload(slide), ...(scope === undefined ? {} : { scope }), ...(roundId === undefined ? {} : { roundId }) })
);
export const duplicateQuizSlide = (quizId: string, revision: number, slideId: string) => (
  invoke('duplicateQuizSlide', { quizId, slideId, expectedRevision: revision })
);
export const deleteQuizSlide = (quizId: string, revision: number, slideId: string) => (
  invoke('deleteQuizSlide', { quizId, slideId, expectedRevision: revision })
);
export const moveQuizSlide = (quizId: string, revision: number, slideId: string, direction: -1 | 1) => (
  invoke('moveQuizSlide', { quizId, slideId, direction, expectedRevision: revision })
);
export const updateQuizRound = (quizId: string, revision: number, roundId: string, title: string) => (
  invoke('updateQuizRound', { quizId, roundId, title, expectedRevision: revision })
);
export const reorderQuizQuestion = (quizId: string, revision: number, slideId: string, direction: -1 | 1) => (
  invoke('reorderQuizQuestion', { quizId, slideId, direction, expectedRevision: revision })
);
export const moveQuizQuestionToRound = (quizId: string, revision: number, slideId: string, targetRoundId: string) => (
  invoke('moveQuizQuestionToRound', { quizId, slideId, targetRoundId, expectedRevision: revision })
);
export const duplicateQuizRound = (quizId: string, revision: number, roundId: string) => (
  invoke('duplicateQuizRound', { quizId, roundId, expectedRevision: revision })
);
export const moveQuizRound = (quizId: string, revision: number, roundId: string, direction: -1 | 1) => (
  invoke('moveQuizRound', { quizId, roundId, direction, expectedRevision: revision })
);
export const removeQuizRound = (
  quizId: string,
  revision: number,
  roundId: string,
  mode: 'delete' | 'move',
  targetRoundId?: string,
) => invoke('removeQuizRound', { quizId, roundId, mode, expectedRevision: revision, ...(targetRoundId ? { targetRoundId } : {}) });

export const createQuizRound = (quizId: string, revision: number, title: string) => invoke('createQuizRound', { quizId, expectedRevision: revision, title });
