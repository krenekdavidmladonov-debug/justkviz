import { moveQuizQuestionToRound, moveQuizRound, reorderQuizQuestion } from './editorApi';
import { buildSemanticQuizModel } from './semanticModel';
import type { EditorQuiz } from './types';

/** Existing revision-checked operations; abort on the first unacknowledged write. */
export async function moveOutlineQuestion(quiz: EditorQuiz, id: string, targetRoundId: string | undefined, beforeId?: string) {
  const source = quiz.slides.find(slide => slide.id === id && slide.isQuestion);
  if (!source || beforeId === id) return;
  const target = quiz.slides.filter(slide => slide.isQuestion && slide.roundId === targetRoundId && slide.id !== id).sort((a, b) => a.position - b.position);
  const destination = beforeId === undefined ? target.length : target.findIndex(slide => slide.id === beforeId);
  if (destination < 0) throw new Error('Cílová otázka již není v tomto kole. Obnovte editor.');
  let revision = quiz.revision;
  let currentIndex: number;
  if (source.roundId !== targetRoundId) {
    if (!targetRoundId) throw new Error('Otázku lze přesunout pouze do existujícího kola.');
    const result = await moveQuizQuestionToRound(quiz.id, revision, id, targetRoundId);
    revision = result.revision; currentIndex = target.length;
  } else {
    currentIndex = quiz.slides.filter(slide => slide.isQuestion && slide.roundId === targetRoundId).sort((a, b) => a.position - b.position).findIndex(slide => slide.id === id);
  }
  while (currentIndex !== destination) {
    const direction = currentIndex < destination ? 1 : -1;
    const result = await reorderQuizQuestion(quiz.id, revision, id, direction);
    revision = result.revision; currentIndex += direction;
  }
}

/** A round moves with all its questions and system slides through the trusted API. */
export async function moveOutlineRound(quiz: EditorQuiz, id: string, beforeId?: string) {
  const rounds = buildSemanticQuizModel(quiz).rounds.filter(round => round.id !== 'roundless');
  let currentIndex = rounds.findIndex(round => round.id === id);
  if (currentIndex < 0) throw new Error('Přesouvané kolo již neexistuje. Obnovte editor.');
  if (id === beforeId) return;
  const others = rounds.filter(round => round.id !== id);
  const destination = beforeId === undefined ? others.length : others.findIndex(round => round.id === beforeId);
  if (destination < 0) throw new Error('Cílové kolo již neexistuje. Obnovte editor.');
  let revision = quiz.revision;
  while (currentIndex !== destination) {
    const direction = currentIndex < destination ? 1 : -1;
    const result = await moveQuizRound(quiz.id, revision, id, direction);
    revision = result.revision;
    currentIndex += direction;
  }
}
