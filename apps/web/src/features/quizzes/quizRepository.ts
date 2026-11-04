import { privateRead, type PrivateDocument } from '../access/api';
import { mapQuizQuestion, mapQuizRound, mapQuizSummary } from './quizMappers';
import type { QuizDetail, QuizSummary } from './types';

export async function listQuizzes(options: { includeTrash?: boolean } = {}): Promise<readonly QuizSummary[]> {
  const result = options.includeTrash
    ? await privateRead<PrivateDocument[]>('quizzes', { includeTrash: true })
    : await privateRead<PrivateDocument[]>('quizzes');
  return result.map(item => mapQuizSummary(item.id, item.data)).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

export async function getQuizDetail(quizId: string): Promise<QuizDetail | null> {
  const result = await privateRead<PrivateDocument & { rounds: (PrivateDocument & { questions: PrivateDocument[] })[] }>('quiz', { quizId });
  const rounds = result.rounds.map(round => mapQuizRound(round.id, round.data, round.questions.map(question => mapQuizQuestion(question.id, question.data))));
  return { ...mapQuizSummary(result.id, result.data), rounds };
}
