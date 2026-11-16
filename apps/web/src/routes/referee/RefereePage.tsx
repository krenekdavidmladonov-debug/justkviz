import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker, useParams } from 'react-router-dom';
import { Brand } from '../../ui/Brand';
import { RoundScoreForm } from '../../features/scoring/RoundScoreForm';
import { consumeRefereeCredential, forgetReferee } from '../../features/referee/sharing';
import { readReferee, writeRefereeRound, historyReferee, type RefereeEvent } from '../../features/referee/api';
import '../../features/scoring/scoring.css';
import '../../features/referee/referee-page.css';

export function RefereePage() {
  const { eventId = '' } = useParams();
  // Consume credentials only after navigation has passed the current event's
  // dirty/pending blocker. Each event owns its roster, drafts and request state.
  return <RefereeEventPage key={eventId} eventId={eventId} />;
}

function RefereeEventPage({ eventId }: { readonly eventId: string }) {
  const [credential] = useState(() => consumeRefereeCredential(eventId));
  const previousView = useRef<RefereeEvent | null>(null);
  const [data, setData] = useState<RefereeEvent | null>(null);
  const [roundId, setRoundId] = useState('');
  const [blocked, setBlocked] = useState(!credential);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(() => navigator.onLine);
  const [verifiedAt, setVerifiedAt] = useState<Date | null>(null);
  const writeVersion = useRef(0), pendingWrite = useRef(false);
  const [pending, setPending] = useState(false), [hasDirty, setDirty] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const blocker = useBlocker(hasDirty || pending);
  const onDirty = useCallback((value: boolean) => { if (mounted.current) setDirty(value); }, []);
  const onPending = useCallback((value: boolean) => { if (mounted.current) { pendingWrite.current = value; setPending(value); } }, []);
  const failure = useCallback((issue: unknown) => {
    // A late failure must not erase a newly acquired credential after A → B → A.
    if (!mounted.current) return;
    setVerifiedAt(null);
    if ((issue as { code?: string }).code === 'functions/permission-denied') {
      forgetReferee(eventId); setBlocked(true); setError('Přístup vypršel / byl odebrán');
    } else setError('Aktuální data nelze ověřit. Uložené jsou jen serverem potvrzené zápisy.');
  }, [eventId]);
  useEffect(() => {
    const offline = () => { setConnected(false); setVerifiedAt(null); };
    const online = () => setConnected(true);
    window.addEventListener('offline', offline); window.addEventListener('online', online);
    return () => { window.removeEventListener('offline', offline); window.removeEventListener('online', online); };
  }, []);
  useEffect(() => {
    if (!credential || blocked || !connected) return;
    let active = true, busy = false;
    const poll = async () => {
      if (busy || pendingWrite.current) return;
      busy = true;
      const version = writeVersion.current;
      try {
        const next = await readReferee(credential);
        if (!active || version !== writeVersion.current || pendingWrite.current) return;
        const previous = previousView.current;
        if (previous && (previous.snapshotId !== next.snapshotId || previous.teams.some(team => !next.teams.some(current => current.id === team.id)))) {
          setVerifiedAt(null); setError('Připravený kvíz nebo soupiska se změnily. Před obnovením stránky zkontrolujte rozepsané body.'); return;
        }
        previousView.current = next; setData(next); setRoundId(old => old || next.rounds[0]?.id || '');
        setVerifiedAt(new Date()); setError('');
      } catch (issue) { if (active && version === writeVersion.current && !pendingWrite.current) failure(issue); }
      finally { busy = false; }
    };
    void poll(); const timer = window.setInterval(() => void poll(), 5000);
    return () => { active = false; clearInterval(timer); };
  }, [credential, blocked, connected, failure]);
  useEffect(() => {
    if (!hasDirty && !pending) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [hasDirty, pending]);
  useEffect(() => {
    if (blocker.state === 'blocked') {
      if (!pendingWrite.current && window.confirm('Máte neuložené body. Odejít a zahodit změny?')) blocker.proceed();
      else blocker.reset();
    }
  }, [blocker]);
  const transport = useMemo(() => ({
    save: async (request: Parameters<typeof writeRefereeRound>[1]) => {
      try {
        const confirmed = await writeRefereeRound(credential!, request);
        if (!mounted.current) return confirmed;
        writeVersion.current += 1;
        // Apply the acknowledged transaction immediately; ignore an older in-flight read.
        setData(old => old && ({ ...old, scores: [...old.scores.filter(score => score.roundId !== request.roundId || !confirmed.scores.some(next => next.teamId === score.teamId)), ...confirmed.scores.map(score => ({ ...score, roundId: request.roundId }))] }));
        setVerifiedAt(new Date()); return confirmed;
      } catch (issue) {
        if ((issue as { code?: string }).code !== 'functions/aborted') failure(issue);
        throw issue;
      }
    },
    history: async (_event: string, team: string, round: string) => {
      try { return await historyReferee(credential!, team, round); }
      catch (issue) { failure(issue); throw issue; }
    },
  }), [credential, failure]);
  const verified = connected && !!verifiedAt && !blocked && !error;
  return <main className="event-detail-page referee-page">
    <header className="referee-page-header"><Brand /><h1>Bodování</h1><p>{data?.title}</p></header>
    {(blocked || !credential) && <p role="alert">Přístup vypršel / byl odebrán</p>}
    {error && !blocked && <p role="alert">{error}</p>}
    {!connected && !blocked && <p role="alert">Jste offline. Pro pokračování a ověření uložených bodů obnovte připojení.</p>}
    {!data && !blocked && credential && !error && <p>Ověřuji přístup…</p>}
    {data && <section className="referee-workspace">
      <label className="form-field"><span>Kolo</span><select aria-label="Kolo" value={roundId} disabled={!verified || pending} onChange={event => {
        if (pendingWrite.current || (hasDirty && !window.confirm('Změnit kolo a zahodit neuložené body?'))) return;
        setDirty(false); setRoundId(event.target.value);
      }}>{data.rounds.map((round, index) => <option key={round.id} value={round.id}>{index + 1}. {round.title}</option>)}</select></label>
      {data.teams.length === 0 ? <p role="status">Na soupisce zatím nejsou žádné týmy.</p> : roundId && <RoundScoreForm key={JSON.stringify([data.snapshotId, roundId])} eventId={eventId} snapshotId={data.snapshotId} roundId={roundId}
        roundTitle={data.rounds.find(round => round.id === roundId)?.title ?? 'Kolo'} teams={data.teams}
        scores={Object.fromEntries(data.scores.filter(score => score.roundId === roundId).map(score => [score.teamId, score]))} disabled={!verified} onDirty={onDirty} onPending={onPending} transport={transport} />}
      {data.rounds.length === 0 && <p>Připravený kvíz zatím nemá žádná kola.</p>}
      {!verified ? <p role="status">Uložené body nyní nelze ověřit.</p> : <p className="event-muted">Ověřeno v {verifiedAt.toLocaleTimeString('cs-CZ')} · obnova každých 5 sekund</p>}
      <details className="referee-help"><summary>Jak zapisovat body</summary>
        <p>Vyberte kolo, zapište body všem týmům a jednou uložte celé kolo. Body z předchozích kol nepřičítejte. Půlbody pište jako 2,5 nebo 2.5. Nula je zadaný výsledek; prázdné pole znamená nezadáno.</p>
        <p>Správné odpovědi pro opravu archů vám předá organizátor samostatně. Průběžné výsledky zveřejňuje moderátor.</p>
      </details>
    </section>}
    <button type="button" className="secondary-button referee-end-access" disabled={pending} onClick={() => { if (pendingWrite.current || (hasDirty && !window.confirm('Ukončit přístup a zahodit rozepsané změny?'))) return; forgetReferee(eventId); setBlocked(true); setData(null); }}>Ukončit přístup v tomto panelu</button>
  </main>;
}
