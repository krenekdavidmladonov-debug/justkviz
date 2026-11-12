import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { privateRead, type PrivateDocument } from '../../features/access/api';
import { getEvent } from '../../features/events/eventRepository';
import type { EventRecord, RegistrationRecord } from '../../features/events/types';
import { generatePrintArtifact } from '../../features/print/printApi';
import type { PrintArtifactType, PrintOptions, TeamSheetMode } from '../../features/print/types';
import { QuizErrorState } from '../../features/quizzes/QuizErrorState';
import { QuizLoading } from '../../features/quizzes/QuizLoading';
import '../../styles/print.css';

const ARTIFACTS = [
  { type: 'team-sheets', title: 'Hrací arch pro hráče', description: 'Dva archy na A4, místo pro odpovědi.', private: false },
  { type: 'organizer-sheets', title: 'Hrací arch se správnými odpověďmi', description: 'Pro obsluhu · obsahuje správné odpovědi.', private: true },
  { type: 'score-table', title: 'Bodovací tabulka podle týmů / hráčů', description: 'Týmy a body za jednotlivá kola.', private: false },
  { type: 'answer-key', title: 'Klíč správných odpovědí', description: 'Samostatný přehled pro obsluhu.', private: true },
] as const;
interface Preview { readonly url: string; readonly filename: string; readonly key: string }

