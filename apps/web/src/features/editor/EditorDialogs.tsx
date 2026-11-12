import { useEffect, useRef, useState } from 'react';

import type { SemanticRound } from './semanticModel';
import type { EditorSlide } from './types';

export function UnsavedChangesDialog({
  busy,
  saveLabel = 'Uložit a pokračovat',
  onSave,
  onDiscard,
  onCancel,
}: {
  readonly busy: boolean;
  readonly saveLabel?: string;
  readonly onSave: () => void;
  readonly onDiscard: () => void;
  readonly onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [opener] = useState(() => document.activeElement);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog !== null && !dialog.open) dialog.showModal();
    cancelRef.current?.focus();
    return () => {
      if (dialog?.open) dialog.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [opener]);
  return (
    <dialog ref={dialogRef} className="editor-dialog" aria-labelledby="unsaved-dialog-title" onCancel={(event) => { event.preventDefault(); onCancel(); }}>
      <h2 id="unsaved-dialog-title">Máte neuložené změny.</h2>
      <p>Než budete pokračovat, zvolte, co se má s rozepsanými změnami stát.</p>
      <div className="editor-dialog-actions">
        <button type="button" className="primary-button" disabled={busy} onClick={onSave}>{saveLabel}</button>
        <button type="button" className="secondary-button" disabled={busy} onClick={onDiscard}>Pokračovat bez uložení</button>
        <button ref={cancelRef} type="button" className="secondary-button" disabled={busy} onClick={onCancel}>Zrušit</button>
      </div>
    </dialog>
  );
}

export function RemoveRoundDialog({
  round,
  rounds,
  busy,
  error,
  onMove,
  onDelete,
  onCancel,
}: {
  readonly round: SemanticRound;
  readonly rounds: readonly SemanticRound[];
  readonly busy: boolean;
  readonly error?: string | null;
  readonly onMove: (targetRoundId: string) => void;
  readonly onDelete: () => void;
  readonly onCancel: () => void;
}) {
  const targets = rounds.filter((item) => item.id !== round.id && item.id !== 'roundless');
  const [targetRoundId, setTargetRoundId] = useState(targets[0]?.id ?? '');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [opener] = useState(() => document.activeElement);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog !== null && !dialog.open) dialog.showModal();
    cancelRef.current?.focus();
    return () => {
      if (dialog?.open) dialog.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [opener]);
  return (
    <dialog ref={dialogRef} className="editor-dialog" aria-labelledby="remove-round-title" onCancel={(event) => { event.preventDefault(); if (!busy) onCancel(); }}>
      <h2 id="remove-round-title">Smazat kolo „{round.title}“?</h2>
      <p>Kolo obsahuje {round.questions.length} {round.questions.length === 1 ? 'otázku' : 'otázek'}.</p>
      {round.questions.length > 0 && targets.length > 0 && (
        <label className="form-field">Přesunout otázky do jiného kola
          <select disabled={busy} value={targetRoundId} onChange={(event) => setTargetRoundId(event.target.value)}>
            {targets.map((target) => <option key={target.id} value={target.id}>{target.position}. kolo – {target.title}</option>)}
          </select>
        </label>
      )}
      {error && <p role="alert" className="round-editor-error">{error}</p>}
      <div className="editor-dialog-actions vertical-actions">
        {round.questions.length > 0 && targets.length > 0 && (
          <button type="button" className="secondary-button" disabled={busy || targetRoundId === ''} onClick={() => onMove(targetRoundId)}>
            {busy ? 'Provádím změnu…' : 'Přesunout otázky a smazat kolo'}
          </button>
        )}
        <button type="button" className="danger-button" disabled={busy} onClick={onDelete}>
          {busy ? 'Provádím změnu…' : `Smazat kolo včetně ${round.questions.length} ${round.questions.length === 1 ? 'otázky' : 'otázek'}`}
        </button>
        <button ref={cancelRef} type="button" className="secondary-button" disabled={busy} onClick={onCancel}>Zrušit</button>
      </div>
    </dialog>
  );
}

export function RemoveQuestionDialog({ question, busy, error, onDelete, onCancel }: {
  readonly question: EditorSlide;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onDelete: () => void;
  readonly onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null), cancelRef = useRef<HTMLButtonElement>(null);
  const [opener] = useState(() => document.activeElement);
  useEffect(() => {
    const modal = dialogRef.current; modal?.showModal(); cancelRef.current?.focus();
    return () => { modal?.close(); if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true }); };
  }, [opener]);
  return <dialog ref={dialogRef} className="editor-dialog" aria-labelledby="remove-question-title" onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
    <h2 id="remove-question-title">Smazat otázku?</h2>
    {question.roundTitle && <p>Kolo: {question.roundTitle}</p>}
    <p className="editor-delete-question-name"><strong>{question.text || question.title || 'Otázka bez zadání'}</strong></p>
    <p>Otázka se odstraní z kvízu v knihovně. Již připravené verze akcí zůstanou zachované.</p>
    {error && <p role="alert" className="round-editor-error">{error}</p>}
    <div className="editor-dialog-actions"><button ref={cancelRef} type="button" className="secondary-button" disabled={busy} onClick={onCancel}>Zrušit</button><button type="button" className="danger-button" disabled={busy} aria-busy={busy} onClick={onDelete}>{busy ? 'Mažu otázku…' : 'Smazat otázku'}</button></div>
  </dialog>;
}
