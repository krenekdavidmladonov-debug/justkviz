import type { FirebaseOptions } from 'firebase/app';

export interface FirebaseRuntimeConfig {
  readonly options: FirebaseOptions;
  readonly useEmulators: boolean;
}

export function readFirebaseConfig(): FirebaseRuntimeConfig {
  const publicEnv = {
    VITE_FIREBASE_API_KEY: import.meta.env.VITE_FIREBASE_API_KEY,
    VITE_FIREBASE_AUTH_DOMAIN: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    VITE_FIREBASE_PROJECT_ID: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    VITE_FIREBASE_STORAGE_BUCKET: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    VITE_FIREBASE_MESSAGING_SENDER_ID: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    VITE_FIREBASE_APP_ID: import.meta.env.VITE_FIREBASE_APP_ID,
  };
  const missingKeys = Object.keys(publicEnv).filter(key => !publicEnv[key as keyof typeof publicEnv]);

  if (missingKeys.length > 0) {
    throw new Error(`Firebase is not configured. Missing: ${missingKeys.join(', ')}`);
  }

  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
  const allowNonDemoProject = import.meta.env.VITE_FIREBASE_ALLOW_NON_DEMO_PROJECT === 'true';
  const useEmulators = import.meta.env.VITE_FIREBASE_USE_EMULATORS === 'true';

  if (!useEmulators && (import.meta.env.VITE_APP_ENV !== 'staging' || projectId !== 'filmovy-kviz-v2-staging' ||
      import.meta.env.VITE_FIREBASE_AUTH_DOMAIN !== 'filmovy-kviz-v2-staging.firebaseapp.com' ||
      import.meta.env.VITE_FIREBASE_APP_ID !== '1:177615774316:web:91aafb858b7cf61a7bee49')) {
    throw new Error('Cloud access is restricted to the explicitly configured V2 staging environment.');
  }

  if (!projectId) {
    throw new Error('Firebase project ID is missing.');
  }

  if (!projectId.startsWith('demo-') && !allowNonDemoProject) {
    throw new Error(
      'Refusing to initialize a non-demo Firebase project. Set VITE_FIREBASE_ALLOW_NON_DEMO_PROJECT=true only for an explicitly approved environment.',
    );
  }

  if (import.meta.env.DEV && !useEmulators) {
    throw new Error('Local development requires VITE_FIREBASE_USE_EMULATORS=true.');
  }

  if (useEmulators && !projectId.startsWith('demo-')) {
    throw new Error('Firebase emulators require a demo-* project ID.');
  }

  return {
    options: {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId,
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
    },
    useEmulators,
  };
}
