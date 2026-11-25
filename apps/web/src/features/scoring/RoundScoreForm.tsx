import { useEffect, useRef, useState } from 'react';
import { loadHistory, saveRoundScores, type RoundScoreRequest, type RoundScoreResponse } from './api';
import { emptyScore, parseRoundPoints, pointsText, scoreLabel, type Score, type ScoreHistory } from './model';

type Draft = { text: string; reason: string; clear: boolean; base: Score; teamName: string };
interface Props {
  eventId: string; snapshotId: string; scoringEpoch?: number | undefined; roundId: string; roundTitle: string; questionCount?: number | undefined;
  teams: { id: string; name: string; accepted?: boolean }[]; scores: Record<string, Score>; disabled: boolean;
  preserveRemovedDrafts?: boolean;
  onDirty: (dirty: boolean) => void; onPending: (pending: boolean) => void;
  transport?: { save: (request: RoundScoreRequest) => Promise<RoundScoreResponse>; history: typeof loadHistory };
}
function draftPoints(draft: Draft) {
  if (draft.clear) return { halfPoints: null };
  if (draft.text.trim() === pointsText(draft.base.halfPoints)) {
    return { halfPoints: draft.base.halfPoints };
  }
  try { return { halfPoints: parseRoundPoints(draft.text) }; }
  catch (error) { return { error: (error as Error).message }; }
}

