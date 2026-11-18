import { emulatorEndpoint } from './emulatorEndpoint';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';

import { getFirebaseAppContext } from './app';

let firestoreService: Firestore | undefined;

export function getFirebaseFirestore(): Firestore {
  if (firestoreService) {
    return firestoreService;
  }

  const { app, config } = getFirebaseAppContext();
  const db = getFirestore(app);

  if (config.useEmulators) {
    const endpoint = emulatorEndpoint(config.options.projectId, 'FIRESTORE');
    connectFirestoreEmulator(db, endpoint.host, endpoint.port);
  }

  firestoreService = db;
  return firestoreService;
}
