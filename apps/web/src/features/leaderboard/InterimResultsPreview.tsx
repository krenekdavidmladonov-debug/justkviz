import { useEffect, useId, useRef } from 'react';
import { pointsText } from '../scoring/model';
import type { ResultsPreview } from './types';
import '../live/finale-readiness.css';

export function InterimResultsPreview({ rows, missing, disabled, onClose, onPublish }: {
  readonly rows: ResultsPreview['rows'];
  readonly missing: ReadonlyArray<Pick<ResultsPreview['missing'][number], 'teamId' | 'teamName'>>;
  readonly disabled: boolean;
  readonly onClose: () => void;
  readonly onPublish: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement, modal = dialog.current;
    modal?.showModal();
    return () => { modal?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  const missingTeams = [...new Map(missing.map(({ teamId, teamName }) => [teamId, teamName])).values()];
  return <dialog ref={dialog} className="finale-readiness-dialog" aria-labelledby={titleId}
    onKeyDown={event => event.stopPropagation()} onCancel={event => { event.preventDefault(); onClose(); }}>
    <h2 id={titleId}>Náhled průběžných výsledků</h2>
    {missingTeams.length > 0 && <p className="finale-score-progress" role="alert">
      <strong>Neúplné výsledky</strong><br />
      Chybí body pro týmy {missingTeams.slice(0, 20).join(', ')}{missingTeams.length > 20 && ' a další'}.
    </p>}
    <table className="interim-preview-table">
      <thead><tr><th scope="col">Pořadí</th><th scope="col">Tým</th><th scope="col">Body</th></tr></thead>
      <tbody>{rows.map((row, index) => <tr key={index}><td>{row.rank}.</td><th scope="row">{row.teamName}</th><td>{pointsText(row.halfPoints)}</td></tr>)}</tbody>
    </table>
    <div className="finale-readiness-actions">
      <button type="button" className="secondary-button" autoFocus onClick={onClose}>Zavřít náhled</button>
      <button type="button" className="primary-button" disabled={disabled} onClick={onPublish}>Ukázat sálu</button>
    </div>
  </dialog>;
}
