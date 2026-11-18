type EmulatorService = 'AUTH' | 'FIRESTORE' | 'FUNCTIONS' | 'STORAGE';
const defaults: Record<EmulatorService, number> = { AUTH: 9099, FIRESTORE: 8080, FUNCTIONS: 5001, STORAGE: 9199 };

/** Explicit local endpoints only; changing a browser port must never enable cloud tests. */
export function emulatorEndpoint(projectId: string | undefined, service: EmulatorService,
  environment: Record<string, unknown> = import.meta.env): { host: string; port: number; origin: string } {
  const host = environment.VITE_FIREBASE_EMULATOR_HOST ?? '127.0.0.1';
  const configured = environment['VITE_FIREBASE_' + service + '_EMULATOR_PORT'];
  const port = configured === undefined ? defaults[service] : Number(configured);
  if (!projectId?.startsWith('demo-') || typeof host !== 'string'
    || !['127.0.0.1', 'localhost', '[::1]'].includes(host)
    || !Number.isSafeInteger(port) || port < 1 || port > 65535
    || (configured !== undefined && (typeof configured !== 'string' || !/^[1-9]\d{0,4}$/u.test(configured)))) {
    throw new Error('Firebase emulators require a demo-* project and an explicit loopback endpoint.');
  }
  return { host, port, origin: 'http://' + host + ':' + port };
}
