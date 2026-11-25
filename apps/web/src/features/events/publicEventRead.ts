import { connectFirestoreEmulator, doc, getDoc, getFirestore, type Firestore } from 'firebase/firestore/lite';
import { getFirebaseAppContext } from '../../services/firebase/app';
import { emulatorEndpoint } from '../../services/firebase/emulatorEndpoint';
import { mapPublicEvent } from './eventMappers';
import type { PublicEventRecord } from './types';

let database: Firestore | undefined;

function publicDatabase() {
  if (!database) {
    const { app, config } = getFirebaseAppContext();
    const db = getFirestore(app);
    if (config.useEmulators) {
      const { host, port } = emulatorEndpoint(config.options.projectId, 'FIRESTORE');
      connectFirestoreEmulator(db, host, port);
    }
    database = db;
  }
  return database;
}

export async function getPublicEvent(eventId: string): Promise<PublicEventRecord | null> {
  try {
    const snapshot = await getDoc(doc(publicDatabase(), 'publicEvents', eventId));
    return snapshot.exists() && snapshot.data().registrationPublished === true ? mapPublicEvent(snapshot.id, snapshot.data()) : null;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'permission-denied') return null;
    throw error;
  }
}

export async function loadPublicEvent(eventId: string) {
  try {
    return { event: await getPublicEvent(eventId), failed: false };
  } catch {
    return { event: null, failed: true };
  }
}
