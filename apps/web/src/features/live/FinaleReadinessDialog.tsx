import { useEffect, useRef } from 'react';
import type { ResultsPreview } from '../leaderboard/types';
import './finale-readiness.css';

export function FinaleReadinessDialog({ preview, eventId, onClose, onRetry, onPreview }: {
  readonly preview: ResultsPreview;
  readonly eventId: string;
  readonly onClose: () => void;
  readonly onRetry: () => void;
  readonly onPreview?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement, modal = dialog.current;
    modal?.showModal();
    return () => { modal?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  const missing = preview.missing ?? [];
  const rounds = preview.includedRounds ?? [];
  const total = preview.rows.length * rounds.length;
  return <dialog ref={dialog} className="finale-readiness-dialog" aria-labelledby="finale-readiness-title"
    onKeyDown={event => event.stopPropagation()} onCancel={event => { event.preventDefault(); onClose(); }}>
    <h2 id="finale-readiness-title">{preview.rows.length ? 'Finále čeká na body' : 'Finále čeká na týmy'}</h2>
    {preview.rows.length ? <>
      <p>Rozhodčí musí nejprve uložit body všech týmů ve všech kolech. I nulu je potřeba výslovně zapsat.</p>
      <p className="finale-score-progress"><strong>{Math.max(0, total - missing.length)} / {total}</strong> výsledků uložených · chybí {missing.length}</p>
      <div className="finale-missing-rounds">{rounds.map(round => {
        const entries = missing.filter(cell => cell.roundId === round.id);
        if (!entries.length) return null;
        return <section key={round.id}><h3>{round.position}. kolo · {round.title}</h3><p>Chybí: {entries.slice(0, 20).map(cell => cell.teamName).join(', ')}{entries.length > 20 ? ` a dalších ${entries.length - 20} týmů` : ''}</p></section>;
      })}</div>
    </> : <p>Zatím nejsou přihlášené týmy. V bodování přidejte týmy a zapište jejich výsledky.</p>}
    <div className="finale-readiness-actions">
      {onPreview && <button type="button" className="secondary-button" onClick={onPreview}>Náhled s ukázkovými týmy</button>}
      <a className="primary-button" href={`/admin/events/${encodeURIComponent(eventId)}/scoring`} target="_blank" rel="noreferrer">Otevřít bodování ↗</a>
      <button type="button" className="secondary-button" onClick={onRetry}>Zkontrolovat znovu</button>
      <button type="button" className="secondary-button" onClick={onClose}>Zpět do kvízu</button>
    </div>
  </dialog>;
}
