import { accessCall } from '../access/api';

export interface QuizTrashResult {
  readonly quizId: string;
  readonly revision: number;
  readonly disposition: 'active' | 'trash';
}

export const trashQuiz = (quizId: string, expectedRevision: number) => (
  accessCall<QuizTrashResult>('trashQuiz', { quizId, expectedRevision })
);
export const restoreQuiz = (quizId: string, expectedRevision: number) => (
  accessCall<QuizTrashResult>('restoreQuiz', { quizId, expectedRevision })
);

export function quizTrashError(reason: unknown): string {
  const code = reason && typeof reason === 'object' && 'code' in reason ? reason.code : '';
  if (code === 'functions/aborted') return 'Kvíz byl mezitím změněn. Načtěte knihovnu znovu a akci zopakujte.';
  if (code === 'functions/permission-denied' || code === 'functions/unauthenticated') return 'Pro tuto akci už nemáte oprávnění. Zkontrolujte své přihlášení.';
  if (code === 'functions/failed-precondition') {
    const message = reason && typeof reason === 'object' && 'message' in reason ? reason.message : '';
    return typeof message === 'string' && message.trim()
      ? message
      : 'Stav kvízu teď tuto akci neumožňuje. Načtěte knihovnu znovu a akci zopakujte.';
  }
  return 'Akci se nepodařilo dokončit. Zkontrolujte připojení a zkuste to znovu. Kvíz zůstává v přehledu.';
}
