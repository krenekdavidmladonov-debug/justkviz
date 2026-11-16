import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { useAuth } from '../../auth/AuthProvider';
import { eventDisposition } from '@filmovy-kviz/quiz-domain';
import { EventActions } from '../../features/events/EventActions';
import { listEvents } from '../../features/events/eventRepository';
import type { EventRecord } from '../../features/events/types';
import { QuizErrorState } from '../../features/quizzes/QuizErrorState';
import { QuizLoading } from '../../features/quizzes/QuizLoading';

const lifecycleLabels: Record<EventRecord['lifecycleStatus'], string> = {
  draft: 'Koncept', scheduled: 'Naplánováno', ready: 'Připraveno', live: 'Probíhá',
  finalizing: 'Uzavírání', completed: 'Dokončeno', cancelled: 'Zrušeno', archived: 'Archivováno',
};

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Prague' }).format(value);
}

export function AdminEventsPage() {
  const { can } = useAuth();
  const [events, setEvents] = useState<readonly EventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('current');
  const [page, setPage] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { setEvents(await listEvents()); }
    catch { setError('Akce se nepodařilo načíst.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (loading) return <QuizLoading label="Načítám akce…" />;
  if (error) return <QuizErrorState message={error} onRetry={() => void load()} />;
  const category = (event: EventRecord) => {
    const disposition = eventDisposition(event);
    if (disposition === 'trash' || disposition === 'deleting') return 'trash';
    if (disposition === 'archived') return 'archive';
    return ['completed', 'archived'].includes(event.lifecycleStatus) ? 'completed' : event.lifecycleStatus === 'cancelled' ? 'cancelled' : 'current';
  };
  const visible = events.filter(event => category(event) === filter);
  return (
    <section className="event-library">
      <header className="section-heading">
        <div><p className="eyebrow">Administrace</p><h1>Akce</h1><p className="lead">Termíny, kapacity a připravené verze kvízů.</p></div>
        {can('event.create') && <Link className="primary-button" to="/admin/events/new">Vytvořit akci</Link>}
      </header>
      {notice && <p role="status" className="event-notice">{notice}</p>}
      <nav className="event-filters" aria-label="Filtry akcí">{Object.entries({ current: 'Aktuální a připravované', completed: 'Dokončené', cancelled: 'Zrušené', archive: 'Archiv', trash: 'Koš' }).filter(([key]) => key !== 'trash' || can('event.manage') || can('event.delete')).map(([key, label]) => <button className="secondary-button" key={key} aria-pressed={filter === key} onClick={() => { setFilter(key); setPage(0); }}>{label} ({events.filter(event => category(event) === key).length})</button>)}</nav>
      {visible.length === 0 ? (
        <div className="quiz-state-card"><div><h2>V tomto přehledu nejsou žádné akce</h2><p>Vyberte jiný filtr nebo vytvořte nový termín.</p></div></div>
      ) : (
        <div className="event-card-list">
          {visible.slice(page * 20, (page + 1) * 20).map((event) => (
            <article className="event-card" key={event.id}><Link className="event-card-main" to={`/admin/events/${event.id}`}>
              <div><span className={`quiz-status status-${event.lifecycleStatus}`}>{lifecycleLabels[event.lifecycleStatus]}</span><h2>{event.title}</h2><p>{event.venue.name}</p></div>
              <div className="event-card-meta"><strong>{formatDate(event.startsAt)}</strong><span>{event.acceptedTeams} týmů · {event.quizAssignment?.quizTitle ?? 'Kvíz nepřiřazen'}</span>{eventDisposition(event) === 'deleting' && <strong>Mazání probíhá</strong>}</div>
            </Link><EventActions event={event} onChanged={(message, deleted, updated) => {
              setEvents(current => deleted ? current.filter(item => item.id !== event.id) : current.map(item => item.id === event.id && updated ? updated : item));
              setPage(0);
              setNotice(message);
            }} /></article>
          ))}
        </div>
      )}
      {visible.length > 20 && <nav aria-label="Stránkování akcí"><button className="secondary-button" disabled={page === 0} onClick={() => setPage(page - 1)}>Předchozí</button><span> Strana {page + 1} / {Math.ceil(visible.length / 20)} </span><button className="secondary-button" disabled={(page + 1) * 20 >= visible.length} onClick={() => setPage(page + 1)}>Další</button></nav>}
    </section>
  );
}
