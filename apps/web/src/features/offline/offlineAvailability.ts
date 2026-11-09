import type { Permission } from '@filmovy-kviz/quiz-domain';

export const demoOfflineEnvironment = 'demo-filmovy-kviz-v2';
export const v2OfflineEnvironment = 'filmovy-kviz-v2-staging';
const v2OfflineOrigin = 'https://justkviz-v2.web.app';
export const offlineAudience = 'justkviz-offline-v1';
export const offlinePreparationPermissions = ['event.read', 'event.export', 'event.answers.read', 'event.answers.export',
  'event.notes.read', 'event.live', 'event.score', 'event.manage'] as const satisfies readonly Permission[];

interface OfflineBrowserConfig {
  readonly mode: string;
  readonly projectId: string | undefined;
  readonly useEmulators: string | undefined;
  readonly release: string | undefined;
}

export function offlineBrowserMode(config: OfflineBrowserConfig, location: Pick<Location, 'origin' | 'hostname'>) {
  if (config.useEmulators === 'true' && config.projectId === demoOfflineEnvironment
    && ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)) return 'demo';
  if (config.mode === 'staging' && config.useEmulators === 'false' && config.projectId === v2OfflineEnvironment
    && location.origin === v2OfflineOrigin) {
    if (config.release === 'true') return 'enabled';
    if (config.release === 'recovery') return 'recovery';
  }
  return undefined;
}

export function currentOfflineMode() {
  return offlineBrowserMode({ mode: import.meta.env.MODE, projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    useEmulators: import.meta.env.VITE_FIREBASE_USE_EMULATORS, release: import.meta.env.VITE_JUSTKVIZ_OFFLINE }, window.location);
}

export function currentOfflineEnvironment() {
  const mode = currentOfflineMode();
  return mode === 'demo' ? demoOfflineEnvironment : mode ? v2OfflineEnvironment : undefined;
}
