import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { eventDateLabel } from '../../features/events/eventPresentation';
import type { PublicEventResults } from '../../features/events/publicEventResults';

export function CompletedPublicEvent({ result }: { readonly result:PublicEventResults }) {
  useEffect(() => {
    const previous = document.title, title = `${result.title} – ${eventDateLabel(result, false)}`;
    document.title = title;
    return () => { if (document.title === title) document.title = previous; };
  }, [result]);
  const winners = result.rows.filter(row => row.rank === 1);
  return <article className="public-event-detail public-completed-event">
    <Link className="back-link" to="/">← Zpět na akce</Link>
    <header className="public-event-detail-hero"><p className="eyebrow">JustKvíz / Akce proběhla</p><h1>{result.title}</h1>
      <p>{eventDateLabel(result)} · {result.venueName}</p>{result.publicLocation && <p>{result.publicLocation}</p>}
    </header>
    <section className="public-event-panel public-event-winners" aria-labelledby="event-winners-title"><p className="eyebrow">Potvrzené konečné výsledky</p><h2 id="event-winners-title">{winners.length > 1 ? 'Vítězové' : 'Vítěz'}</h2>
      <ul>{winners.map((row, index) => <li key={index}><strong>{row.teamName}</strong><span>{(row.halfPoints / 2).toLocaleString('cs-CZ')} bodů · 1. místo</span></li>)}</ul>
    </section>
    <section className="public-event-panel public-event-standings" aria-label="Konečné pořadí týmů">
      <table><caption>Konečné pořadí</caption><thead><tr><th scope="col">Pořadí</th><th scope="col">Tým</th><th scope="col">Body</th></tr></thead>
        <tbody>{result.rows.map((row, index) => <tr key={index}><td>{row.rank}.</td><th scope="row">{row.teamName}</th><td>{(row.halfPoints / 2).toLocaleString('cs-CZ')}</td></tr>)}</tbody>
      </table><p>Shodné body znamenají sdílené umístění.</p>
    </section>
    <Link className="public-event-cta secondary" to="/">Prohlédnout další akce <span aria-hidden="true">↗</span></Link>
  </article>;
}
