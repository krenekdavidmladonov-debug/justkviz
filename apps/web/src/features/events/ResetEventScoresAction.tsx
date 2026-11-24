import { eventQuizMutationProblem } from '@filmovy-kviz/quiz-domain';
import { useEffect, useRef, useState } from 'react';
import { eventActionError, resetEventScores } from './eventApi';
import { getEvent } from './eventRepository';
import type { EventRecord } from './types';
import './eventManagement.css';

export function ResetEventScoresAction({ event, onSaved }: { event: EventRecord; onSaved: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const problem = event.quizChangeState ? eventQuizMutationProblem(event, event.quizChangeState, 'reset') : null;
  return <div className="event-quick-action">
    <button type="button" className="danger-button" disabled={!!problem} onClick={() => setOpen(true)}>Smazat všechny body</button>
    {problem && <small>{problem}</small>}
    {open && <ResetDialog eventId={event.id} onClose={() => setOpen(false)} onSaved={onSaved} />}
  </div>;
}
function ResetDialog({ eventId, onClose, onSaved }: { eventId: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const modal = useRef<HTMLDialogElement>(null), busy = useRef(false);
  const [event, setEvent] = useState<EventRecord | null>(null), [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false), [error, setError] = useState(''), [confirm, setConfirm] = useState('');
  const [requestId] = useState(() => crypto.randomUUID());
  useEffect(() => {
    const dialog = modal.current, previous = document.activeElement; dialog?.showModal(); let active = true;
    void getEvent(eventId).then(current => {
      if (!active) return;
      if (!current?.quizChangeState) throw new Error('Aktuální stav akce se nepodařilo ověřit. Zavřete dialog a zkuste to znovu.');
      setEvent(current);
    }).catch(issue => { if (active) setError(eventActionError(issue)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; dialog?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [eventId]);
  const count = event?.quizChangeState?.scoreDocumentCount ?? 0;
  const problem = event?.quizChangeState ? eventQuizMutationProblem(event, event.quizChangeState, 'reset') : null;
  async function submit() {
    if (busy.current || loading || !event || problem || confirm !== 'SMAZAT') return;
    busy.current = true; setPending(true); setError('');
    try { await resetEventScores(event.id, event.revision, requestId, confirm); await onSaved(); onClose(); }
    catch (issue) { setError(eventActionError(issue)); }
    finally { busy.current = false; setPending(false); }
  }
  return <dialog ref={modal} className="team-tool-dialog event-management-dialog" aria-labelledby="reset-scores-title" onCancel={event => { event.preventDefault(); if (!busy.current) onClose(); }}>
    <h2 id="reset-scores-title">Smazat všechny body</h2>
    {loading ? <p>Ověřuji moderování a počet bodů…</p> : event && <><p>Akce má zapsané body: {count} {count === 1 ? 'záznam' : count >= 2 && count <= 4 ? 'záznamy' : 'záznamů'}.</p><p>Smažou se všechny body akce ve všech kolech včetně historie. Týmy a připravený kvíz zůstanou zachované. Staré rozepsané body a offline průběhy už nepůjdou uložit.</p></>}
    {problem && <p role="alert">{problem}</p>}
    {error && <p role="alert" className="round-editor-error">{error}</p>}
    <label className="form-field"><span>Pro potvrzení napište SMAZAT</span><input autoComplete="off" disabled={pending || loading || !event || !!problem} value={confirm} onChange={event => setConfirm(event.target.value)} /></label>
    <div className="team-tool-actions"><button type="button" autoFocus className="secondary-button" disabled={pending} onClick={onClose}>Zrušit</button><button type="button" className="danger-button" disabled={pending || loading || !event || !!problem || confirm !== 'SMAZAT'} onClick={() => void submit()}>{pending ? 'Mažu body…' : 'Smazat všechny body'}</button></div>
  </dialog>;
}
