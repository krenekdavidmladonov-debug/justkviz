import type { Permission } from '@filmovy-kviz/quiz-domain';

export const demoOfflineEnvironment = 'demo-filmovy-kviz-v2';
export const v2OfflineEnvironment = 'filmovy-kviz-v2-staging';
const v2OfflineOrigin = 'https://justkviz-v2.web.app';
export const offlineAudience = 'justkviz-offline-v1';
export const offlinePreparationPermissions = ['event.read', 'event.export', 'event.answers.read', 'event.answers.export',
  'event.notes.read', 'event.live', 'event.score', 'event.manage'] as const satisfies readonly Permission[];

export function offlineBrowserMode(env: ImportMetaEnv, location: Pick<Location, 'origin' | 'hostname'>) {
  if (env.VITE_FIREBASE_USE_EMULATORS === 'true' && env.VITE_FIREBASE_PROJECT_ID === demoOfflineEnvironment
    && ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)) return 'demo';
  if (env.MODE === 'staging' && env.VITE_FIREBASE_USE_EMULATORS === 'false' && env.VITE_FIREBASE_PROJECT_ID === v2OfflineEnvironment
    && location.origin === v2OfflineOrigin) {
    if (env.VITE_JUSTKVIZ_OFFLINE === 'true') return 'enabled';
    if (env.VITE_JUSTKVIZ_OFFLINE === 'recovery') return 'recovery';
  }
  return undefined;
}

export function currentOfflineMode() {
  return offlineBrowserMode(import.meta.env, window.location);
}

export function currentOfflineEnvironment() {
  const mode = currentOfflineMode();
  return mode === 'demo' ? demoOfflineEnvironment : mode ? v2OfflineEnvironment : undefined;
}
