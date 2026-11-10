import { useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useNavigation } from 'react-router-dom';

import { createEvent, eventActionError } from '../../features/events/eventApi';
import { EventForm } from '../../features/events/EventForm';
import type { EventFormValues } from '../../features/events/types';
import { useAuth } from '../../auth/AuthProvider';

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
  const navigate = useNavigate();
  const { key: entryKey } = useLocation();
  const leaving = useNavigation().location !== undefined;
  const uid = currentUser?.uid;
  const canCreate = can('event.create');
  const scope = JSON.stringify([uid, entryKey]);
  const observeCreate = useRef<((request: CreateRequest) => Promise<void>) | null>(null);
  const [values, setValues] = useState(initialValues);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (!uid || !canCreate || leaving) return;
    let active = true;
    const observe = async (request: CreateRequest) => {
      setPending(true);
      try {
        const result = await request;
        // Router state can change before React commits its navigation context.
        if (active && isCurrentEntry(entryKey)) await navigate(`/admin/events/${result.eventId}`);
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
  }, [canCreate, entryKey, isCurrentEntry, leaving, navigate, scope, uid]);

  const submit = () => {
    const observe = observeCreate.current;
    if (!observe || !isCurrentEntry(entryKey) || pendingCreates.has(scope)) return;
    setError(null);
    try {
      const request = createEvent(values);
      pendingCreates.set(scope, request);
      const clear = () => { if (pendingCreates.get(scope) === request) pendingCreates.delete(scope); };
      void request.then(clear, clear);
      void observe(request);
    } catch (actionError) {
      setError(eventActionError(actionError));
    }
  };
  if (!canCreate) {
    return <section className="quiz-state-card"><div><h2>Pouze pro administrátora</h2><p>Moderátor může akce prohlížet, ale nemůže měnit jejich konfiguraci.</p></div><Link className="secondary-link" to="/admin/events">Zpět na akce</Link></section>;
  }
  return (
    <section className="event-editor-page">
      <Link className="back-link" to="/admin/events">← Zpět na akce</Link>
      <header className="event-page-heading event-form-heading"><h1>Vytvořit akci</h1><p className="lead">Vyplňte základní údaje a kapacitu. Registrace nastavíte v detailu akce.</p></header>
      {error && <p className="round-editor-error" role="alert">{error}</p>}
      <EventForm values={values} pending={pending || leaving} submitLabel="Vytvořit akci" pendingLabel={leaving ? 'Otevírám stránku…' : 'Vytvářím…'} onChange={setValues} onSubmit={submit} />
    </section>
  );
}
