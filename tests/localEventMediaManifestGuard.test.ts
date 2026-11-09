import { createRequire } from 'node:module';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { readLocalEventMediaManifest } from '../functions/src/media/local-event-manifest';
import { readLocalEventMediaAuthorization, readLocalProjectorMediaAuthority } from '../functions/src/media/local-projector-media';
import { readLocalImageManifest, authorizeLocalImageBackup, readLocalImageAuthority } from '../functions/src/media/local-image-backup';
import { prepareOfflineEvent, readOfflineTrust, authorizeOfflineEvent } from '../functions/src/offline/prepare';
import { previewOfflineSync, commitOfflineSync } from '../functions/src/offline/sync';

const endpoints = [readLocalEventMediaManifest, readLocalEventMediaAuthorization, readLocalProjectorMediaAuthority, readLocalImageManifest, authorizeLocalImageBackup, readLocalImageAuthority,
  prepareOfflineEvent, readOfflineTrust, authorizeOfflineEvent, previewOfflineSync, commitOfflineSync];

const mocks = vi.hoisted(() => ({ freshIdentity: vi.fn() }));
vi.mock('../functions/src/access/authorization', () => ({ authorize: vi.fn(), freshIdentity: mocks.freshIdentity }));

const requireFromFunctions = createRequire(new URL('../functions/package.json', import.meta.url));
const adminApps = requireFromFunctions('firebase-admin/app') as {
  initializeApp(options: { projectId: string }): unknown;
  deleteApp(app: unknown): Promise<void>;
};

const projectId = 'demo-filmovy-kviz-v2';
const allowed = {
  FUNCTIONS_EMULATOR: 'true',
  GCLOUD_PROJECT: projectId,
  GOOGLE_CLOUD_PROJECT: projectId,
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199',
  STORAGE_EMULATOR_HOST: 'http://127.0.0.1:9199',
};
const request = {
  data: { eventId: 'synthetic-event' },
  auth: { uid: 'synthetic-member', token: {} },
} as Parameters<typeof readLocalEventMediaManifest.run>[0];

beforeEach(() => {
  vi.clearAllMocks();
  for (const [key, value] of Object.entries(allowed)) vi.stubEnv(key, value);
});

afterEach(() => vi.unstubAllEnvs());

it.each([
  ['FUNCTIONS_EMULATOR', 'false'],
  ['GCLOUD_PROJECT', 'not-the-demo-project'],
  ['GOOGLE_CLOUD_PROJECT', 'not-the-demo-project'],
  ['FIREBASE_AUTH_EMULATOR_HOST', undefined],
  ['FIRESTORE_EMULATOR_HOST', 'firestore.invalid:8080'],
  ['FIREBASE_STORAGE_EMULATOR_HOST', '127.0.0.1:65536'],
  ['STORAGE_EMULATOR_HOST', 'http://storage.invalid:9199'],
] as const)('refuses %s outside the demo boundary before checking identity', async (key, value) => {
  vi.stubEnv(key, value);
  for (const endpoint of endpoints) await expect(endpoint.run(request)).rejects.toMatchObject({ code: 'failed-precondition' });
  expect(mocks.freshIdentity).not.toHaveBeenCalled();
});

it('refuses a different initialized Admin project before checking identity', async () => {
  const app = adminApps.initializeApp({ projectId: 'demo-wrong-app-fixture' });
  try {
    for (const endpoint of endpoints) await expect(endpoint.run(request)).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(mocks.freshIdentity).not.toHaveBeenCalled();
  } finally {
    await adminApps.deleteApp(app);
  }
});
