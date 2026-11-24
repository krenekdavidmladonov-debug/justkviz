import { compatibleScoringRounds, eventQuizMutationProblem, scoringRoundsFromSlides, type EditorQuiz } from '@filmovy-kviz/quiz-domain';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { getEditorQuiz } from '../editor/editorRepository';
import { eventActionError, lockEventQuiz } from './eventApi';
import { getEvent } from './eventRepository';
import type { EventRecord } from './types';
import './eventManagement.css';

export function EventQuizChangeDialog({ eventId, quizId, onClose, onSaved }: { eventId: string; quizId: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const { can } = useAuth(), dialog = useRef<HTMLDialogElement>(null), busy = useRef(false);
  const [event, setEvent] = useState<EventRecord | null>(null), [quiz, setQuiz] = useState<EditorQuiz | null>(null);
  const [loading, setLoading] = useState(true), [pending, setPending] = useState(false), [error, setError] = useState('');
  const [choice, setChoice] = useState<'' | 'preserve' | 'discard'>(''), [confirm, setConfirm] = useState(''), [closeLive, setCloseLive] = useState(false);
  useEffect(() => {
    const modal = dialog.current, previous = document.activeElement;
    modal?.showModal(); let active = true;
    void Promise.all([getEvent(eventId), getEditorQuiz(quizId)]).then(([current, source]) => {
      if (!active) return;
      if (!current?.quizChangeState || !source) throw new Error('Aktuální akci nebo kvíz se nepodařilo ověřit. Zavřete dialog a zkuste to znovu.');
      setEvent(current); setQuiz(source);
    }).catch(issue => { if (active) setError(eventActionError(issue)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; modal?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [eventId, quizId]);
  const state = event?.quizChangeState, count = state?.scoreDocumentCount ?? 0;
  const compatible = !!state && !!quiz && compatibleScoringRounds(state.snapshotRounds, quiz.scoringRounds ?? scoringRoundsFromSlides(quiz.slides));
  const problem = event && state ? eventQuizMutationProblem(event, state, 'version') : null;
  const hasLive = state?.hasActiveSession === true;
  const permitted = can('event.manage') && can('quiz.read') && can('quiz.export') && can('quiz.answers.read') && can('quiz.notes.read');
  const invalid = loading || !event || !quiz || !state || !!problem || !permitted
    || (count > 0 && (!choice || (choice === 'preserve' && !compatible) || (choice === 'discard' && (!can('event.score') || confirm !== 'SMAZAT'))))
    || (hasLive && (!can('event.live') || !closeLive));
  async function submit() {
    if (busy.current || pending || invalid || !event || !quiz) return;
    busy.current = true; setPending(true); setError('');
    try {
      await lockEventQuiz(event.id, event.revision, quiz.id, quiz.revision, false, {
        ...(count > 0 ? { scoreAction: choice as 'preserve' | 'discard' } : {}),
        ...(choice === 'discard' ? { confirm } : {}), ...(hasLive ? { closeUnplayedSession: closeLive } : {}),
      });
      await onSaved(); onClose();
    } catch (issue) { setError(eventActionError(issue)); }
    finally { busy.current = false; setPending(false); }
  }
  return <dialog ref={dialog} className="team-tool-dialog event-management-dialog" aria-labelledby="quiz-change-title" onCancel={event => { event.preventDefault(); if (!busy.current) onClose(); }}>
    <h2 id="quiz-change-title">Změnit verzi kvízu</h2>
    {loading ? <p>Ověřuji aktuální verzi, moderování a počet bodů…</p> : <>
      {event && quiz && <p>{event.quizAssignment?.quizTitle} · verze {event.quizAssignment?.quizRevision ?? '—'} → {quiz.title} · verze {quiz.revision}</p>}
      {count > 0 && <p>Akce má zapsané body: {count} {count === 1 ? 'záznam' : count >= 2 && count <= 4 ? 'záznamy' : 'záznamů'}.</p>}
      {problem && <p role="alert">{problem}</p>}
      {!permitted && <p role="alert">Změna verze vyžaduje správu akce a přístup ke zdrojovému kvízu včetně odpovědí a exportu.</p>}
      <fieldset className="manual-team-fields" disabled={pending || !!problem}>
        {count > 0 && <>
          <label><input type="radio" name="score-action" checked={choice === 'preserve'} disabled={!compatible} onChange={() => setChoice('preserve')} /> Ponechat body</label>
          {!compatible && <p>Nová verze má jiná kola – body nelze převzít.</p>}
          <label><input type="radio" name="score-action" checked={choice === 'discard'} disabled={!can('event.score')} onChange={() => setChoice('discard')} /> Zahodit body a změnit verzi</label>
          {!can('event.score') && <p>Zahození bodů navíc vyžaduje právo zapisovat body akce.</p>}
          {choice === 'discard' && <><p>Smažou se body všech týmů ve všech kolech i celá historie bodování. Staré rozepsané body a offline průběhy už nepůjdou uložit.</p><label className="form-field"><span>Pro potvrzení napište SMAZAT</span><input autoComplete="off" value={confirm} onChange={event => setConfirm(event.target.value)} /></label></>}
        </>}
        {hasLive && (can('event.live') ? <label><input type="checkbox" checked={closeLive} onChange={event => setCloseLive(event.target.checked)} /> Ukončit otevřené moderování, které zatím neukázalo otázku, a změnit verzi.</label> : <p>Moderování je otevřené. Nejprve ho ukončete tlačítkem Ukončit kvíz.</p>)}
      </fieldset>
    </>}
    {error && <p role="alert" className="round-editor-error">{error}</p>}
    <div className="team-tool-actions"><button type="button" autoFocus className="secondary-button" disabled={pending} onClick={onClose}>Zrušit</button><button type="button" className={choice === 'discard' ? 'danger-button' : 'primary-button'} disabled={pending || invalid} onClick={() => void submit()}>{pending ? 'Měním verzi…' : choice === 'discard' ? 'Zahodit body a změnit verzi' : choice === 'preserve' ? 'Ponechat body a změnit verzi' : 'Změnit verzi'}</button></div>
  </dialog>;
}