export function RoundScoreForm({ eventId, snapshotId, scoringEpoch, roundId, roundTitle, questionCount, teams, scores, disabled, onDirty, onPending, transport, preserveRemovedDrafts = false }: Props) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const form = useRef<HTMLFormElement>(null);
  const [confirmed, setConfirmed] = useState<Record<string, Score>>({});
  const [conflicts, setConflicts] = useState<Record<string, Score>>({});
  const [pending, setPending] = useState(false);
  const busy = useRef(false), retry = useRef<RoundScoreRequest | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [histories, setHistories] = useState<Record<string, ScoreHistory[]>>({});
  useEffect(() => {
    const accepted = new Set(teams.filter(team => team.accepted !== false).map(team => team.id));
    if (!Object.keys(drafts).some(id => !accepted.has(id))) return;
    if (preserveRemovedDrafts) {
      if (retry.current?.scores.some(score => !accepted.has(score.teamId))) retry.current = null;
      return;
    }
    setDrafts(current => Object.fromEntries(Object.entries(current).filter(([id]) => accepted.has(id))));
    retry.current = null;
    setError('Soupiska se změnila. Rozepsané body vyřazených týmů byly odstraněny; ostatní zůstávají.');
  }, [teams, drafts, preserveRemovedDrafts]);
  const dirty = Object.keys(drafts).length > 0;
  const accepted = new Set(teams.filter(team => team.accepted !== false).map(team => team.id));
  const activeDrafts = Object.entries(drafts).filter(([id]) => !preserveRemovedDrafts || accepted.has(id));
  const removedDrafts = preserveRemovedDrafts ? Object.entries(drafts).filter(([id]) => !accepted.has(id)) : [];
  useEffect(() => { onDirty(dirty || pending); }, [dirty, pending, onDirty]);
  const current = (id: string) => [scores[id] ?? emptyScore, confirmed[id], conflicts[id]].reduce<Score>((latest, score) => score && score.revision > latest.revision ? score : latest, emptyScore);
  function change(id: string, patch: Partial<Draft>) {
    retry.current = null; setError(''); setNotice('');
    if ('text' in patch || 'clear' in patch) setFieldErrors(old => {
      const next = { ...old }; delete next[id]; return next;
    });
    setDrafts(old => ({ ...old, [id]: { ...(old[id] ?? { text: pointsText(current(id).halfPoints), reason: '', clear: false, base: current(id), teamName: teams.find(team => team.id === id)?.name ?? id }), ...patch } }));
  }
  const stale = activeDrafts.some(([id, draft]) => draft.base.revision !== current(id).revision);
  const warning = questionCount === undefined ? '' : `Víc bodů než otázek v kole (${questionCount}) – opravdu?`;
  const exceedsQuestions = (halfPoints: number | null | undefined) =>
    questionCount !== undefined && halfPoints != null && halfPoints > questionCount * 2;
  async function save() {
    if (busy.current || disabled || !activeDrafts.length || (stale && !retry.current)) return;
    let request = retry.current;
    try {
      if (!request) {
        const eligible = teams.filter(team => team.accepted !== false && Object.hasOwn(drafts, team.id));
        if (eligible.length !== activeDrafts.length) throw new Error('Soupiska se změnila. Zkontrolujte rozepsané body.');
        const changed: RoundScoreRequest['scores'] = [];
        const errors = new Map<string, string>();
        const overLimit: string[] = [];
        for (const { id: teamId, name } of eligible) {
          const draft = drafts[teamId]!;
          const result = draftPoints(draft);
          if (result.error !== undefined) { errors.set(teamId, result.error); continue; }
          const { halfPoints } = result;
          if (halfPoints === draft.base.halfPoints) continue;
          changed.push({ teamId, expectedRevision: draft.base.revision, halfPoints, reason: draft.reason.trim() });
          if (exceedsQuestions(halfPoints)) overLimit.push(name);
        }
        setFieldErrors(Object.fromEntries(errors));
        const firstInvalid = eligible.find(team => errors.has(team.id));
        if (firstInvalid) {
          const input = form.current?.elements.namedItem('score-' + firstInvalid.id);
          if (input instanceof HTMLInputElement) input.focus();
          setError('');
          return;
        }
        if (changed.some(score => !score.reason && (score.halfPoints === null || drafts[score.teamId]!.base.halfPoints !== null))) {
          throw new Error('Doplňte důvod u každé opravy nebo vrácení na nezadáno.');
        }
        if (!changed.length) throw new Error('Žádné změněné body k uložení.');
        if (changed.length > 200) throw new Error('Najednou lze uložit nejvýše 200 změněných týmů.');
        if (changed.some(score => score.halfPoints === null) && !window.confirm('Vrátit označené výsledky v tomto kole na nezadáno? Historie zůstane zachována.')) return;
        if (overLimit.length && !window.confirm(warning + '\n\n' + overLimit.join('\n'))) return;
        request = { eventId, snapshotId, ...(scoringEpoch === undefined ? {} : { scoringEpoch }), roundId, requestId: crypto.randomUUID(), scores: changed };
      }
    } catch (issue) { setError((issue as Error).message); return; }
    retry.current = request; busy.current = true; setPending(true); onPending(true); setError(''); setNotice('');
    try {
      const response = await (transport?.save ?? saveRoundScores)(request);
      setConfirmed(old => ({ ...old, ...Object.fromEntries(response.scores.map(score => [score.teamId, score])) }));
      retry.current = null;
      setDrafts(current => preserveRemovedDrafts ? Object.fromEntries(Object.entries(current).filter(([id]) => !accepted.has(id))) : {});
      setConflicts({}); setHistories({});
      setNotice('Body kola jsou uložené. Potvrzeno serverem.');
    } catch (issue) {
      const failure = issue as { code?: string; details?: RoundScoreResponse };
      if (failure.code === 'functions/aborted') {
        retry.current = null;
        if (Array.isArray(failure.details?.scores)) setConflicts(Object.fromEntries(failure.details.scores.map(score => [score.teamId, score])));
        setError('Konflikt: body se mezitím změnily. Celé uložení bylo odmítnuto; rozepsané hodnoty zůstávají.');
      } else setError('Uložení se nepodařilo potvrdit. Rozepsané hodnoty zůstávají; zopakujte stejné uložení.');
    } finally { busy.current = false; setPending(false); onPending(false); }
  }
  async function history(teamId: string) {
    if (histories[teamId]) { setHistories(old => { const next = { ...old }; delete next[teamId]; return next; }); return; }
    try { const rows = await (transport?.history ?? loadHistory)(eventId, teamId, roundId); setHistories(old => ({ ...old, [teamId]: rows })); }
    catch { setError('Historii se nepodařilo načíst.'); }
  }
  const saved = teams.filter(team => team.accepted !== false && current(team.id).halfPoints !== null).length;
  return <form ref={form} className="round-score-form" aria-label={'Body kola — ' + roundTitle} onSubmit={event => { event.preventDefault(); void save(); }}>
    <h2>{roundTitle}</h2>
    <p className="event-muted">Zadejte body za toto kolo všem týmům a uložte je společně. Nula je výsledek; prázdné pole je nezadáno.</p>
    <div className="round-score-table" role="table" aria-label="Body všech týmů">
      <div className="round-score-head" role="row"><span role="columnheader">Tým</span><span role="columnheader">Body</span></div>
      {teams.filter(team => team.accepted !== false).map(team => {
        const score = current(team.id), draft = drafts[team.id], conflict = draft && draft.base.revision !== score.revision;
        const error = Object.hasOwn(fieldErrors, team.id) ? fieldErrors[team.id] : undefined;
        const units = draft && draftPoints(draft).halfPoints;
        const feedback = error || (units !== draft?.base.halfPoints && exceedsQuestions(units) ? warning : '');
        const fieldId = 'score-' + team.id;
        return <div key={team.id} className="round-score-team" role="rowgroup" data-team-id={team.id}>
          <div className="round-score-entry" role="row"><label htmlFor={fieldId} role="rowheader">{team.name}{team.accepted === false && ' (zrušený tým)'}<small>{scoreLabel(score.halfPoints)}</small></label><div role="cell"><input id={fieldId} aria-invalid={error ? true : undefined} aria-describedby={feedback ? fieldId + '-feedback' : undefined} aria-label={'Body — ' + team.name} inputMode="decimal" value={draft?.text ?? pointsText(score.halfPoints)} disabled={disabled || pending || team.accepted === false || draft?.clear} onChange={event => change(team.id, { text: event.target.value })} /></div></div>
          {feedback && <p id={fieldId + '-feedback'} role={error ? 'alert' : undefined} className={error ? 'round-score-input-error' : 'round-score-warning'}>{feedback}</p>}
          {(draft && (draft.base.halfPoints !== null || draft.clear)) && <label className="form-field round-score-reason"><span>Důvod opravy — {team.name}</span><input maxLength={300} value={draft.reason} disabled={disabled || pending} onChange={event => change(team.id, { reason: event.target.value })} /></label>}
          {conflict && <div className="score-conflict" role="alert"><p>Aktuálně uloženo: {scoreLabel(score.halfPoints)}. Rozepsáno: {draft.clear ? 'Nezadáno' : draft.text || '(prázdná hodnota)'}.</p><button type="button" className="secondary-button" disabled={disabled || pending} onClick={() => change(team.id, { base: score })}>Připravit opravu aktuální revize</button></div>}
          <details className="round-score-details"><summary>Historie a oprava — {team.name}</summary><div className="team-tool-actions">
            <button type="button" className="secondary-button" disabled={disabled || pending} onClick={() => void history(team.id)}>Historie změn</button>
            {score.halfPoints !== null && team.accepted !== false && <button type="button" className="secondary-button" disabled={disabled || pending} onClick={() => change(team.id, { clear: !draft?.clear })}>{draft?.clear ? 'Ponechat body' : 'Vrátit na nezadáno'}</button>}
          </div>{draft?.clear && <p>Po uložení kola bude výsledek nezadán.</p>}
            {histories[team.id] && <div className="score-history">{histories[team.id]!.length === 0 ? <p>Žádné zápisy.</p> : <ol>{histories[team.id]!.map(item => <li key={item.revision}>{scoreLabel(item.previousHalfPoints)} → {scoreLabel(item.halfPoints)}<span>{item.createdAt} · {item.actorLabel ?? 'Pořadatel'}</span>{item.reason && <p>{item.reason}</p>}</li>)}</ol>}</div>}
          </details>
        </div>;
      })}
    </div>
    {removedDrafts.length > 0 && <section className="referee-removed-drafts" aria-label="Rozepsané body vyřazených týmů">
      <p role="status">Tým byl vyřazen ze soupisky. Jeho rozepsané body zůstávají k přečtení a zkopírování a nebudou se ukládat.</p>
      {removedDrafts.map(([id, draft]) => <div key={id}>
        <label className="form-field">Rozepsané body — {draft.teamName}<input readOnly value={draft.clear ? 'Nezadáno' : draft.text} /></label>
        {draft.reason && <label className="form-field">Důvod opravy — {draft.teamName}<input readOnly value={draft.reason} /></label>}
      </div>)}
    </section>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status" className="event-notice">{notice}</p>}
    <div className="round-score-save"><p role="status">{pending ? 'Ukládám celé kolo…' : `${saved} / ${teams.filter(team => team.accepted !== false).length} týmů má uložené body`}{dirty && !pending && ' · rozepsané změny'}</p><button className="primary-button" type="submit" disabled={disabled || pending || !activeDrafts.length || (stale && !retry.current)}>{pending ? 'Ukládám…' : 'Uložit body celého kola'}</button>
      {dirty && <button type="button" className="secondary-button" disabled={pending} onClick={() => { if (!window.confirm('Zahodit rozepsané body tohoto kola?')) return; setDrafts({}); setFieldErrors({}); retry.current = null; setError(''); }}>Zahodit změny</button>}
    </div>
  </form>;
}
