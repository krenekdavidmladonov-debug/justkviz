import { useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useNavigation } from 'react-router-dom';

import { createEvent, eventActionError } from '../../features/events/eventApi';
import { EventForm } from '../../features/events/EventForm';
import type { EventFormValues } from '../../features/events/types';
import { useAuth } from '../../auth/AuthProvider';
import { clearEventCreationAttempt, loadEventCreationAttempt, newEventCreationAttempt, persistEventCreationAttempt } from './eventCreationRecovery';

const initialValues: EventFormValues = {
  title: '', startsAt: '', timeZone: 'Europe/Prague', venueName: '', publicLocation: '',
  pricingMode: 'per-team', pricingAmountCzk: 350, pricingHidden: false,
  teamCapacity: 20, peopleCapacity: 80, teamSizeMin: 2, teamSizeMax: 4,
};
type CreateRequest = ReturnType<typeof createEvent>;
// Creating a scoped event may refresh membership and remount this history entry.
const pendingCreates = new Map<string, CreateRequest>();

export function AdminEventCreatePage({ isCurrentEntry }: { readonly isCurrentEntry: (entryKey: string) => boolean }) {
  const { can, currentUser } = useAuth();
  if (!currentUser || !can('event.create')) {
    return <section className="quiz-state-card"><div><h2>Pouze pro administrátora</h2><p>Moderátor může akce prohlížet, ale nemůže měnit jejich konfiguraci.</p></div><Link className="secondary-link" to="/admin/events">Zpět na akce</Link></section>;
  }
  return <EventCreationForm key={currentUser.uid} uid={currentUser.uid} isCurrentEntry={isCurrentEntry} />;
}

function EventCreationForm({ uid, isCurrentEntry }: { readonly uid: string; readonly isCurrentEntry: (entryKey: string) => boolean }) {
  const navigate = useNavigate();
  const { key: entryKey } = useLocation();
  const leaving = useNavigation().location !== undefined;
  const [attempt, setAttempt] = useState(() => loadEventCreationAttempt(uid));
  const attemptRef = useRef(attempt); attemptRef.current = attempt;
  const [checkedEvents, setCheckedEvents] = useState(false);
  const scope = JSON.stringify([uid, attempt?.requestId]);
  const observeCreate = useRef<((request: CreateRequest) => Promise<void>) | null>(null);
  const [values, setValues] = useState(attempt?.submittedValues ?? initialValues);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (leaving) return;
    let active = true;
    const observe = async (request: CreateRequest) => {
      const observedAttempt = attemptRef.current;
      setPending(true);
      try {
        const result = await request;
        // Router state can change before React commits its navigation context.
        if (active && observedAttempt && observedAttempt.requestId === attemptRef.current?.requestId && isCurrentEntry(entryKey)) {
          clearEventCreationAttempt(observedAttempt);
          await navigate(`/admin/events/${encodeURIComponent(result.eventId)}`);
        }
      } catch (actionError) {
        if (active) setError(eventActionError(actionError));
      } finally {
        if (active) setPending(false);
      }
    };
    observeCreate.current = observe;
    const request = pendingCreates.get(scope);
    if (request) void observe(request);
    else setPending(false);
    return () => { active = false; observeCreate.current = null; };
  }, [entryKey, isCurrentEntry, leaving, navigate, scope]);

  const submit = () => {
    const observe = observeCreate.current;
    if (!observe || !attempt || attemptRef.current?.requestId !== attempt.requestId || !isCurrentEntry(entryKey) || pendingCreates.has(scope)) return;
    setError(null);
    try {
      const submitted = { ...attempt, submittedValues: attempt.submittedValues ?? { ...values,
        pricingAmountCzk: values.pricingMode === 'agreement' ? 0 : values.pricingAmountCzk,
      } };
      if (!persistEventCreationAttempt(submitted)) {
        setError('Pokus se nepodařilo bezpečně uložit v tomto prohlížeči. Akce nebyla odeslána. Povolte úložiště pro tuto stránku a zkuste to znovu.');
        return;
      }
      attemptRef.current = submitted; setAttempt(submitted); setValues(submitted.submittedValues);
      const request = createEvent(submitted.submittedValues, submitted.requestId);
      pendingCreates.set(scope, request);
      const clear = () => { if (pendingCreates.get(scope) === request) pendingCreates.delete(scope); };
      void request.then(clear, clear);
      void observe(request);
    } catch (actionError) {
      setError(eventActionError(actionError));
    }
  };
  return (
    <section className="event-editor-page">
      <Link className="back-link" to="/admin/events">← Zpět na akce</Link>
      <header className="event-page-heading event-form-heading"><h1>Vytvořit akci</h1><p className="lead">Vyplňte základní údaje a kapacitu. Registrace nastavíte v detailu akce.</p></header>
      {error && <p className="round-editor-error" role="alert">{error}</p>}
      {!attempt && <p role="alert">Předchozí pokus nelze bezpečně načíst. Než začnete nový, zkontrolujte přehled akcí.</p>}
      <EventForm values={values} confirmPastDate fieldsLocked={!attempt || attempt.submittedValues !== null} pending={pending || leaving || !attempt} submitLabel={attempt?.submittedValues ? 'Zkusit znovu' : 'Vytvořit akci'} pendingLabel={leaving ? 'Otevírám stránku…' : 'Vytvářím…'} onChange={setValues} onSubmit={submit} />
      {(!attempt || attempt.submittedValues !== null) && <div className="event-form-section">
        <p>Při nejasném výsledku opakujte stejný pokus. Před novým pokusem <Link to="/admin/events">zkontrolujte přehled akcí</Link>, zda už akce vznikla.</p>
        <label><input type="checkbox" checked={checkedEvents} disabled={pending || leaving} onChange={event => setCheckedEvents(event.target.checked)} /> Zkontroloval(a) jsem přehled a chci začít nový pokus.</label>
        <button type="button" className="secondary-button" disabled={pending || leaving || !checkedEvents} onClick={() => {
          if (attemptRef.current?.requestId !== attempt?.requestId || pendingCreates.has(scope) || !isCurrentEntry(entryKey)) return;
          const fresh = newEventCreationAttempt(uid);
          if (!persistEventCreationAttempt(fresh)) { setError('Nový pokus nelze bezpečně uložit. Povolte úložiště pro tuto stránku a zkuste to znovu.'); return; }
          attemptRef.current = fresh; setAttempt(fresh); setValues(initialValues); setCheckedEvents(false); setError(null);
        }}>Začít nový pokus</button>
      </div>}
    </section>
  );
}
