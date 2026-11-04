import { eventDisposition, eventOperational, pragueDateTime } from '@filmovy-kviz/quiz-domain';
import { EventActions, lifecycleLabels } from '../../features/events/EventActions';
import { teamEmailEnabled } from '../../features/events/teamEmailCapability';
import { EventLiveButton } from '../../features/leaderboard/EventLiveButton';
import { RefereeAccessPanel } from '../../features/referee/RefereeAccessPanel';
import { runQuizPreflight, type EditorQuiz, type PreflightResult } from '@filmovy-kviz/quiz-domain';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';

import { useAuth } from '../../auth/AuthProvider';
import {
  eventActionError,
  lockEventQuiz,
  updateEvent,
} from '../../features/events/eventApi';
import { EventForm } from '../../features/events/EventForm';
import { defaultEventPricing, eventPriceLabel } from '../../features/events/eventPricing';
import { ManualTeamDialog } from '../../features/events/ManualTeamDialog';
import { EventPublicationButton } from '../../features/events/EventPublicationButton';
import { eventCapacity, eventDateLabel, registrationPresentation } from '../../features/events/eventPresentation';
import { RegistrationSharePanel } from '../../features/events/RegistrationSharePanel';
import { getEvent } from '../../features/events/eventRepository';
import type { EventFormValues, EventRecord } from '../../features/events/types';
import { getEditorQuiz } from '../../features/editor/editorRepository';
import { preflightFixUrl } from '../../features/preflight/validation';
import { QuizErrorState } from '../../features/quizzes/QuizErrorState';
import { QuizLoading } from '../../features/quizzes/QuizLoading';
import { listQuizzes } from '../../features/quizzes/quizRepository';
import type { QuizSummary } from '../../features/quizzes/types';

const EventTeamMessagePanel = teamEmailEnabled
  ? lazy(() => import('../../features/events/EventTeamMessagePanel').then(module => ({ default: module.EventTeamMessagePanel })))
  : null;

const localDateTime = pragueDateTime;

function formValues(event: EventRecord): EventFormValues {
  const pricing = event.pricing ?? defaultEventPricing;
  return {
    pricingMode: pricing.mode,
    pricingAmountCzk: pricing.amountCzk ?? 350,
    pricingHidden: pricing.hidden === true,
    title: event.title,
    description: event.description ?? '',
    utcOffset: new Intl.DateTimeFormat('en', { timeZone: 'Europe/Prague', timeZoneName: 'shortOffset' }).format(event.startsAt).includes('GMT+2') ? '+02:00' : '+01:00',
    startsAt: localDateTime(event.startsAt),
    timeZone: event.timeZone,
    venueName: event.venue.name,
    publicLocation: event.venue.publicLocation,
    teamCapacity: event.teamCapacity,
    peopleCapacity: event.peopleCapacity,
    teamSizeMin: event.teamSizeMin,
    teamSizeMax: event.teamSizeMax,
  };
}

