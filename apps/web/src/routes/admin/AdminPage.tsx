import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { compactDashboardEvents, compactEventCountdown } from '../../features/dashboard/compactDashboard';
import { dashboardDrafts } from '../../features/dashboard/dashboardModel';
import { useDashboardData } from '../../features/dashboard/useDashboardData';
import { eventCapacity, eventDateLabel } from '../../features/events/eventPresentation';
import type { EventRecord } from '../../features/events/types';
import { formatQuizDate } from '../../features/quizzes/presentation';
import { QuizLoading } from '../../features/quizzes/QuizLoading';
import '../../styles/dashboard-overview.css';

function CompactEventOverview({ event, now }: { event: EventRecord; now: number }) {
  const capacity = eventCapacity(event);
  const countdown = compactEventCountdown(event, now);
  return <section className="dashboard-event-summary" aria-label={event.title} data-event-id={event.id}>
    <div className="dashboard-event-heading">
      <div><h2>{event.title}</h2><time dateTime={event.startsAt.toISOString()}>{eventDateLabel(event)}</time></div>
      <Link className="secondary-link" to={`/admin/events/${encodeURIComponent(event.id)}`}>Spravovat akci</Link>
    </div>
    <dl className="dashboard-stats">
      <div className="dashboard-stat-countdown"><dt>Do začátku</dt><dd><strong>{countdown.main}</strong>{countdown.detail && <span className="dashboard-stat-detail">{countdown.detail}</span>}</dd></div>
      <div className={`dashboard-stat-availability ${capacity.freeTeams !== 0 ? 'has-space' : ''}`}><dt>Volno</dt><dd><strong>{capacity.freeTeams ?? '—'} <small>týmů</small></strong></dd></div>
      <div><dt>Týmy</dt><dd><strong>{event.acceptedTeams}</strong><span className="dashboard-stat-limit"> / {event.teamCapacity}</span></dd><progress className="dashboard-team-occupancy" aria-label="Obsazenost týmů" max={event.teamCapacity} value={event.acceptedTeams} /></div>
    </dl>
  </section>;
}

export function AdminPage() {
  const { can } = useAuth();
  const { quizzes, events, loading, quizError, eventError, updatedAt, load } = useDashboardData();
  if (loading && !updatedAt) return <QuizLoading label="Načítám přehled…" />;
  const now = Date.now();
  const upcoming = compactDashboardEvents(events, now);
  const drafts = dashboardDrafts(quizzes, 6);

  return <section className="admin-dashboard dashboard-compact">
    <header className="dashboard-heading">
      <h1>Přehled</h1>
      {can('quiz.create') && <nav className="dashboard-actions" aria-label="Akce přehledu"><Link className="primary-link" to="/admin/quizzes/new">Nový kvíz</Link></nav>}
    </header>

    {can('event.read') && (eventError ? <div className="dashboard-inline-error" role="alert"><span>Akce se nepodařilo načíst.</span><button type="button" className="quiet-button" onClick={() => void load()}>Zkusit znovu</button></div>
      : upcoming.length > 0 ? <div className="dashboard-event-list">{upcoming.map(event => <CompactEventOverview key={event.id} event={event} now={now} />)}</div>
        : <section className="dashboard-compact-empty" aria-label="Přehled akce"><p>Žádná zveřejněná nadcházející akce.</p><Link className="secondary-link" to="/admin/events">Otevřít akce</Link></section>)}

    {!can('event.read') && !can('quiz.read') && <p className="dashboard-access-note">Svůj přístup najdete v <Link to="/account">osobním účtu</Link>.</p>}

    {can('quiz.read') && <section className="dashboard-drafts" aria-labelledby="dashboard-drafts-title">
      <div className="dashboard-drafts-heading"><h2 id="dashboard-drafts-title">Rozpracované kvízy</h2><Link to="/admin/quizzes">Všechny kvízy</Link></div>
      {quizError ? <div className="dashboard-inline-error" role="alert"><span>Kvízy se nepodařilo načíst.</span><button type="button" className="quiet-button" onClick={() => void load()}>Zkusit znovu</button></div>
        : drafts.length > 0 ? <div className="dashboard-draft-grid">{drafts.map(quiz => <article className="dashboard-draft-card" key={quiz.id}>
          <h3>{quiz.title}</h3><p className="card-meta">Upraveno {formatQuizDate(quiz.updatedAt)}</p>
          <Link to={`/admin/quizzes/${encodeURIComponent(quiz.id)}${can('quiz.edit') ? '/edit' : ''}`}>{can('quiz.edit') ? 'Pokračovat v úpravách' : 'Otevřít detail'} <span aria-hidden="true">→</span></Link>
        </article>)}</div> : <p className="dashboard-drafts-empty">Žádné rozpracované kvízy.</p>}
    </section>}

    {(can('event.read') || can('quiz.read')) && <footer className="dashboard-refresh"><p className="card-meta" role="status">{loading ? 'Aktualizuji…' : updatedAt ? `Aktualizováno ${new Intl.DateTimeFormat('cs-CZ', { timeStyle: 'short' }).format(updatedAt)}` : ''}</p><button type="button" className="quiet-button" disabled={loading} onClick={() => void load()}>Obnovit</button></footer>}
  </section>;
}
