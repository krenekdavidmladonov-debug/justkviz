import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { createEvent, eventActionError } from '../../features/events/eventApi';
import { EventForm } from '../../features/events/EventForm';
import type { EventFormValues } from '../../features/events/types';
import { useAuth } from '../../auth/AuthProvider';

const initialValues: EventFormValues = {
  title: '', startsAt: '', timeZone: 'Europe/Prague', venueName: '', publicLocation: '',
  pricingMode: 'per-team', pricingAmountCzk: 350, pricingHidden: false,
  teamCapacity: 20, peopleCapacity: 80, teamSizeMin: 2, teamSizeMax: 4,
};

export function AdminEventCreatePage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [values, setValues] = useState(initialValues);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      const result = await createEvent(values);
      await navigate(`/admin/events/${result.eventId}`);
    } catch (actionError) {
      setError(eventActionError(actionError));
    } finally {
      setPending(false);
    }
  };
  if (!can('event.create')) {
    return <section className="quiz-state-card"><div><h2>Pouze pro administrátora</h2><p>Moderátor může akce prohlížet, ale nemůže měnit jejich konfiguraci.</p></div><Link className="secondary-link" to="/admin/events">Zpět na akce</Link></section>;
  }
  return (
    <section className="event-editor-page">
      <Link className="back-link" to="/admin/events">← Zpět na akce</Link>
      <header className="event-page-heading event-form-heading"><h1>Vytvořit akci</h1><p className="lead">Vyplňte základní údaje a kapacitu. Registrace nastavíte v detailu akce.</p></header>
      {error && <p className="round-editor-error" role="alert">{error}</p>}
      <EventForm values={values} pending={pending} submitLabel="Vytvořit akci" pendingLabel="Vytvářím…" onChange={setValues} onSubmit={() => void submit()} />
    </section>
  );
}