export function AdminPrintCenterPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const { can, currentUser, membership } = useAuth();
  const identityKey = `${currentUser?.uid ?? ''}:${membership?.version ?? ''}`;
  const loadGeneration = useRef(0);
  const loadedEvent = useRef('');
  const [event, setEvent] = useState<EventRecord | null>(null);
  const [registrations, setRegistrations] = useState<readonly Pick<RegistrationRecord, 'id' | 'teamName'>[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [artifactType, setArtifactType] = useState<PrintArtifactType>('team-sheets');
  const [teamMode, setTeamMode] = useState<TeamSheetMode>('all');
  const [teamId, setTeamId] = useState('');
  const [layout, setLayout] = useState<'inherit' | 'compact' | 'spacious'>('inherit');
  const [colorMode, setColorMode] = useState<'color' | 'grayscale'>('color');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pending, setPending] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [privateConsent, setPrivateConsent] = useState<string | null>(null);
  const canExport = can('event.export');
  const canReadAnswers = can('event.answers.read') && can('event.answers.export');

  const load = useCallback(async () => {
    if (!eventId) return;
    const generation = ++loadGeneration.current;
    setLoading(true);
    setLoadError(null);
    try {
      const [nextEvent, roster] = await Promise.all([getEvent(eventId), privateRead<PrivateDocument[]>('roster', { eventId })]);
      if (generation !== loadGeneration.current) return;
      const accepted = roster.filter(item => item.data.status === 'accepted').map(item => ({
        id: item.id, teamName: typeof item.data.teamName === 'string' ? item.data.teamName : '',
      }));
      setEvent(nextEvent);
      setRegistrations(accepted);
      setTeamId(current => accepted.some(team => team.id === current) ? current : accepted[0]?.id ?? '');
      const targetKey = `${identityKey}:${eventId}`;
      const firstLoad = loadedEvent.current !== targetKey;
      loadedEvent.current = targetKey;
      setTeamMode(current => accepted.length === 0 || accepted.length > 30 ? 'generic' : firstLoad ? 'all' : current);
      if (firstLoad) {
        setLayout('inherit'); setColorMode('color');
      }
    } catch { if (generation === loadGeneration.current) setLoadError('Tisk a materiály se nepodařilo načíst. Zkuste to znovu.'); }
    finally { if (generation === loadGeneration.current) setLoading(false); }
  }, [eventId, identityKey]);
  useEffect(() => { void load(); return () => { loadGeneration.current++; }; }, [load]);

  const options = useMemo<PrintOptions>(() => {
    const presentation = {
      colorMode,
      ...(layout === 'inherit' ? {} : { layout }),
    };
    return artifactType === 'team-sheets'
      ? { artifactType, disposition: 'inline', mode: teamMode, ...(teamMode === 'single' ? { teamId } : {}), ...presentation }
      : { artifactType, disposition: 'inline', ...presentation };
  }, [artifactType, teamMode, teamId, layout, colorMode]);
  const teamCount = registrations.length;
  const formInvalid = (artifactType === 'score-table' && (teamCount === 0 || teamCount > 30))
    || (artifactType === 'team-sheets' && teamMode === 'single' && !teamId)
    || (artifactType === 'team-sheets' && teamMode === 'all' && (teamCount === 0 || teamCount > 30));
  const privateArtifact = artifactType === 'answer-key' || artifactType === 'organizer-sheets';
  const permitted = canExport && (!privateArtifact || canReadAnswers);
  const consentKey = JSON.stringify([identityKey, eventId, event?.quizAssignment?.snapshotId, artifactType, canExport, canReadAnswers]);
  const confirmed = !privateArtifact || privateConsent === consentKey;
  const requestKey = JSON.stringify([identityKey, eventId, event?.quizAssignment?.snapshotId, registrations, options, retry]);
  const sourceReady = !loading && !loadError && event?.id === eventId && loadedEvent.current === `${identityKey}:${eventId}`;
  const readyPreview = sourceReady && permitted && confirmed && preview?.key === requestKey ? preview : null;

  useEffect(() => { setPrivateConsent(null); }, [artifactType, identityKey, canReadAnswers, canExport, eventId]);

  // Every preview is the actual server PDF. Abort obsolete requests and never
  // expose an old document after a selection, identity or permission change.
  useEffect(() => {
    setPreview(null);
    setGenerationError(null);
    if (!sourceReady || !eventId || !event?.quizAssignment || formInvalid || !permitted || !confirmed) { setPending(false); return; }
    const controller = new AbortController();
    let active = true;
    let objectUrl: string | undefined;
    setPending(true);
    void generatePrintArtifact(eventId, options, controller.signal).then(result => {
      if (!active) return;
      objectUrl = URL.createObjectURL(result.blob);
      setPreview({ url: objectUrl, filename: result.filename, key: requestKey });
    }).catch((error: unknown) => {
      if (active) setGenerationError(error instanceof Error ? error.message : 'PDF se nepodařilo vytvořit. Zkuste to znovu.');
    }).finally(() => { if (active) setPending(false); });
    return () => { active = false; controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [sourceReady, eventId, event?.quizAssignment?.snapshotId, formInvalid, permitted, confirmed, options, requestKey]);

  if (loading) return <QuizLoading label="Načítám tisk a materiály…" />;
  if (loadError) return <QuizErrorState message={loadError} onRetry={() => void load()} />;
  if (!event) return <section className="quiz-state-card"><div><h2>Akce neexistuje</h2><p>Požadovaný záznam nebyl nalezen.</p></div><Link className="secondary-link" to="/admin/events">Zpět na akce</Link></section>;
  const assignment = event.quizAssignment;
  return (
    <article className="print-center-page">
      <Link className="back-link" to={`/admin/events/${event.id}`}>← Zpět na akci</Link>
      <header className="event-page-heading">
        <div><p className="eyebrow">{event.title}</p><h1>Tiskové centrum</h1><p className="lead">Vyberte dokument a stáhněte PDF z náhledu.</p></div>
        {assignment && <span className="quiz-status status-ready">Kvíz připraven</span>}
      </header>
      {assignment && <a className="print-preview-jump secondary-link" href="#print-document-preview">Přejít k náhledu ↓</a>}
      {!assignment ? (
        <section className="event-section print-lock-message" role="status">
          <div><h2>Nejdříve připravte kvíz pro tuto akci</h2><p>Na detailu akce vyberte kvíz a použijte „Připravit ke hraní“. Tisk potom použije právě tuto připravenou verzi.</p></div>
          <Link className="primary-button" to={`/admin/events/${event.id}#event-quiz`}>Připravit kvíz</Link>
        </section>
      ) : <>
        <section className="print-document-summary" aria-label="Použité podklady">
          <span><strong>{assignment.quizTitle}</strong> · Kola: {assignment.roundCount} · Otázky: {assignment.questionCount}</span>
          <span>{teamCount === 0 ? 'Zatím žádné přijaté týmy' : `Přijaté týmy: ${teamCount}`}</span>
        </section>
        <div className="print-workspace">
          <aside className="print-controls" aria-label="Výběr dokumentu a nastavení">
            <section className="print-artifact-section" aria-label="Dokument">
              <h2>Dokument</h2>
              <div className="print-artifact-grid">
                {ARTIFACTS.filter(artifact => artifact.type !== 'answer-key').map(artifact => {
                  const restricted = !canExport || (artifact.private && !canReadAnswers);
                  return <div key={artifact.type} className={artifact.private ? 'print-private-choice' : undefined}>
                    <button type="button" className={`print-artifact-card${artifactType === artifact.type ? ' is-selected' : ''}`} disabled={restricted} aria-pressed={artifactType === artifact.type} onClick={() => { setPrivateConsent(null); setArtifactType(artifact.type); }}>
                      <strong>{artifact.title}</strong><span>{artifact.description}</span>{restricted && <small>Nemáte oprávnění k tomuto dokumentu</small>}
                    </button>
                    {artifact.private && <button type="button" className={`print-answer-key secondary-button${artifactType === 'answer-key' ? ' is-selected' : ''}`} disabled={!canExport || !canReadAnswers} aria-pressed={artifactType === 'answer-key'} onClick={() => { setPrivateConsent(null); setArtifactType('answer-key'); }}>Klíč správných odpovědí</button>}
                  </div>;
                })}
              </div>
            </section>
            {artifactType === 'team-sheets' && <fieldset className="print-mode"><legend>Archy pro</legend>{([
              ['all', 'Všechny přijaté týmy'], ['single', 'Jeden tým'], ['generic', 'Prázdný arch bez jména'],
            ] as const).map(([value, label]) => <label key={value}><input type="radio" name="team-mode" value={value} checked={teamMode === value} onChange={() => setTeamMode(value)} />{label}</label>)}</fieldset>}
            {artifactType === 'team-sheets' && teamMode === 'single' && <label className="form-field">Tým<select value={teamId} onChange={change => setTeamId(change.target.value)}>{registrations.map(team => <option key={team.id} value={team.id}>{team.teamName}</option>)}</select></label>}
            <div className="print-color-field"><label className="form-field">Barevnost<select value={colorMode} aria-describedby={colorMode === 'grayscale' ? 'print-grayscale-help' : undefined} onChange={change => setColorMode(change.target.value as typeof colorMode)}><option value="color">Barevný — decentní akcenty</option><option value="grayscale">Černobílý</option></select></label>{colorMode === 'grayscale' && <p className="field-help" id="print-grayscale-help">V černobílém PDF se obrázkové logo nahradí textovým logem.</p>}</div>
            <details className="print-advanced">
              <summary>Další možnosti</summary>
              <div className="print-advanced-content">
                <label className="form-field">Šablona<select value={layout} onChange={change => setLayout(change.target.value as typeof layout)}><option value="inherit">Uložená v připraveném kvízu (výchozí Standardní)</option><option value="spacious">Standardní — pohodlný prostor pro psaní</option><option value="compact">Úsporný — méně stránek</option></select></label>
                <button className="secondary-button" type="button" onClick={() => void load()}>Aktualizovat týmy a náhled</button>
              </div>
            </details>
            {teamCount === 0 && !privateArtifact && <section className="print-empty-roster" role="status">
              <h2>Akce zatím nemá přijaté týmy</h2><p>Prázdný arch je dostupný hned. Bodovací tabulka až po přidání týmů.</p>
              {artifactType !== 'team-sheets' && <button className="secondary-button" type="button" onClick={() => { setArtifactType('team-sheets'); setTeamMode('generic'); }}>Zobrazit prázdný arch</button>}
              <Link className="secondary-link" to={`/admin/events/${event.id}/registrations`}>Přidat týmy</Link>
            </section>}
            {teamCount > 30 && artifactType === 'team-sheets' && <p className="field-help">Akce má více než 30 týmů. Vyberte jeden tým nebo prázdný arch.</p>}
          </aside>
        <section className="print-preview-panel" id="print-document-preview" aria-label="Náhled a stažení" tabIndex={-1}>
          <header className="print-preview-heading">
            <div><h2>{ARTIFACTS.find(item => item.type === artifactType)?.title}</h2><p>{artifactType === 'team-sheets' || artifactType === 'organizer-sheets' ? '2 archy vedle sebe · A4 na šířku · tisk 100 % · rozstřihnout uprostřed' : 'A4 · tisk 100 %'} · {colorMode === 'grayscale' ? 'černobíle' : 'decentní barevné akcenty'}</p>{artifactType === 'team-sheets' && <p>{teamMode === 'all' ? 'Všechny týmy a právě jeden univerzální rezervní arch bez jména. Kolo na rezervě doplníte ručně.' : 'Každý list obsahuje dvě stejné kopie archu.'} Každé kolo zůstává celé na jedné straně archu.</p>}</div>
            <div className="print-actions">
              <a className="primary-button" aria-disabled={!readyPreview} tabIndex={readyPreview ? 0 : -1} href={readyPreview?.url} download={readyPreview?.filename}>{privateArtifact ? 'Stáhnout PDF se správnými odpověďmi' : 'Stáhnout PDF'}</a>
            </div>
          </header>
          {privateArtifact && <p className="print-private-note"><strong className="print-private-badge">NEDÁVAT HRÁČŮM</strong> Jen pro obsluhu. Tento dokument obsahuje správné odpovědi.</p>}
          {generationError ? <div className="print-preview-message" role="alert"><strong>PDF se nepodařilo připravit</strong><p>{generationError}</p><button className="secondary-button" type="button" onClick={() => setRetry(value => value + 1)}>Zkusit znovu</button></div>
            : formInvalid ? <div className="print-preview-message" role="status"><strong>{teamCount > 30 ? artifactType === 'score-table' ? 'Bodovací tabulka podporuje nejvýše 30 týmů' : 'Vyberte jeden tým nebo prázdný arch' : 'Pro tento dokument nejprve přidejte tým'}</strong><p>{teamCount > 30 ? artifactType === 'score-table' ? 'Tato akce má více přijatých týmů, než lze zahrnout do jedné bodovací tabulky.' : 'Jedno PDF podporuje nejvýše 30 přijatých týmů.' : 'Prázdný odpovědní arch je dostupný i bez registrací.'}</p></div>
              : !permitted ? <div className="print-preview-message" role="status">K vytvoření tohoto dokumentu nemáte oprávnění.</div>
                : !confirmed ? <div className="print-preview-message" role="status"><strong>Dokument obsahuje správné odpovědi</strong><p>Otevřete ho pouze pro přípravu a kontrolu obsluhou. Nedávejte ho hráčům.</p><button className="secondary-button" type="button" onClick={() => setPrivateConsent(consentKey)}>Otevřít dokument se správnými odpověďmi</button></div>
                  : readyPreview ? <iframe className="print-preview-frame" title="Náhled PDF" src={`${readyPreview.url}#navpanes=0&view=Fit`} />
                  : <div className="print-preview-message" role="status" aria-busy={pending}><strong>Připravuji náhled PDF…</strong><p>Načítám připravený kvíz a aktuální přijaté týmy.</p></div>}
        </section>
        </div>
      </>}
    </article>
  );
}
