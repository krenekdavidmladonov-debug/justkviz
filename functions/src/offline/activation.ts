import { getApp } from 'firebase-admin/app';
import { HttpsError } from 'firebase-functions/v2/https';
import { requireDemoEmulators } from '../media/local-event-manifest.js';

export const offlineDemoProject = 'demo-filmovy-kviz-v2';
const cloudProject = 'filmovy-kviz-v2-staging';
const cloudOrigins = ['https://justkviz.cz', 'https://justkviz-v2.web.app'] as const;
const audience = 'justkviz-offline-v1';
const eventIdPattern = /^[A-Za-z0-9_-]{1,150}$/u;
const maximumEvents = 10;
const maximumEventListLength = maximumEvents * 151 - 1;
const cloudBuckets = new Set([cloudProject + '.appspot.com', cloudProject + '.firebasestorage.app']);

export interface OfflineScope {
  readonly environment: typeof offlineDemoProject | typeof cloudProject;
  readonly audience: typeof audience;
}

type OfflineAccess = 'issue' | 'authorize' | 'media' | 'sync';
type CloudActivation = {
  readonly mode: 'enabled' | 'recovery';
} & ({ readonly allEligibleEvents: true } | { readonly events: ReadonlySet<string> });

/** No cloud resources are consulted to decide if activation is available. */
export function offlineCloudActivation(env: NodeJS.ProcessEnv = process.env): CloudActivation | undefined {
  if (env.JUSTKVIZ_OFFLINE_ENABLED !== 'true'
    || (env.JUSTKVIZ_OFFLINE_RECOVERY_ONLY !== undefined && !['true', 'false'].includes(env.JUSTKVIZ_OFFLINE_RECOVERY_ONLY))
    || (env.FUNCTIONS_EMULATOR !== undefined && env.FUNCTIONS_EMULATOR !== 'false')
    || Object.keys(env).some(key => key.endsWith('_EMULATOR_HOST') && env[key] !== undefined)
    || env.FIREBASE_EMULATOR_HUB !== undefined || env.FIREBASE_EMULATOR_HUB_ORIGIN !== undefined) return undefined;
  const projects = [env.GCLOUD_PROJECT, env.GOOGLE_CLOUD_PROJECT].filter(project => project !== undefined);
  if (!projects.length || projects.some(project => project !== cloudProject)) return undefined;
  if (env.FIREBASE_CONFIG !== undefined) {
    try {
      const config = JSON.parse(env.FIREBASE_CONFIG) as { projectId?: unknown; storageBucket?: unknown } | null;
      if (config?.projectId !== cloudProject
        || (config.storageBucket !== undefined && (typeof config.storageBucket !== 'string' || !cloudBuckets.has(config.storageBucket)))) return undefined;
    } catch { return undefined; }
  }
  const mode = env.JUSTKVIZ_OFFLINE_RECOVERY_ONLY === 'true' ? 'recovery' : 'enabled';
  const allEligibleEvents = env.JUSTKVIZ_OFFLINE_ALL_ELIGIBLE_EVENTS;
  const configuredEvents = env.JUSTKVIZ_OFFLINE_EVENT_IDS;
  if (allEligibleEvents !== undefined) {
    return allEligibleEvents === 'true' && configuredEvents === undefined ? { mode, allEligibleEvents: true } : undefined;
  }
  if (!configuredEvents || configuredEvents.length > maximumEventListLength) return undefined;
  const ids = configuredEvents.split(',');
  const events = new Set(ids);
  if (ids.length > maximumEvents || events.size !== ids.length || ids.some(id => !eventIdPattern.test(id))) return undefined;
  return { mode, events };
}

export const offlineCors = process.env.FUNCTIONS_EMULATOR === 'true' ? true : [...cloudOrigins];

export function requireOfflineRuntime(eventId: string, origin: string | undefined, access: OfflineAccess): OfflineScope {
  if (process.env.FUNCTIONS_EMULATOR === 'true' && process.env.GCLOUD_PROJECT === offlineDemoProject) {
    requireDemoEmulators();
    return { environment: offlineDemoProject, audience };
  }
  const activation = offlineCloudActivation();
  if (!activation || !cloudOrigins.some(allowed => origin === allowed) || typeof eventId !== 'string' || !eventIdPattern.test(eventId)
    || ('events' in activation && !activation.events.has(eventId))
    || (activation.mode === 'recovery' && access !== 'sync')) throw offlineInactive();
  try {
    const { projectId, storageBucket } = getApp().options;
    if (projectId !== cloudProject
      || ((access === 'issue' || access === 'media') && (!storageBucket || !cloudBuckets.has(storageBucket)))) throw offlineInactive();
  } catch { throw offlineInactive(); }
  return { environment: cloudProject, audience };
}

export function requireOfflineMedia(eventId: string, origin: string | undefined): OfflineScope['environment'] {
  return requireOfflineRuntime(eventId, origin, 'media').environment;
}

const offlineInactive = () => new HttpsError('failed-precondition', 'Offline režim není pro tuto akci dostupný.');
