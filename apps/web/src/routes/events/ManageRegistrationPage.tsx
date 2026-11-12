import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';

import { cancelManagedRegistration, getManagedRegistration, registrationActionError, updateManagedRegistration, type RegistrationFormValues } from '../../features/events/registrationApi';
import type { RegistrationMutationResponse, PublicEventRecord } from '../../features/events/types';
import { getPublicEvent } from '../../features/events/eventRepository';
import { RegistrationForm, type RegistrationDraftValues } from '../../features/registrations/RegistrationForm';

export function ManageRegistrationPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const location = useLocation();
  const search = new URLSearchParams(location.hash.replace(/^#/u, ''));
  const registrationId = search.get('registration') ?? '';
  const token = search.get('token') ?? '';
  // Credentials own all form, request and feedback state. A new link must not
  // render the previous team's contact details, even before effects run.
  return <RegistrationManagement key={JSON.stringify([eventId, registrationId, token])} eventId={eventId} registrationId={registrationId} token={token} />;
}

function RegistrationManagement({ eventId, registrationId, token }: {
  readonly eventId: string | undefined;
  readonly registrationId: string;
  readonly token: string;
}) {
  const [registration, setRegistration] = useState<RegistrationMutationResponse | null>(null);
  const [event, setEvent] = useState<PublicEventRecord | null>(null);
  const [values, setValues] = useState<RegistrationDraftValues>({ teamName: '', memberCount: 1, contactEmail: '' });
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const operation = useRef<{ fingerprint: string; id: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!eventId || !registrationId || !token) { setError('Bezpečný odkaz není platný.'); return; }
    let active = true;
    setRegistration(null); setEvent(null); setError(null);
    void Promise.all([getManagedRegistration(eventId, registrationId, token), getPublicEvent(eventId)]).then(([result, publicEvent]) => {
      if (!active) return;
      if (!publicEvent) { setError('Akce již není dostupná pro správu registrace.'); return; }
      setEvent(publicEvent);
      setRegistration(result); setValues({ teamName: result.teamName, memberCount: result.memberCount, contactEmail: result.contactEmail });
    }).catch((reason) => { if (active) setError(registrationActionError(reason)); });
    return () => { active = false; };
  }, [eventId, registrationId, token]);
  const save = async (submittedValues: RegistrationFormValues) => {
    if (!mounted.current || !eventId || !registrationId || !token || inFlight.current) return;
    inFlight.current = true;
    const fingerprint = JSON.stringify([eventId, registrationId, submittedValues]);
    if (operation.current?.fingerprint !== fingerprint) operation.current = { fingerprint, id: crypto.randomUUID() };
    setPending(true); setError(null); setMessage(null);
    try {
      const result = await updateManagedRegistration(eventId, registrationId, token, submittedValues, operation.current.id);
      if (!mounted.current) return;
      setRegistration(result); operation.current = null; setMessage('Registrace byla upravena.');
    }
    catch (reason) { if (mounted.current) setError(registrationActionError(reason)); }
    finally { if (mounted.current) { inFlight.current = false; setPending(false); } }
  };
  const cancel = async () => {
    if (!mounted.current || !eventId || !registrationId || !token || inFlight.current || !window.confirm('Opravdu zrušit registraci týmu?')) return;
    inFlight.current = true; setPending(true); setError(null); setMessage(null);
    try {
      const result = await cancelManagedRegistration(eventId, registrationId, token);
      if (!mounted.current) return;
      setRegistration(result); setMessage('Registrace byla zrušena.');
    }
    catch (reason) { if (mounted.current) setError(registrationActionError(reason)); }
    finally { if (mounted.current) { inFlight.current = false; setPending(false); } }
  };
  return <article className="public-event-detail"><Link className="back-link" to={eventId ? `/events/${eventId}` : '/'}>← Zpět na akci</Link><header><p className="eyebrow">Bezpečný management link</p><h1>Správa registrace</h1></header>
    {error && <p className="round-editor-error" role="alert">{error}</p>}{message && <p className="event-notice" role="status">{message}</p>}
    {!registration && !error && <p>Ověřuji odkaz…</p>}
    {registration?.status === 'cancelled' ? <section className="event-section"><h2>Registrace je zrušená</h2><p>{registration.teamName}</p></section> : registration && event ? <section className="event-section"><h2>{registration.teamName}</h2><RegistrationForm values={values} minimum={event.teamSizeMin} maximum={event.teamSizeMax} pending={pending} submitLabel="Uložit změny" onChange={setValues} onSubmit={(submittedValues) => void save(submittedValues)} /><button className="danger-button" type="button" disabled={pending} onClick={() => void cancel()}>Zrušit registraci</button></section> : null}
  </article>;
}
