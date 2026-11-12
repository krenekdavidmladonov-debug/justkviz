import type { QuizSummary } from '../../apps/web/src/features/quizzes/types';
const params = new URLSearchParams(location.search);
const canDelete = params.get('access') !== 'reader';
export function useAuth() { return {
  can: (permission: string) => permission !== 'quiz.delete' || canDelete,
  membership: { uid: 'synthetic', quizzes: { mode: 'all', ids: [] } },
}; }
const rows: QuizSummary[] = ['Filmový večer 42', 'Druhý syntetický kvíz'].map((title, i) => ({
  id: `quiz-${i + 1}`, title, description: 'Pouze izolovaný test rozhraní', status: 'draft', revision: 7,
  disposition: 'active', roundCount: 1, questionCount: 3, createdAt: new Date('2026-10-16'),
  updatedAt: new Date('2026-10-16'), createdBy: 'synthetic', updatedBy: 'synthetic',
}));
const calls: { name: string; quizId: string; expectedRevision: number }[] = [];
declare global { interface Window { quizTrashCalls: typeof calls } }
window.quizTrashCalls = calls;
export function listQuizzes(options?: { includeTrash?: boolean }) {
  return Promise.resolve(rows.filter(row => options?.includeTrash || row.disposition !== 'trash').map(row => ({ ...row })));
}
async function transition(name: string, quizId: string, expectedRevision: number, disposition: 'trash' | 'active') {
  calls.push({ name, quizId, expectedRevision });
  await new Promise(done => setTimeout(done, 180));
  if (params.get('failure') === '1') throw Object.assign(new Error('Server rejected synthetic request'), { code: 'functions/failed-precondition' });
  const index = rows.findIndex(row => row.id === quizId);
  rows[index] = { ...rows[index]!, disposition, revision: expectedRevision + 1 };
  return { quizId, revision: expectedRevision + 1, disposition };
}
export const trashQuiz = (quizId: string, expectedRevision: number) => transition('trashQuiz', quizId, expectedRevision, 'trash');
export const restoreQuiz = (quizId: string, expectedRevision: number) => transition('restoreQuiz', quizId, expectedRevision, 'active');
export function quizTrashError() { return 'Kvíz nyní nelze smazat. Zkuste to znovu.'; }
