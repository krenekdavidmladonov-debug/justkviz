import { emulatorEndpoint } from './emulatorEndpoint';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';

import { getFirebaseAppContext } from './app';

let authService: Auth | undefined;

export function getFirebaseAuth(): Auth {
  if (authService) {
    return authService;
  }

  const { app, config } = getFirebaseAppContext();
  const auth = getAuth(app);

  if (config.useEmulators) {
    connectAuthEmulator(auth, emulatorEndpoint(config.options.projectId, 'AUTH').origin, { disableWarnings: true });
  }

  authService = auth;
  return authService;
}
