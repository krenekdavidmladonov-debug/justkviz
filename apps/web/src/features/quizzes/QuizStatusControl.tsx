import { useRef, useState } from 'react';

import { useAuth } from '../../auth/AuthProvider';
import { updateQuizMetadata } from '../editor/editorApi';
import { quizStatusLabels } from './presentation';
import type { QuizStatus } from './types';
import './quizControls.css';

/** The author's library label is independent of the optional content check. */
export function QuizStatusControl({ quiz, disabled = false, onChanged }: {
  readonly quiz: { readonly id: string; readonly title: string; readonly description: string; readonly revision?: number; readonly status?: QuizStatus };
  readonly disabled?: boolean;
  readonly onChanged: () => void | Promise<unknown>;
}) {
  const { can } = useAuth();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = quiz.status ?? 'draft';

  async function changeStatus() {
    if (busy.current || disabled || !can('quiz.edit') || status === 'archived') return;
    busy.current = true; setPending(true); setError(null);
    try {
      await updateQuizMetadata(quiz.id, quiz.revision ?? 0, quiz.title, quiz.description, undefined, undefined, undefined, undefined, status === 'ready' ? 'draft' : 'ready');
      await onChanged();
    } catch {
      setError('Stav se nepodařilo změnit. Načtěte aktuální kvíz a zkuste to znovu.');
    } finally { busy.current = false; setPending(false); }
  }

  return <span className="quiz-status-control">
    <span className={`quiz-status status-${status}`}>{quizStatusLabels[status]}</span>
    {can('quiz.edit') && status !== 'archived' && <button type="button" className="text-button" disabled={disabled || pending} aria-busy={pending} onClick={() => void changeStatus()}>{pending ? 'Ukládám stav…' : status === 'ready' ? 'Vrátit do konceptů' : 'Označit jako připravený'}</button>}
    {error && <span role="alert">{error}</span>}
  </span>;
}
