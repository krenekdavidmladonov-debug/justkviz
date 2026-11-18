import { emulatorEndpoint } from './emulatorEndpoint';
import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, type Functions } from 'firebase/functions';
import { connectStorageEmulator, getStorage, type FirebaseStorage } from 'firebase/storage';

import { getFirebaseAppContext } from './app';
import { getFirebaseAuth } from './auth';
import { getFirebaseFirestore } from './firestore';

export interface FirebaseServices {
  readonly auth: Auth;
  readonly db: Firestore;
  readonly functions: Functions;
  readonly storage: FirebaseStorage;
}

let services: FirebaseServices | undefined;

export function getFirebaseServices(): FirebaseServices {
  if (services) {
    return services;
  }

  const { app, config } = getFirebaseAppContext();
  const auth = getFirebaseAuth();
  const db = getFirebaseFirestore();
  const functions = getFunctions(app, 'europe-west1');
  const storage = getStorage(app);

  if (config.useEmulators) {
    const functionsEndpoint = emulatorEndpoint(config.options.projectId, 'FUNCTIONS');
    connectFunctionsEmulator(functions, functionsEndpoint.host, functionsEndpoint.port);
    const storageEndpoint = emulatorEndpoint(config.options.projectId, 'STORAGE');
    connectStorageEmulator(storage, storageEndpoint.host, storageEndpoint.port);
  }

  services = { auth, db, functions, storage };
  return services;
}
