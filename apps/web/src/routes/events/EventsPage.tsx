import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { listPublicEvents } from '../../features/events/eventRepository';
import { eventCountdown, eventDateLabel, isPastEvent, registrationPresentation } from '../../features/events/eventPresentation';
import type { PublicEventRecord } from '../../features/events/types';
import { EventCapacity, EventDateTile, EventPrice } from './PublicEventElements';
import './public-events.css';

function PublicEventCard({ event, now }: { event: PublicEventRecord; now: number }) {
  const registration = registrationPresentation(event, now);
  return <article className={`public-event-card registration-${registration.status}`}>
    <div className="public-event-card-top"><span className={`public-registration-badge status-${registration.status}`}>{registration.label}</span><span className="public-event-countdown">{eventCountdown(event, now)}</span></div>
    <div className="public-event-card-heading"><EventDateTile event={event} /><div><h3><Link to={`/events/${event.id}`}>{event.title}</Link></h3></div></div>
    <div className="public-event-place"><p><span aria-hidden="true">◷</span><strong>{eventDateLabel(event)}</strong></p><p><span aria-hidden="true">⌖</span><span><strong>{event.venueName || 'Místo bude upřesněno'}</strong>{event.publicLocation && <small>{event.publicLocation}</small>}</span></p></div>
    {event.description && <p className="public-event-description">{event.description}</p>}
    <EventPrice event={event} />
    <EventCapacity event={event} />
    <Link className={registration.canRegister ? 'public-event-cta' : 'public-event-cta secondary'} to={`/events/${event.id}${registration.canRegister ? '#prihlaseni' : ''}`}><span>{registration.canRegister ? 'Přihlásit tým' : 'Detail akce'}</span><span aria-hidden="true">↗</span></Link>
  </article>;
}
export function EventsPage() {
  const [events, setEvents] = useState<readonly PublicEventRecord[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState(false), [now, setNow] = useState(Date.now);
  const load = useCallback(async () => {
    setLoading(true); setError(false);
    try { setEvents(await listPublicEvents()); }
    catch { setError(true); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 15000); return () => window.clearInterval(timer); }, []);
  const visible = events.filter(event => event.registrationPublished);
  const upcoming = visible.filter(event => !isPastEvent(event, now)), past = visible.filter(event => isPastEvent(event, now)).reverse();
  return <section className="public-events-page">
    <header className="public-events-hero">
      <p className="eyebrow">Kvízy pro společné zážitky</p>
      <img className="public-events-hero-logo" src="/brand/justkviz-dark.svg" alt="JustKvíz" width="880" height="200" />
      <h1>Každý ví něco.<br /><span>Společně víte víc.</span></h1>
      <p className="lead">JustKvíz je týmová zábava plná otázek, hudby, obrázků a překvapení. Spojí přátele i kolegy — v hospodě, na firemním večírku nebo při soukromé oslavě.</p>
      {!loading && !error && <a className="public-events-hero-cta" href="#nadchazejici">Prohlédnout nadcházející akce <span aria-hidden="true">↓</span></a>}
    </header>
    {loading ? <p className="event-public-state">Načítám akce…</p> : error ? <div className="event-public-state"><p>Akce se nepodařilo načíst.</p><button className="secondary-button" type="button" onClick={() => void load()}>Načíst znovu</button></div> : <>
      <section id="nadchazejici" aria-label="Nadcházející a probíhající akce"><div className="public-events-section-heading"><h2>Nadcházející akce</h2><span>{upcoming.length} {upcoming.length === 1 ? 'akce' : upcoming.length > 1 && upcoming.length < 5 ? 'akce' : 'akcí'}</span></div>{upcoming.length === 0 ? <div className="event-public-state"><h3>Další večer teprve chystáme</h3><p>Právě tu nejsou žádné nadcházející akce. Nové termíny najdete na této stránce.</p></div> : <div className="public-event-grid">{upcoming.map(event => <PublicEventCard key={event.id} event={event} now={now} />)}</div>}</section>
      {past.length > 0 && <section className="public-event-history" aria-labelledby="past-events-title"><h2 id="past-events-title">Proběhlé akce</h2><div className="public-event-grid">{past.map(event => <PublicEventCard key={event.id} event={event} now={now} />)}</div></section>}
    </>}
  </section>;
}