export function AdminEventDetailPage() {
  const navigate = useNavigate();
  const { hash } = useLocation();
  const { eventId } = useParams<{ eventId: string }>();
  const { can, currentUser } = useAuth();
  const canChooseQuiz = can('event.manage') && can('quiz.read') && can('quiz.export') && can('quiz.answers.read') && can('quiz.notes.read');
  const [event, setEvent] = useState<EventRecord | null>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 15000); return () => window.clearInterval(timer); }, []);
  const [values, setValues] = useState<EventFormValues | null>(null);
  const [quizzes, setQuizzes] = useState<readonly QuizSummary[]>([]);
  const [quizzesLoading, setQuizzesLoading] = useState(false);
  const [quizzesError, setQuizzesError] = useState(false);
  const [selectedQuizId, setSelectedQuizId] = useState('');
  const [selectedQuiz, setSelectedQuiz] = useState<EditorQuiz | null>(null);
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizError, setQuizError] = useState<string | null>(null);
  const [quizRefresh, setQuizRefresh] = useState(0);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [addingTeam, setAddingTeam] = useState(false);
  const [addedTeam, setAddedTeam] = useState<{ id: string; name: string } | null>(null);
  const [libraryComparison, setLibraryComparison] = useState<{ eventId: string; quizId: string; revision: number } | null>(null);
  const [checkingLibrary, setCheckingLibrary] = useState(false);
  const [libraryComparisonError, setLibraryComparisonError] = useState(false);
  const loadVersion = useRef(0);
  const actionBusy = useRef(false);
  const quizEditable = !loading && event?.id === eventId && event !== null && canChooseQuiz
    && eventOperational(event) && !event.liveSessionId && !event.scoring.started;

  const load = useCallback(async () => {
    if (!eventId) return;
    const version = ++loadVersion.current;
    setLoading(true);
    setCheckingLibrary(false);
    setError(null);
    try {
      const loadedEvent = await getEvent(eventId);
      if (version !== loadVersion.current) return;
      setEvent(loadedEvent);
      setNow(Date.now());
      setValues(loadedEvent ? formValues(loadedEvent) : null);
      if (loadedEvent?.quizAssignment) {
        setSelectedQuizId((current) => current === '' ? loadedEvent.quizAssignment?.quizId ?? '' : current);
      }
    } catch {
      if (version === loadVersion.current) setError('Detail akce se nepodařilo načíst.');
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    setEvent(null);
    setSelectedQuizId('');
    setLibraryComparison(null);
    setCheckingLibrary(false);
    setLibraryComparisonError(false);
    void load();
    return () => { loadVersion.current++; };
  }, [load]);
  useEffect(() => {
    if (!loading && hash === '#event-quiz') document.getElementById('event-quiz')?.scrollIntoView({ block: 'start' });
  }, [hash, loading]);
  useEffect(() => {
    let current = true;
    setQuizzes([]);
    setQuizzesError(false);
    setQuizzesLoading(quizEditable);
    if (quizEditable) {
      void listQuizzes().then(items => { if (current) setQuizzes(items); })
        .catch(() => { if (current) setQuizzesError(true); })
        .finally(() => { if (current) setQuizzesLoading(false); });
    }
    return () => { current = false; };
  }, [quizEditable, eventId]);
  useEffect(() => {
    let current = true;
    setPreflight(null);
    setSelectedQuiz(null);
    setQuizError(null);
    setQuizLoading(false);
    if (!quizEditable || selectedQuizId === '' || !quizzes.some(quiz => quiz.id === selectedQuizId)) return () => { current = false; };
    setQuizLoading(true);
    void getEditorQuiz(selectedQuizId).then((quiz) => {
      if (!current) return;
      if (quiz === null) { setQuizError('Tento kvíz už není dostupný. Vyberte jiný.'); return; }
      setSelectedQuiz(quiz);
      setPreflight(runQuizPreflight(quiz));
    }).catch(() => { if (current) setQuizError('Kvíz se nepodařilo načíst. Zkontrolujte připojení a zkuste to znovu.'); })
      .finally(() => { if (current) setQuizLoading(false); });
    return () => { current = false; };
  }, [selectedQuizId, quizEditable, quizzes, quizRefresh]);

  const runAction = async (action: () => Promise<unknown>, success: string) => {
    if (actionBusy.current) return;
    actionBusy.current = true;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(success);
      await load();
    } catch (actionError) {
      setError(eventActionError(actionError));
      if (actionError && typeof actionError === 'object' && 'code' in actionError && actionError.code === 'functions/aborted') setConflict(true);
    } finally {
      actionBusy.current = false;
      setPending(false);
    }
  };

  const prepareQuiz = async () => {
    if (!event || !selectedQuiz || selectedQuiz.id !== selectedQuizId || actionBusy.current) return;
    actionBusy.current = true; setPending(true); setError(null); setNotice(null);
    const version = loadVersion.current;
    try {
      const latest = await getEditorQuiz(selectedQuiz.id);
      if (version !== loadVersion.current) return;
      if (!latest) { setSelectedQuiz(null); setPreflight(null); setQuizError('Kvíz už není dostupný. Vyberte jiný.'); return; }
      const checked = runQuizPreflight(latest);
      setSelectedQuiz(latest); setPreflight(checked);
      await lockEventQuiz(event.id, event.revision, latest.id, latest.revision, false);
      if (version !== loadVersion.current) return;
      await load();
      setNotice(event.quizAssignment ? 'Kvíz pro akci byl aktualizován.' : 'Kvíz je připraven ke hraní.');
    } catch (failure) {
      if (version !== loadVersion.current) return;
      setError(eventActionError(failure));
      setQuizRefresh(value => value + 1);
    } finally { actionBusy.current = false; setPending(false); }
  };

  if (loading || (event !== null && event.id !== eventId)) return <QuizLoading label="Načítám detail akce…" />;
  if (error && event === null) return <QuizErrorState message={error} onRetry={() => void load()} />;
  if (!event || !values) return <section className="quiz-state-card"><div><h2>Akce neexistuje</h2><p>Požadovaný záznam nebyl nalezen.</p></div><Link className="secondary-link" to="/admin/events">Zpět na akce</Link></section>;

  const admin = can('event.manage') && eventOperational(event);
  const hidden = ['trash', 'deleting'].includes(eventDisposition(event));
  const locked = event.quizAssignment;
  const registration = registrationPresentation(event, now), capacity = eventCapacity(event);
  const sourceRevision = locked && libraryComparison?.eventId === event.id && libraryComparison.quizId === locked.quizId
    ? libraryComparison.revision : selectedQuiz?.id === locked?.quizId ? selectedQuiz?.revision : undefined;
  const lockDisabled = pending || quizLoading || !eventOperational(event) || Boolean(event.liveSessionId) || event.scoring.started || selectedQuiz === null || selectedQuiz.id !== selectedQuizId;
  return (
    <article className="event-detail-page">
      <Link className="back-link" to="/admin/events">← Zpět na akce</Link>
      <header className="event-page-heading event-form-heading">
        <div><h1>{admin ? 'Upravit akci' : 'Detail akce'}</h1><p className="lead">{event.title} · {event.venue.name}</p></div>
        <span className={`quiz-status status-${event.lifecycleStatus}`}>{lifecycleLabels[event.lifecycleStatus]}</span>
        <EventActions event={event} onChanged={async (message, deleted, updated) => {
          if (deleted) { await navigate('/admin/events'); return; }
          if (updated) { setEvent(updated); setValues(formValues(updated)); }
          setNotice(message);
        }} />
      </header>
      {error && <p className="round-editor-error" role="alert">{error}</p>}
      {conflict && <section className="event-section"><p>Novější změnu jsme nepřepsali. Váš rozepsaný formulář zůstal zachovaný.</p><button className="secondary-button" onClick={() => { void getEvent(event.id).then(latest => { if (latest) { const original = formValues(event), incoming = formValues(latest);
        const merged = { ...incoming }; const conflicting: string[] = [];
        for (const key of Object.keys(original) as (keyof EventFormValues)[]) { if (values[key] !== original[key]) { Object.assign(merged, { [key]: values[key] }); if (incoming[key] !== original[key] && incoming[key] !== values[key]) conflicting.push(key + ': na serveru „' + String(incoming[key]) + '“, váš návrh „' + String(values[key]) + '“'); } }
        setValues(merged); setEvent(latest); setConflict(false); setNotice(conflicting.length ? 'Před uložením potvrďte svůj návrh u shodně změněných polí: ' + conflicting.join('; ') : 'Vaše změny byly přeneseny do aktuální verze. Ostatní novější údaje zůstaly zachované. Zkontrolujte formulář a uložte.'); setError(null);  } }); }}>Načíst aktuální stav a ponechat formulář</button></section>}
      {notice && <p className="event-notice" role="status">{notice}</p>}

      <section className="event-section event-evening-summary" aria-label="Příprava večera">
        <dl>
          <div><dt>Termín</dt><dd>{eventDateLabel(event)}</dd></div>
          <div><dt>Kvíz pro tuto akci</dt><dd>{locked ? `${locked.quizTitle} · verze ${locked.quizRevision}` : 'Zatím nevybrán'}</dd></div>
          <div><dt>Týmy</dt><dd>{event.acceptedTeams} / {event.teamCapacity} · volno {capacity.freeTeams ?? "—"}</dd></div><div><dt>Zveřejnění</dt><dd>{event.registrationPublished ? "Zveřejněno" : "Nezveřejněno"}</dd></div>
          <div><dt>Registrace</dt><dd>{registration.label}</dd></div>
        </dl>
        {!hidden && (event.lifecycleStatus === 'completed' ? <Link className="primary-button" to={`/admin/events/${event.id}/results`}>Zobrazit výsledky</Link>
          : locked && eventOperational(event) && can('event.live') && ['ready', 'live', 'finalizing'].includes(event.lifecycleStatus)
            ? <EventLiveButton eventId={event.id} revision={event.revision} />
            : <a className="primary-button" href="#event-quiz">Dokončit přípravu</a>)}
        {admin && !hidden && !['archived', 'cancelled', 'completed'].includes(event.lifecycleStatus) && <a className="secondary-link" href="#event-referee">Přístup pro rozhodčího</a>}
      </section>

      {!hidden && <section className="event-section"><h2>Veřejná viditelnost</h2><p>Zveřejnění umožní přihlašování týmů do začátku akce podle volné kapacity. Připravenost kvízu se nastavuje samostatně.</p><EventPublicationButton event={event} disabled={pending} onChanged={updated => { setEvent(updated); setNow(Date.now()); setNotice(updated.registrationPublished ? updated.registrationStatus === 'full' ? "Akce je zveřejněná. Kapacita je naplněná; další tým se může přihlásit až po jejím uvolnění." : "Akce je zveřejněná a registrace jsou otevřené do začátku akce." : "Akce byla skryta z veřejného webu."); }} /></section>}

      {!hidden && can('event.export') && <section className="event-section" aria-labelledby="event-materials-title">
        <div className="event-section-heading"><div><p className="eyebrow">Dokumenty na večer</p><h2 id="event-materials-title">Tisk a materiály</h2></div>{locked && <span>Kvíz připraven</span>}</div>
        <p className="event-muted">Odpovědní archy pro týmy, bodovací tabulka a klíč správných odpovědí pro oprávněnou obsluhu.</p>
        <Link className="secondary-link" to={`/admin/events/${event.id}/print`}>Otevřít tisk a materiály</Link>
      </section>}

      {!hidden && can('event.read') && event.lifecycleStatus === 'completed' && <section className="event-section">
        <div className="event-section-heading"><div><p className="eyebrow">Dokončená akce</p><h2>Konečné výsledky</h2></div></div>
        <p className="event-muted">Potvrzené konečné pořadí této akce, pouze pro čtení.</p>
        <Link className="secondary-link" to={`/admin/events/${event.id}/results`}>Otevřít konečné výsledky</Link>
      </section>}

      {!hidden && can('event.contacts') && <section className="event-section">
        <div className="event-section-heading"><div><p className="eyebrow">Registrace</p><h2>Týmy a kapacita</h2></div><span>{event.acceptedTeams} / {event.teamCapacity} týmů</span></div>
        <p className="event-muted">Registrační okno, přihlášené týmy a jejich privátní kontakty.</p>
        <div className="team-tool-actions">{admin && <button className="primary-button" type="button" onClick={() => setAddingTeam(true)}>+ Přidat tým</button>}<Link className="secondary-link" to={`/admin/events/${event.id}/registrations`}>Spravovat týmy a registrace</Link></div>
        {addedTeam && <p className="event-notice" role="status">Přidán tým: <Link to={`/admin/events/${event.id}/registrations?team=${addedTeam.id}`}>{addedTeam.name}</Link></p>}
      </section>}

      <section className="event-section">
        <div className="event-section-heading"><div><p className="eyebrow">Interní zápis</p><h2>Bodování</h2></div></div>
        <p className="event-muted">Rozhodčí zapisuje součet bodů týmu za každé kolo. V moderování pak načtete průběžné výsledky a zobrazíte je na projektoru.</p>
        {!hidden && <Link className="secondary-link" to={`/admin/events/${event.id}/scoring`}>Otevřít bodování</Link>}
      </section>
      {admin && !hidden && !['archived', 'cancelled', 'completed'].includes(event.lifecycleStatus) && <div id="event-referee">
        {(!locked || !['ready', 'live', 'finalizing'].includes(event.lifecycleStatus)) && <p className="event-muted">Před použitím odkazu rozhodčího nejprve <a href="#event-quiz">připravte kvíz ke hraní</a>.</p>}
        <RefereeAccessPanel key={event.id} eventId={event.id} canIssue={can('event.score')} />
        {can('event.export') && can('event.answers.read') && can('event.answers.export') && <p className="event-muted"><Link to={`/admin/events/${event.id}/print`}>Připravit správné odpovědi pro rozhodčího</Link> — v tiskovém centru zvolte organizační arch nebo klíč odpovědí.</p>}
      </div>}
      {admin && can('event.contacts') && EventTeamMessagePanel && <Suspense fallback={null}><EventTeamMessagePanel key={event.id + ':' + currentUser?.uid} eventId={event.id} actorId={currentUser!.uid} canCreate={['draft', 'scheduled', 'ready', 'live'].includes(event.lifecycleStatus)} /></Suspense>}
      {!hidden && <RegistrationSharePanel event={event} now={now} />}
      {admin && addingTeam && <ManualTeamDialog event={event} onClose={() => setAddingTeam(false)} onSaved={async (id, name) => { setAddedTeam({ id, name }); setEvent(await getEvent(event.id)); }} />}

      <section className="event-section" id="event-edit">
        {admin ? <EventForm values={values} live={Boolean(event.liveSessionId)} pending={pending || conflict} submitLabel="Uložit změny" onChange={setValues} onSubmit={() => void runAction(() => updateEvent(event.id, event.revision, values), 'Změny akce byly uloženy.')} /> : (
          <dl className="event-readonly-grid"><div><dt>Místo</dt><dd>{event.venue.name}</dd></div><div><dt>Veřejná lokalita</dt><dd>{event.venue.publicLocation}</dd></div><div><dt>Cena akce</dt><dd>{eventPriceLabel(event.pricing)}</dd></div><div><dt>Kapacita týmů</dt><dd>{event.teamCapacity}</dd></div><div><dt>Velikost týmu</dt><dd>{event.teamSizeMin}–{event.teamSizeMax}</dd></div></dl>
        )}
      </section>

      <section className="event-section" id="event-quiz" data-testid="event-quiz-assignment">
        <div className="event-section-heading"><div><p className="eyebrow">Kvíz</p><h2>{locked ? 'Kvíz připraven' : 'Vybrat kvíz'}</h2></div>{locked && <span>Připravená verze {locked.quizRevision}</span>}</div>
        {locked && <div className="event-locked-quiz"><strong>{locked.quizTitle}</strong><span>{locked.roundCount} kol · {locked.questionCount} otázek</span><small>Hraje se připravená verze {locked.quizRevision}. Další úpravy v knihovně ji nezmění.</small>
          {sourceRevision !== undefined ? <p role="status">{sourceRevision > locked.quizRevision ? `V knihovně je novější verze ${sourceRevision}. Tato akce stále používá připravenou verzi ${locked.quizRevision}.` : 'Připravená verze odpovídá naposledy ověřené verzi v knihovně.'}</p> : <p>Novější změny v knihovně zatím nejsou ověřené.</p>}
          {canChooseQuiz && <button className="secondary-button" type="button" disabled={checkingLibrary} onClick={() => {
            const version = loadVersion.current;
            setCheckingLibrary(true); setLibraryComparisonError(false);
            void getEditorQuiz(locked.quizId).then(quiz => {
              if (version !== loadVersion.current) return;
              if (quiz) setLibraryComparison({ eventId: event.id, quizId: quiz.id, revision: quiz.revision });
              else setLibraryComparisonError(true);
            }).catch(() => { if (version === loadVersion.current) setLibraryComparisonError(true); })
              .finally(() => { if (version === loadVersion.current) setCheckingLibrary(false); });
          }}>{checkingLibrary ? 'Ověřuji knihovnu…' : 'Ověřit novější změny v knihovně'}</button>}
          {libraryComparisonError && <p role="status">Zdrojový kvíz se nepodařilo ověřit. Připravená verze akce zůstává beze změny.</p>}
        </div>}
        {quizEditable ? (
          <div className="event-quiz-lock">
            {quizzesLoading && <p role="status">Načítám nabídku kvízů…</p>}
            {quizzesError && <p role="alert">Nabídku kvízů se nepodařilo načíst. <button type="button" className="secondary-button" onClick={() => void load()}>Zkusit znovu</button></p>}
            <label className="editor-field"><span>{locked ? 'Aktualizovat kvíz pro akci' : 'Kvíz'}</span><select disabled={pending || quizzesLoading || quizzesError} value={selectedQuizId} onChange={(change) => setSelectedQuizId(change.target.value)}><option value="">Vyberte kvíz</option>{quizzes.map((quiz) => <option value={quiz.id} key={quiz.id}>{quiz.title}</option>)}</select></label>
            {quizLoading && <p role="status">Načítám vybraný kvíz…</p>}
            {quizError && <p role="alert">{quizError} <button type="button" className="secondary-button" onClick={() => setQuizRefresh(value => value + 1)}>Zkusit znovu</button></p>}
            {selectedQuiz?.id === selectedQuizId && selectedQuiz && preflight && <div className={`event-readiness status-${preflight.status.toLowerCase()}`} data-preflight-status={preflight.status}>
              <strong>{selectedQuiz.title}</strong><span>{preflight.roundCount} kol · {preflight.questionCount} otázek</span>
              <details><summary>Dobrovolná kontrola kvízu{preflight.issues.length > 0 ? ` · ${preflight.issues.length} položek` : ''}</summary>
                <p>Kontrola obsahu není podmínkou přípravy kvízu pro akci.</p>
                {preflight.issues.length > 0 ? <ul className="event-readiness-issues">{preflight.issues.map((issue, index) => <li key={`${issue.code}-${index}`}><strong>{issue.severity === 'BLOCKER' ? 'K prověření' : 'Doporučení'}{issue.reference.questionNumber !== undefined ? ` · ${issue.reference.roundPosition ?? '—'}. kolo, otázka ${issue.reference.questionNumber}` : ''}</strong><p>{issue.message}</p>{issue.fixTarget && <Link className="secondary-link" to={preflightFixUrl(selectedQuiz.id, issue.fixTarget)}>Opravit</Link>}</li>)}</ul> : <p>Kontrola nenašla žádné nedostatky.</p>}
              </details>
            </div>}
            <button className="primary-button" type="button" disabled={lockDisabled} aria-busy={pending} onClick={() => void prepareQuiz()}>{pending ? 'Připravuji…' : locked ? 'Aktualizovat kvíz pro akci' : 'Připravit ke hraní'}</button>
          </div>
        ) : <p className="event-muted">Výběr zdrojového kvízu vyžaduje správu akce a přístup ke kvízu včetně odpovědí a exportu.</p>}
      </section>

    </article>
  );
}
