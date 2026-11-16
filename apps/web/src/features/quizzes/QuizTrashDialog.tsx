import { useEffect, useRef, useState } from 'react';

import { quizTrashError, trashQuiz, type QuizTrashResult } from './quizTrashApi';
import type { QuizSummary } from './types';

export function QuizTrashDialog({ quiz, onClose, onDeleted, onReload }: {
  readonly quiz: QuizSummary;
  readonly onClose: () => void;
  readonly onDeleted: (result: QuizTrashResult) => void;
  readonly onReload: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const modal = dialog.current;
    const previous = document.activeElement;
    modal?.showModal();
    return () => {
      modal?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  const submit = async () => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      onDeleted(await trashQuiz(quiz.id, quiz.revision ?? 0));
      onClose();
    } catch (reason) {
      setError(quizTrashError(reason));
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  return <dialog ref={dialog} className="editor-dialog" aria-labelledby="quiz-trash-title" aria-describedby="quiz-trash-description" onCancel={event => { event.preventDefault(); if (!busy.current) onClose(); }}>
    <h2 id="quiz-trash-title">Smazat kvíz?</h2>
    <p id="quiz-trash-description">Kvíz „{quiz.title}“ přesunete do koše. Později ho můžete obnovit.</p>
    {error && <p role="alert">{error}</p>}
    <div className="editor-dialog-actions">
      {error && <button className="secondary-button" disabled={pending} onClick={() => { onClose(); onReload(); }}>Načíst knihovnu znovu</button>}
      <button autoFocus className="secondary-button" disabled={pending} onClick={onClose}>Zrušit</button>
      <button className="danger-button" disabled={pending} onClick={() => void submit()}>{pending ? 'Mažu…' : 'Smazat kvíz'}</button>
    </div>
  </dialog>;
}
