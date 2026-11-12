import { Link } from 'react-router-dom';
import { eventDisposition, eventOperational } from '@filmovy-kviz/quiz-domain';
import { useAuth } from '../../auth/AuthProvider';
import { EventPublicationButton } from '../events/EventPublicationButton';
import { eventCapacity, eventCountdown, eventDateLabel, registrationPresentation } from '../events/eventPresentation';
import type { EventRecord } from '../events/types';
import type { QuizSummary } from '../quizzes/types';
import { eventLifecycleLabels } from './dashboardModel';

export function DashboardEventCard({ event, quiz, now, onChanged }: {
  event: EventRecord; quiz?: QuizSummary; now: number; onChanged: (event: EventRecord) => void;
}) {
  const { can } = useAuth();
  const base = `/admin/events/${encodeURIComponent(event.id)}`;
  const registration = registrationPresentation(event, now);
  const capacity = eventCapacity(event);
  const assignment = event.quizAssignment;
  const changedSource = assignment && quiz?.revision !== undefined && quiz.revision !== assignment.quizRevision;
  const canPublish = can('event.manage') && (eventOperational(event)
    || event.lifecycleStatus === 'completed' && eventDisposition(event) === 'active' && event.registrationPublished);
  return <article className="dashboard-event-card surface-card" data-event-id={event.id} aria-label={event.title}>
    <div className="dashboard-event-heading"><div>
      <p className="eyebrow">{eventCountdown(event, now)}</p>
      <h3><Link to={base}>{event.title}</Link></h3>
      <p className="dashboard-event-date"><time dateTime={Number.isFinite(event.startsAt.getTime()) ? event.startsAt.toISOString() : undefined}>{eventDateLabel(event)}</time></p>
      {event.venue.name && <p className="card-meta">{event.venue.name}</p>}
    </div></div>
    <dl className="dashboard-event-statuses">
      <div><dt>Stav akce</dt><dd><span className={`dashboard-badge lifecycle-${event.lifecycleStatus}`}>{eventLifecycleLabels[event.lifecycleStatus]}</span></dd></div>
      <div><dt>Zveřejnění</dt><dd><span className={`dashboard-badge ${event.registrationPublished ? 'is-positive' : ''}`}>{event.registrationPublished ? 'Zveřejněno' : 'Nezveřejněno'}</span></dd></div>
      <div><dt>Registrace</dt><dd><span className={`dashboard-badge ${registration.canRegister ? 'is-positive' : ''}`}>{registration.label}</span></dd></div>
    </dl>
    <dl className="dashboard-capacity">
      <div><dt>Přihlášeno týmů</dt><dd>{event.acceptedTeams} <small>/ {event.teamCapacity}</small></dd></div>
      <div><dt>Volná kapacita</dt><dd>{capacity.freeTeams ?? '—'} týmů</dd></div>
    </dl>
    <div className="dashboard-event-quiz">
      <strong>Kvíz: {assignment?.quizTitle ?? 'Nepřiřazen'}</strong>
      <p>{assignment ? 'Pro akci existuje připravená verze.' : 'Kvíz nepřiřazen. Přiřaďte připravenou verzi před hraním.'}</p>
      {assignment && <p className="card-meta">{assignment.roundCount} kol · {assignment.questionCount} otázek</p>}
      {changedSource && <p className="dashboard-source-warning">Zdrojový kvíz se změnil. Připravená verze akce zůstává zachována. <Link to={`${base}#event-quiz`}>Zkontrolovat verzi</Link></p>}
      {!assignment && can('event.manage') && can('quiz.read') && <Link to={`${base}#event-quiz`}>Přiřadit kvíz</Link>}
    </div>
    <div className="dashboard-event-actions">
      <Link className="primary-link" to={base}>Spravovat akci</Link>
      {event.lifecycleStatus === 'live' && event.liveSessionId && can('event.live') && <Link className="secondary-link" to={`/admin/live/${encodeURIComponent(event.liveSessionId)}`}>Otevřít moderování</Link>}
      {canPublish && <EventPublicationButton event={event} onChanged={onChanged} />}
      {event.registrationPublished && !canPublish && <Link className="dashboard-public-link" to={`/events/${encodeURIComponent(event.id)}`}>Veřejný detail</Link>}
    </div>
  </article>;
}
