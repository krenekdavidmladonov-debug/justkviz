import type { Permission } from '@filmovy-kviz/quiz-domain';
import { currentOfflineMode, offlinePreparationPermissions } from './offlineAvailability';

export function OfflinePreparationLink({ eventId, can }: {
  eventId: string;
  can: (permission: Permission) => boolean;
}) {
  const mode = currentOfflineMode();
  if ((mode !== 'demo' && mode !== 'enabled') || !offlinePreparationPermissions.every(can)) return null;
  return <section className="event-section">
    <h2>Kvíz bez připojení</h2>
    <p>Zašifrovaná kopie celého večera včetně médií, bodování a pozdější synchronizace.</p>
    <a className="secondary-link" href={`/offline.html#/prepare?eventId=${encodeURIComponent(eventId)}`}>Připravit offline kvíz</a>
  </section>;
}
