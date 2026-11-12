import { useEffect, useId, useRef, useState } from 'react';
import { loadHistory, saveScore, type ScoreRequest } from './api';
import { pointsText, parsePoints, scoreLabel, type Score, type ScoreHistory } from './model';

interface Props {
  eventId: string; snapshotId: string; teamId: string; roundId: string; name: string;
  layout?: 'round-table'; roundLabel?: string; roundNumber?: number; dirtyKey?: string;
  transport?: { save: typeof saveScore; history: typeof loadHistory }; stored: Score; disabled: boolean; onDirty: (id: string, dirty: boolean) => void;
}
export function ScoreRow({ eventId, snapshotId, teamId, roundId, name, stored, disabled, onDirty, transport, layout, roundLabel, roundNumber, dirtyKey = teamId }: Props) {
  const [draft, setDraft] = useState<{ text: string; reason: string; base: Score } | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const retry = useRef<ScoreRequest | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState<Score | null>(null);
  const [history, setHistory] = useState<ScoreHistory[] | null>(null);
  const [expanded, setExpanded] = useState(false);
  const formId = useId();
  const dirty = draft !== null;
  useEffect(() => { onDirty(dirtyKey, dirty || pending); }, [dirtyKey, dirty, pending, onDirty]);
  const current = conflict && conflict.revision > stored.revision ? conflict : stored;
  const stale = draft !== null && draft.base.revision !== current.revision;
  const change = (field: 'text' | 'reason', value: string) => {
    retry.current = null; setNotice(''); setError('');
    setDraft(previous => ({ ...(previous ?? { text: pointsText(current.halfPoints), reason: '', base: current }), [field]: value }));
  };
  async function save(clear = false) {
    if (busy.current || disabled || (stale && retry.current === null)) return;
    let halfPoints: number | null;
    const base = draft?.base ?? current;
    const reason = draft?.reason.trim() ?? '';
    try {
      halfPoints = clear ? null : parsePoints(draft?.text ?? pointsText(current.halfPoints));
      if ((base.halfPoints !== null || clear) && !reason) throw new Error('Doplňte stručný důvod opravy nebo vrácení na nezadáno.');
      if (base.halfPoints === halfPoints) throw new Error('Hodnota se nezměnila.');
    } catch (issue) { setError((issue as Error).message); return; }
    if (clear && !window.confirm('Vrátit výsledek týmu ' + name + (layout === 'round-table' ? ' za kolo „' + roundLabel + '“' : '') + ' na nezadáno? Historie zůstane zachována.')) return;
    const content = { eventId, snapshotId, teamId, roundId, expectedRevision: base.revision, halfPoints, reason };
    const previous = retry.current;
    const request = previous && Object.entries(content).every(([key, value]) => previous[key as keyof ScoreRequest] === value)
      ? previous : { ...content, requestId: crypto.randomUUID() };
    retry.current = request;
    busy.current = true; setPending(true); setError(''); setNotice('');
    try {
      const confirmed = await (transport?.save ?? saveScore)(request);
      retry.current = null; setDraft(null); setConflict(confirmed); setHistory(null); setExpanded(false);
      setNotice('Uložení potvrzeno serverem.');
    } catch (issue) {
      const failure = issue as { code?: string; details?: Score };
      if (failure.code === 'functions/aborted') {
        retry.current = null;
        if (failure.details && Number.isSafeInteger(failure.details.revision)) setConflict(failure.details);
        setError('Konflikt: mezitím byl uložen jiný zápis. Váš vstup zůstává zachován.');
      } else setError('Uložení se nepodařilo potvrdit. Vstup zůstal zachován; stejný požadavek můžete zopakovat.');
    } finally { busy.current = false; setPending(false); }
  }
  function discard() {
    if (!window.confirm(layout === 'round-table' ? 'Zahodit rozepsané body týmu ' + name + ' za kolo „' + roundLabel + '“?' : 'Zahodit rozepsané změny tohoto týmu?')) return;
    setDraft(null); retry.current = null; setError('');
  }
  function toggleHistory() {
    if (history) setHistory(null);
    else void (transport?.history ?? loadHistory)(eventId, teamId, roundId).then(setHistory).catch(() => setError('Historii se nepodařilo načíst.'));
  }
  const conflictView = stale && <div className="score-conflict" role="alert"><p>Aktuálně uloženo: {scoreLabel(current.halfPoints)}. Rozepsaná hodnota: {draft?.text || '(prázdná)'}. Zápis vyžaduje vaše rozhodnutí.</p><button type="button" className="secondary-button" disabled={pending || disabled} onClick={() => { retry.current = null; setDraft(previous => previous && ({ ...previous, base: current })); setError(''); }}>{layout === 'round-table' ? 'Připravit opravu uložených bodů' : 'Připravit opravu aktuální revize'}</button></div>;
  const historyView = history && <div className="score-history">{history.length === 0 ? <p>Žádné zápisy.</p> : <ol>{history.map(item => <li key={item.revision}><strong>{scoreLabel(item.previousHalfPoints)} → {scoreLabel(item.halfPoints)}</strong><span>{item.createdAt} · {item.actorLabel ?? ('uživatel ' + item.actorUid)}{layout !== 'round-table' && ' · revize ' + item.revision}</span>{item.reason && <p>{item.reason}</p>}</li>)}</ol>}</div>;
  if (layout === 'round-table') {
    const editing = current.halfPoints === null || dirty;
    const showDetails = expanded || dirty || stale || !!error;
    return <tbody className="score-round-body" aria-label={roundLabel} data-round-id={roundId}>
      <tr className="score-round-row">
        <th scope="row"><button className="score-round-label" type="button" aria-expanded={showDetails} aria-label={'Podrobnosti — ' + roundLabel} onClick={() => setExpanded(value => !value)}>{roundNumber !== undefined && <small className="score-round-number">{roundNumber}. kolo</small>}{roundLabel}<span aria-hidden="true"> {showDetails ? '▴' : '▾'}</span></button></th>
        <td>{editing ? <input className="score-round-input" form={formId} aria-label={'Body — ' + roundLabel} inputMode="decimal" value={draft?.text ?? pointsText(current.halfPoints)} disabled={disabled || pending} onChange={event => change('text', event.target.value)} /> : <strong className="score-round-value">{pointsText(current.halfPoints)}</strong>}</td>
        <td><form id={formId} onSubmit={event => { event.preventDefault(); void save(); }}>
          {editing ? <button className="primary-button" type="submit" disabled={!dirty || pending || disabled || (stale && retry.current === null)}>{pending ? 'Ukládám…' : 'Uložit'}</button> : <><span className="score-round-saved">Uloženo</span><button className="secondary-button" type="button" disabled={disabled || pending} onClick={() => { change('text', pointsText(current.halfPoints)); setExpanded(true); }}>Upravit</button></>}
        </form>{notice && !editing && <span role="status" className="score-round-confirmation">Potvrzeno serverem</span>}</td>
      </tr>
      {showDetails && <tr className="score-round-details"><td colSpan={3}>
        {dirty && <p className="event-muted">{pending ? 'Čekám na potvrzení serveru…' : 'Rozepsané body nejsou uložené.'}</p>}
        {dirty && (current.halfPoints !== null || draft?.base.halfPoints != null) && <label className="form-field"><span>Důvod opravy</span><input form={formId} aria-label={'Důvod opravy — ' + roundLabel} maxLength={300} value={draft?.reason ?? ''} disabled={disabled || pending} onChange={event => change('reason', event.target.value)} /></label>}
        {conflictView}
        {error && <p role="alert" className="round-editor-error">{error}</p>}
        <div className="score-round-options">
          {dirty && <button type="button" className="secondary-button" disabled={pending} onClick={discard}>Zahodit změny</button>}
          <button type="button" className="secondary-button" disabled={transport !== undefined && disabled} onClick={toggleHistory}>Historie změn</button>
          {dirty && current.halfPoints !== null && <button className="secondary-button" type="button" disabled={pending || disabled || stale} onClick={() => void save(true)}>Vrátit na nezadáno</button>}
        </div>
        {historyView}
      </td></tr>}
    </tbody>;
  }
  return <section className="score-row" aria-label={name}>
    <div className="event-section-heading"><h3>{name}</h3><span>{scoreLabel(current.halfPoints)} · revize {current.revision}</span></div>
    <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="score-fields">
        <label className="form-field"><span>Body — {name}</span><input inputMode="decimal" value={draft?.text ?? pointsText(current.halfPoints)} disabled={disabled || pending} onChange={event => change('text', event.target.value)} /></label>
        {(current.halfPoints !== null || draft?.base.halfPoints != null) && <label className="form-field"><span>Důvod opravy — {name}</span><input maxLength={300} value={draft?.reason ?? ''} disabled={disabled || pending} onChange={event => change('reason', event.target.value)} /></label>}
      </div>
      <p className="event-muted">{pending ? 'Čekám na potvrzení serveru…' : dirty ? 'Změněno · neuloženo' : current.halfPoints === null ? 'Výsledek není zadán.' : 'Uložený výsledek'}</p>
      {conflictView}
      <div className="team-tool-actions">
        <button className="primary-button" type="submit" disabled={!dirty || pending || disabled || (stale && retry.current === null)}>Uložit</button>
        {current.halfPoints !== null && <button className="secondary-button" type="button" disabled={pending || disabled || stale} onClick={() => void save(true)}>Vrátit na nezadáno</button>}
        {dirty && <button type="button" className="secondary-button" disabled={pending} onClick={discard}>Zahodit změny</button>}
        <button type="button" disabled={transport !== undefined && disabled} className="secondary-button" onClick={toggleHistory}>Historie změn</button>
      </div>
    </form>
    {error && <p role="alert" className="round-editor-error">{error}</p>}
    {notice && <p role="status" className="event-notice">{notice}</p>}
    {historyView}
  </section>;
}
