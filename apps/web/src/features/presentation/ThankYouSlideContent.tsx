import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { eventDateLabel } from '../events/eventPresentation';
import { subscribePublishedEvents } from '../events/eventRepository';
import { registrationQrOptions } from '../events/registrationSharing';
import type { PublicEventRecord } from '../events/types';

const links = [
  { title: 'Přihlášky na kvízy', url: 'https://justkviz.cz/events', caption: 'justkviz.cz/events' },
  { title: 'Facebook JustKvízu', url: 'https://www.facebook.com/profile.php?id=61596012273723', caption: 'Sledujte nás' },
] as const;

const eventsPerPage = 4;
const finishedStatuses = new Set(['live', 'finalizing', 'completed', 'cancelled', 'archived']);

function EventDates({ enabled }: { readonly enabled: boolean }) {
  const [events, setEvents] = useState<readonly PublicEventRecord[] | null>();
  const [now, setNow] = useState(Date.now);
  const [page, setPage] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const offline = () => setEvents(null);
    window.addEventListener('offline', offline);
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = subscribePublishedEvents(next => {
        setNow(Date.now());
        setEvents(window.navigator.onLine ? next : null);
      });
    } catch {
      offline();
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      unsubscribe?.();
      window.clearInterval(timer);
      window.removeEventListener('offline', offline);
    };
  }, [enabled]);

  const upcoming = (enabled ? events ?? [] : []).filter(event =>
    event.registrationPublished && !event.cancelled && !finishedStatuses.has(event.lifecycleStatus ?? '')
    && event.startsAt.getTime() > now
  ).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const pages = Math.ceil(upcoming.length / eventsPerPage);
  const currentPage = page % Math.max(1, pages);

  useEffect(() => {
    if (pages <= 1) return;
    const timer = window.setInterval(() => setPage(current => (current + 1) % pages), 10000);
    return () => window.clearInterval(timer);
  }, [pages]);

  const offset = currentPage * eventsPerPage;
  let message = 'Další termíny najdete na stránce přihlášek.';
  if (enabled && events === undefined) message = 'Načítáme termíny…';
  if (enabled && events && upcoming.length === 0) message = 'Nové termíny právě chystáme.';

  return (
    <section className="thank-you-dates" aria-label="Nadcházející kvízy">
      <h2>Nadcházející kvízy</h2>
      {upcoming.length === 0 ? <p>{message}</p> : <>
        <ul>
          {upcoming.slice(offset, offset + eventsPerPage).map(event => (
            <li key={event.id}>
              <strong>{event.title}</strong>
              <span><time dateTime={event.startsAt.toISOString()}>{eventDateLabel(event)}</time>
                {event.venueName && <> · {event.venueName}</>}</span>
            </li>
          ))}
        </ul>
        {pages > 1 && <p className="thank-you-page">Termíny {currentPage + 1} / {pages}</p>}
      </>}
    </section>
  );
}

export function ThankYouSlideContent({ title, text, liveEventsEnabled }: {
  readonly title: string; readonly text: string; readonly liveEventsEnabled: boolean;
}) {
  const [codes, setCodes] = useState<readonly string[]>([]);
  useEffect(() => {
    let active = true;
    void Promise.all(links.map(link => QRCode.toDataURL(link.url, registrationQrOptions))).then(result => {
      if (active) setCodes(result);
    }, () => { /* Keep the links usable if QR rendering fails. */ });
    return () => { active = false; };
  }, []);

  return (
    <section className="thank-you-slide">
      <div className="thank-you-heading">
        <h1>{title || 'Děkujeme, že jste hráli!'}</h1>
        {text && <p>{text}</p>}
      </div>
      <div className="thank-you-details">
        <EventDates enabled={liveEventsEnabled} />
        <div className="thank-you-links">
          {links.map(({ title: linkTitle, caption, url }, index) => (
            <a key={url} href={url} target="_blank" rel="noopener noreferrer">
              {codes[index] && <img src={codes[index]} alt={`QR kód – ${linkTitle}`} />}
              <strong>{linkTitle}</strong>
              <span>{caption}</span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
