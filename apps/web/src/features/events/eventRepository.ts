import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
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

export async function listPublicEvents(): Promise<readonly PublicEventRecord[]> {
  const snapshot = await getDocsFromServer(query(
    collection(getFirebaseFirestore(), 'publicEvents'),
    where('registrationPublished', '==', true),
  ));
  return snapshot.docs.map((item) => mapPublicEvent(item.id, item.data())).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

export async function getPublicEvent(eventId: string): Promise<PublicEventRecord | null> {
  try {
    const snapshot = await getDocFromServer(doc(getFirebaseFirestore(), 'publicEvents', eventId));
    return snapshot.exists() && snapshot.data().registrationPublished === true ? mapPublicEvent(snapshot.id, snapshot.data()) : null;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'permission-denied') return null;
    throw error;
  }
}

export async function listEventRegistrations(eventId: string): Promise<readonly RegistrationRecord[]> {
  const result = await privateRead<PrivateDocument[]>('registrations', { eventId });
  return result.map(item => mapRegistration(item.id, item.data)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}
