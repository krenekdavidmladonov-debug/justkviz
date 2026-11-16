import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { createEventRegistration, newRegistrationRetryKey, registrationActionError, type RegistrationFormValues } from '../../features/events/registrationApi';
import { getPublicEvent } from '../../features/events/eventRepository';
import { eventCountdown, eventDateLabel, registrationPresentation } from '../../features/events/eventPresentation';
import type { PublicEventRecord, RegistrationMutationResponse } from '../../features/events/types';
import { RegistrationForm, type RegistrationDraftValues } from '../../features/registrations/RegistrationForm';
import { EventCapacity, EventDateTile, EventPrice, registrationExplanation } from './PublicEventElements';
import './public-events.css';

const EMPTY: RegistrationDraftValues = { teamName: '', memberCount: 2, contactEmail: '' };

export function PublicEventPage() {
  const { eventId } = useParams<{ eventId: string }>();
  return <PublicEventRegistration key={eventId} eventId={eventId} />;
}

function PublicEventRegistration({ eventId }: { readonly eventId: string | undefined }) {
  const [event, setEvent] = useState<PublicEventRecord | null>(null);
  const [values, setValues] = useState(EMPTY);
  const [created, setCreated] = useState<RegistrationMutationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [now, setNow] = useState(Date.now);
  const inFlight = useRef(false);
  const loadVersion = useRef(0);
  const [requestKey] = useState(newRegistrationRetryKey);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!eventId) return;
    const version = ++loadVersion.current;
    setLoading(true); setEvent(null); setCreated(null); setError(null);
    try {
      const nextEvent = await getPublicEvent(eventId);
      if (version !== loadVersion.current) return;
      setEvent(nextEvent);
      if (nextEvent) setValues((current) => ({ ...current, memberCount: nextEvent.teamSizeMin }));
    } catch { if (version === loadVersion.current) setError('Akci se nepodařilo načíst.'); }
    finally { if (version === loadVersion.current) setLoading(false); }
  }, [eventId]);
  useEffect(() => { void load(); return () => { loadVersion.current++; }; }, [load]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 15000); return () => window.clearInterval(timer); }, []);

  if (loading) return <section className="public-event-detail"><div className="event-public-state" role="status">Načítám akci…</div></section>;
  if (!event) return <section className="public-event-detail"><div className="event-public-state"><h1>Akce není dostupná</h1>{error && <><p role="alert">{error}</p><button className="secondary-button" type="button" onClick={() => void load()}>Načíst znovu</button></>}<Link className="back-link" to="/">← Zpět na akce</Link></div></section>;
  const registration = registrationPresentation(event, now);
  const open = registration.canRegister;
  const managementPath = created?.managementToken
    ? `/events/${event.id}/registration/manage#registration=${encodeURIComponent(created.registrationId)}&token=${encodeURIComponent(created.managementToken)}`
    : '';
  const submit = async (submittedValues: RegistrationFormValues) => {
    if (inFlight.current || !registrationPresentation(event).canRegister) return;
    inFlight.current = true;
    const version = loadVersion.current;
    setPending(true); setError(null);
    try {
      const result = await createEventRegistration(event.id, submittedValues, requestKey);
      if (version !== loadVersion.current) return;
      setCreated(result);
      const refreshed = await getPublicEvent(event.id).catch(() => null);
      if (version === loadVersion.current && refreshed) setEvent(refreshed);
    }
    catch (reason) { if (version === loadVersion.current) setError(registrationActionError(reason)); }
    finally { inFlight.current = false; setPending(false); }
  };
  return <article className="public-event-detail">
    <Link className="back-link" to="/">← Zpět na akce</Link>
    <header className="public-event-detail-hero"><div className="public-event-detail-heading"><EventDateTile event={event} /><div><p className="eyebrow">JustKvíz / {eventCountdown(event, now)}</p><h1>{event.title}</h1></div></div><div className="public-event-detail-meta"><p><span className="public-event-kicker">Kdy se potkáme</span><strong>{eventDateLabel(event)}</strong></p><p><span className="public-event-kicker">Kde hrajeme</span><strong>{event.venueName || 'Místo bude upřesněno'}</strong>{event.publicLocation && <span>{event.publicLocation}</span>}</p></div>{event.description && <p className="public-event-description">{event.description}</p>}</header>
    <div className="public-event-detail-grid">
      <section className="public-event-panel registration-summary" aria-label={event.pricing?.hidden ? 'Kapacita akce' : 'Cena a kapacita akce'}><EventPrice event={event} /><EventCapacity event={event} /></section>
    {created ? <section id="prihlaseni" className="public-event-panel registration-success" role="status"><span className="public-registration-badge status-open">{created.status === 'cancelled' ? 'Registrace zrušena' : 'Tým je přihlášený'}</span><h2>{created.status === 'cancelled' ? 'Registrace je zrušená' : 'Děkujeme, tým byl přihlášen.'}</h2><p><strong>{created.teamName}</strong> · {created.memberCount} lidí · {event.title}</p><p>{created.status === 'cancelled' ? 'Tým již není aktivně přihlášen. Odkaz zobrazí stav registrace.' : 'Tento odkaz si uschovejte. Umožňuje registraci upravit nebo zrušit.'}</p><Link className="public-event-cta" to={managementPath}>Spravovat registraci <span aria-hidden="true">↗</span></Link></section>
      : <section id="prihlaseni" className={`public-event-panel public-registration-panel registration-${registration.status}`} aria-labelledby="registration-title"><span className={`public-registration-badge status-${registration.status}`}>{registration.label}</span><h2 id="registration-title">{open ? 'Přihlásit tým' : event.cancelled || event.lifecycleStatus === 'cancelled' ? 'Akce byla zrušena' : 'Přihlášení týmu'}</h2><p>{registrationExplanation(event, now)}</p>{open && <><p className="public-registration-note">Bez vytváření účtu. Stačí údaje o týmu a kontaktní e-mail.</p>{error && <p className="round-editor-error" role="alert">{error}</p>}<RegistrationForm values={values} minimum={event.teamSizeMin} maximum={Math.min(4, event.teamSizeMax)} pending={pending} submitLabel="Přihlásit tým" onChange={setValues} onSubmit={(submittedValues) => void submit(submittedValues)} /><p className="public-registration-privacy">Kontaktní e-mail ani údaje o registraci se veřejně nezobrazují. Po přihlášení získáte soukromý odkaz pro její správu.</p></>}{!open && <Link className="public-event-cta secondary" to="/">Prohlédnout další akce <span aria-hidden="true">↗</span></Link>}</section>}
    </div>
  </article>;
}
