import { eventCapacity, eventDateLabel, registrationPresentation } from '../../features/events/eventPresentation';
import type { PublicEventRecord } from '../../features/events/types';
import { eventPriceLabel } from '../../features/events/eventPricing';

export function EventPrice({ event }: { event: PublicEventRecord }) {
  if (event.pricing?.hidden === true) return null;
  return <p className="public-event-price"><span>Cena kvízu</span><strong>{eventPriceLabel(event.pricing)}</strong></p>;
}

export function EventDateTile({ event }: { event: PublicEventRecord }) {
  if (!Number.isFinite(event.startsAt.getTime())) return <div className="event-date-tile" aria-hidden="true"><strong>?</strong><span>termín</span></div>;
  let day: string, month: string;
  try {
    day = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', timeZone: event.timeZone }).format(event.startsAt);
    month = new Intl.DateTimeFormat('cs-CZ', { month: 'short', timeZone: event.timeZone }).format(event.startsAt);
  } catch {
    day = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', timeZone: 'Europe/Prague' }).format(event.startsAt);
    month = new Intl.DateTimeFormat('cs-CZ', { month: 'short', timeZone: 'Europe/Prague' }).format(event.startsAt);
  }
  return <div className="event-date-tile" aria-hidden="true"><strong>{day.replace('.', '')}</strong><span>{month}</span></div>;
}

export function EventCapacity({ event }: { event: PublicEventRecord }) {
  const capacity = eventCapacity(event);
  const accepted = Math.max(0, event.acceptedTeams);
  const occupied = Math.min(accepted, event.teamCapacity);
  const limited = capacity.freeTeams !== null;
  const segmented = limited && event.teamCapacity <= 24;
  return <div className={`public-event-capacity${capacity.freeTeams === 0 ? ' capacity-full' : ''}`}>
    <div className="public-capacity-heading"><span>Obsazenost týmů</span><span className="public-team-size">Členů v týmu <strong>max. {Math.min(4, event.teamSizeMax)}</strong></span></div>
    <dl className="public-capacity-counts">
      <div><dt>Přihlášené týmy</dt><dd>{accepted}</dd></div>
      <div className="public-capacity-available"><dt>Volná místa pro týmy</dt><dd>{capacity.freeTeams ?? <span>Bez limitu</span>}</dd></div>
    </dl>
    {limited && <div className="public-capacity-occupancy">
      <div className={`public-capacity-meter${segmented ? ' is-segmented' : ''}`} role="progressbar" aria-label="Obsazenost týmů" aria-valuemin={0} aria-valuemax={event.teamCapacity} aria-valuenow={occupied} aria-valuetext={`${accepted} z ${event.teamCapacity} týmů přihlášeno, ${capacity.freeTeams} volných míst pro týmy`}>
        {segmented ? Array.from({ length: event.teamCapacity }, (_, index) => <span key={index} className={index < occupied ? 'is-occupied' : undefined} />) : <span className="public-capacity-fill" style={{ width: `${occupied / event.teamCapacity * 100}%` }} />}
      </div>
      <div className="public-capacity-scale"><span><i aria-hidden="true" />{accepted} / {event.teamCapacity} týmů</span><span>{capacity.freeTeams === 0 ? 'Kapacita naplněna' : 'Místo pro váš tým'}</span></div>
    </div>}
  </div>;
}

export function registrationExplanation(event: PublicEventRecord, now: number): string {
  const registration = registrationPresentation(event, now);
  if (event.cancelled || event.lifecycleStatus === 'cancelled') return event.cancellationMessage || 'Tato akce byla zrušena. Přihlášení týmů není možné.';
  if (registration.status === 'scheduled') return event.registrationOpensAt
    ? `Přihlášení týmů se otevře ${eventDateLabel({ startsAt: event.registrationOpensAt, timeZone: event.timeZone })}.`
    : 'Přihlášení týmů se otevře později.';
  if (registration.status === 'full') return 'Kapacita pro další tým je právě obsazená. Pokud se místo uvolní v době registrací, přihlášení bude znovu dostupné.';
  if (registration.status === 'open') return 'Sestavte tým a zajistěte si místo u kvízového stolu.';
  return 'Přihlášení nových týmů je pro tuto akci uzavřené.';
}
