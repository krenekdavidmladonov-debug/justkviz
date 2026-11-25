import {
  collection,
  getDocsFromServer,
  onSnapshot,
  where,
  query,
} from 'firebase/firestore';

import { getFirebaseFirestore } from '../../services/firebase/firestore';
import { privateRead, type PrivateDocument } from '../access/api';
import { mapEvent, mapPublicEvent, mapRegistration } from './eventMappers';
import type { EventRecord, PublicEventRecord, RegistrationRecord } from './types';

export async function listEvents(): Promise<readonly EventRecord[]> {
  const result: PrivateDocument[] = []; let afterId: string | null = null;
  do {
    const page: { items: PrivateDocument[]; nextCursor: string | null } = await privateRead('eventPage', afterId ? { afterId } : {});
    result.push(...page.items); afterId = page.nextCursor;
  } while (afterId);
  return result.map(item => mapEvent(item.id, item.data)).sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
}

export async function getEvent(eventId: string): Promise<EventRecord | null> {
  const result = await privateRead<PrivateDocument>('event', { eventId });
  return mapEvent(result.id, result.data);
}

function publicEventsQuery() {
  return query(
    collection(getFirebaseFirestore(), 'publicEvents'),
    where('registrationPublished', '==', true),
  );
}

export async function listPublicEvents(): Promise<readonly PublicEventRecord[]> {
  const snapshot = await getDocsFromServer(publicEventsQuery());
  return snapshot.docs.map((item) => mapPublicEvent(item.id, item.data())).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

export function subscribePublishedEvents(onChange: (events: readonly PublicEventRecord[] | null) => void) {
  return onSnapshot(publicEventsQuery(), { includeMetadataChanges: true }, (snapshot) => {
    if (snapshot.metadata.fromCache) {
      onChange(null);
      return;
    }
    const events = snapshot.docs.flatMap(item => {
      try { return [mapPublicEvent(item.id, item.data())]; }
      catch { return []; }
    });
    onChange(events);
  }, () => onChange(null));
}

export async function listEventRegistrations(eventId: string): Promise<readonly RegistrationRecord[]> {
  const result = await privateRead<PrivateDocument[]>('registrations', { eventId });
  return result.map(item => mapRegistration(item.id, item.data)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}
