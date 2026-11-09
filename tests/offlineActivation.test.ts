import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canonicalOfflineJson, type OfflineGrantPayload } from '../packages/quiz-domain/src/offline-event';
import { offlineBrowserMode } from '../apps/web/src/features/offline/offlineAvailability';
import { offlineCloudActivation, requireOfflineMedia, requireOfflineRuntime } from '../functions/src/offline/activation';
import type { readOfflineTrust } from '../functions/src/offline/prepare';

const sdk = vi.hoisted(() => ({ app: vi.fn(), auth: vi.fn(), firestore: vi.fn(), storage: vi.fn() }));
vi.mock('../functions/node_modules/firebase-admin/lib/esm/app/index.js', () => ({ getApp: sdk.app }));
vi.mock('../functions/node_modules/firebase-admin/lib/esm/auth/index.js', () => ({ getAuth: sdk.auth }));
vi.mock('../functions/node_modules/firebase-admin/lib/esm/firestore/index.js', async () => ({
  ...await import('../functions/node_modules/firebase-admin/lib/firestore/index.js'), getFirestore: sdk.firestore,
}));
vi.mock('../functions/node_modules/firebase-admin/lib/esm/storage/index.js', () => ({ getStorage: sdk.storage }));

const project = 'filmovy-kviz-v2-staging';
const origin = 'https://justkviz-v2.web.app';
const trustedOrigins = ['https://justkviz.cz', origin];
const untrustedOrigins = ['null', 'http://justkviz.cz', 'http://justkviz-v2.web.app', 'https://www.justkviz.cz',
  'https://justkviz.cz/', 'https://justkviz.cz:444', 'https://justkviz.cz.example.test', 'https://user@justkviz.cz',
  'https://filmovy-kviz-v2-staging.web.app', 'https://justkviz-v2--preview.web.app', origin + '/',
  origin + '.example.test', origin + ':444', 'https://user@justkviz-v2.web.app'];
const demoProject = 'demo-filmovy-kviz-v2';
const eventId = 'synthetic-event';
const cloudEnv = { GCLOUD_PROJECT: project, JUSTKVIZ_OFFLINE_ENABLED: 'true', JUSTKVIZ_OFFLINE_EVENT_IDS: eventId + ',other-event' };
const globalEnv = { GCLOUD_PROJECT: project, JUSTKVIZ_OFFLINE_ENABLED: 'true', JUSTKVIZ_OFFLINE_ALL_ELIGIBLE_EVENTS: 'true' };
const demoEnv = {
  GCLOUD_PROJECT: demoProject, FUNCTIONS_EMULATOR: 'true', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199',
  STORAGE_EMULATOR_HOST: 'http://127.0.0.1:9199',
};
const environmentKeys = [...Object.keys(cloudEnv), ...Object.keys(globalEnv), ...Object.keys(demoEnv), 'GOOGLE_CLOUD_PROJECT', 'FIREBASE_CONFIG',
  'FIREBASE_EMULATOR_HUB', 'FIREBASE_EMULATOR_HUB_ORIGIN', 'JUSTKVIZ_OFFLINE_RECOVERY_ONLY', 'JUSTKVIZ_OFFLINE_SIGNING_KEY'];
const auth = { uid: 'synthetic-staff', token: { email_verified: true, auth_time: 50 } };
const request = (data: unknown, requestOrigin: string | null = origin): Parameters<typeof readOfflineTrust.run>[0] => ({
  data, auth, rawRequest: { get: () => requestOrigin ?? undefined }, acceptsStreaming: false,
}) as unknown as Parameters<typeof readOfflineTrust.run>[0];
const privatePem = (namedCurve = 'prime256v1') => generateKeyPairSync('ec', { namedCurve }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const scope = { environment: project, audience: 'justkviz-offline-v1' } as const;
const payload: OfflineGrantPayload = { schemaVersion: 1, ...scope, eventId, exportId: 'synthetic-export', sessionId: 'synthetic-session',
  snapshotId: 'synthetic-snapshot', manifestDigest: 'a'.repeat(64), issuedAtMs: 100, expiresAtMs: 200 };
const failed = { code: 'failed-precondition' };

function installEnv(values: NodeJS.ProcessEnv): void {
  const emulatorKeys = Object.keys(process.env).filter(name => name.endsWith('_EMULATOR_HOST'));
  for (const key of new Set([...environmentKeys, ...emulatorKeys, ...Object.keys(values)])) vi.stubEnv(key, values[key]);
}

function expectNoPrivilegedIo(): void {
  expect(sdk.auth).not.toHaveBeenCalled();
  expect(sdk.firestore).not.toHaveBeenCalled();
  expect(sdk.storage).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  installEnv({});
  sdk.app.mockReturnValue({ options: { projectId: project, storageBucket: project + '.appspot.com' } });
});
afterEach(() => vi.unstubAllEnvs());

describe('offline V2 activation', () => {
  it('requires the exact project, explicit activation, and an unambiguous bounded event allowlist', () => {
    expect(offlineCloudActivation({})).toBeUndefined();
    expect(offlineCloudActivation(cloudEnv)).toEqual({ mode: 'enabled', events: new Set([eventId, 'other-event']) });
    expect(offlineCloudActivation({ ...cloudEnv, JUSTKVIZ_OFFLINE_RECOVERY_ONLY: 'true' })?.mode).toBe('recovery');
    for (const patch of [
      { JUSTKVIZ_OFFLINE_ENABLED: undefined }, { JUSTKVIZ_OFFLINE_ENABLED: 'TRUE' }, { JUSTKVIZ_OFFLINE_RECOVERY_ONLY: '1' },
      { JUSTKVIZ_OFFLINE_EVENT_IDS: undefined }, { JUSTKVIZ_OFFLINE_EVENT_IDS: ' ' }, { JUSTKVIZ_OFFLINE_EVENT_IDS: '*' },
      { JUSTKVIZ_OFFLINE_EVENT_IDS: eventId + ', ' + eventId }, { JUSTKVIZ_OFFLINE_EVENT_IDS: eventId + ',' + eventId },
      { JUSTKVIZ_OFFLINE_EVENT_IDS: '../other' }, { JUSTKVIZ_OFFLINE_EVENT_IDS: 'x'.repeat(151) },
      { JUSTKVIZ_OFFLINE_EVENT_IDS: Array.from({ length: 11 }, (_, i) => 'event-' + i).join(',') },
      { GCLOUD_PROJECT: undefined }, { GCLOUD_PROJECT: demoProject }, { GCLOUD_PROJECT: 'other-live-project' },
      { GOOGLE_CLOUD_PROJECT: 'other-live-project' }, { FIREBASE_CONFIG: '{' }, { FIREBASE_CONFIG: 'null' },
      { FIREBASE_CONFIG: JSON.stringify({ projectId: 'other-live-project' }) },
      { FIREBASE_CONFIG: JSON.stringify({ projectId: project, storageBucket: 'other-project.appspot.com' }) },
      { FUNCTIONS_EMULATOR: 'true' }, { FUNCTIONS_EMULATOR: '' }, { FIREBASE_AUTH_EMULATOR_HOST: 'localhost:9099' },
      { FIRESTORE_EMULATOR_HOST: 'localhost:8080' }, { FIREBASE_STORAGE_EMULATOR_HOST: 'localhost:9199' },
      { STORAGE_EMULATOR_HOST: 'http://localhost:9199' }, { DATABASE_EMULATOR_HOST: '' }, { FIREBASE_EMULATOR_HUB: 'localhost:4400' },
    ]) expect(offlineCloudActivation({ ...cloudEnv, ...patch })).toBeUndefined();
    expect(offlineCloudActivation({ ...cloudEnv, GOOGLE_CLOUD_PROJECT: project, FUNCTIONS_EMULATOR: 'false',
      FIREBASE_CONFIG: JSON.stringify({ projectId: project, storageBucket: project + '.firebasestorage.app' }) })?.mode).toBe('enabled');
    expectNoPrivilegedIo();
  });

  it('enables all eligible events only under the explicit global configuration', () => {
    expect(offlineCloudActivation(globalEnv)).toEqual({ mode: 'enabled', allEligibleEvents: true });
    expect(offlineCloudActivation({ ...globalEnv, JUSTKVIZ_OFFLINE_ENABLED: undefined })).toBeUndefined();
    expect(offlineCloudActivation({ ...globalEnv, FIRESTORE_EMULATOR_HOST: 'localhost:8080' })).toBeUndefined();
    for (const list of ['', eventId, '*']) {
      expect(offlineCloudActivation({ ...globalEnv, JUSTKVIZ_OFFLINE_EVENT_IDS: list })).toBeUndefined();
    }
    for (const flag of ['', 'false', 'TRUE', '1']) {
      expect(offlineCloudActivation({ ...globalEnv, JUSTKVIZ_OFFLINE_ALL_ELIGIBLE_EVENTS: flag })).toBeUndefined();
      expect(offlineCloudActivation({ ...cloudEnv, JUSTKVIZ_OFFLINE_ALL_ELIGIBLE_EVENTS: flag })).toBeUndefined();
    }

    installEnv(globalEnv);
    for (const id of [eventId, 'another-eligible-event']) {
      expect(requireOfflineRuntime(id, origin, 'issue')).toEqual(scope);
      expect(requireOfflineMedia(id, origin)).toBe(project);
    }
    sdk.app.mockClear();
    for (const id of ['', '*', '../event', 'x'.repeat(151)]) {
      expect(() => requireOfflineMedia(id, origin)).toThrow(expect.objectContaining(failed));
    }
    expect(() => requireOfflineMedia(eventId, 'https://www.justkviz.cz')).toThrow(expect.objectContaining(failed));
    expect(sdk.app).not.toHaveBeenCalled();
    expectNoPrivilegedIo();
  });

  it('requires a signed-in actor with current event scope even under global activation', async () => {
    installEnv({ ...globalEnv, JUSTKVIZ_OFFLINE_SIGNING_KEY: privatePem() });
    const { prepareOfflineEvent } = await import('../functions/src/offline/prepare');
    const { offlinePermissions } = await import('../functions/src/offline/source');
    expect(prepareOfflineEvent.__endpoint.secretEnvironmentVariables).toEqual([{ key: 'JUSTKVIZ_OFFLINE_SIGNING_KEY' }]);
    const input = request({ eventId, requestId: 'synthetic-request' });
    await expect(prepareOfflineEvent.run({ ...input, auth: undefined })).rejects.toMatchObject({ code: 'unauthenticated' });
    expectNoPrivilegedIo();

    const member = { uid: auth.uid, status: 'active', version: 1, sessionValidAfter: 0,
      permissions: offlinePermissions, events: { mode: 'selected', ids: ['another-event'] } };
    const transaction = { get: vi.fn().mockResolvedValue({ data: () => member }) };
    sdk.auth.mockReturnValue({ getUser: vi.fn().mockResolvedValue({ uid: auth.uid, emailVerified: true }) });
    sdk.firestore.mockReturnValue({ doc: (path: string) => path,
      runTransaction: (action: (tx: typeof transaction) => Promise<unknown>) => action(transaction) });
    await expect(prepareOfflineEvent.run(input)).rejects.toMatchObject({ code: 'permission-denied' });
    expect(transaction.get).toHaveBeenCalledExactlyOnceWith('memberships/' + auth.uid);
    expect(sdk.storage).not.toHaveBeenCalled();
  });

  it('uses only the two approved browser origins for cloud CORS and the runtime gate', async () => {
    installEnv(cloudEnv);
    const { offlineCors } = await import('../functions/src/offline/activation');
    expect(offlineCors).toEqual(trustedOrigins);
    for (const trustedOrigin of trustedOrigins) {
      expect(requireOfflineRuntime(eventId, trustedOrigin, 'issue')).toEqual(scope);
      expect(requireOfflineMedia(eventId, trustedOrigin)).toBe(project);
    }
    for (const wrongOrigin of [undefined, ...untrustedOrigins]) {
      expect(() => requireOfflineMedia(eventId, wrongOrigin)).toThrow(expect.objectContaining(failed));
    }
    expect(() => requireOfflineMedia('different-event', origin)).toThrow(expect.objectContaining(failed));
    sdk.app.mockReturnValue({ options: { projectId: project, storageBucket: 'different.appspot.com' } });
    expect(() => requireOfflineMedia(eventId, origin)).toThrow(expect.objectContaining(failed));
    sdk.app.mockReturnValue({ options: { projectId: demoProject, storageBucket: project + '.appspot.com' } });
    expect(() => requireOfflineRuntime(eventId, origin, 'sync')).toThrow(expect.objectContaining(failed));
    expectNoPrivilegedIo();
  });

  it('enables the browser only at the two exact V2 origins with the selected release mode', () => {
    const config = { mode: 'staging', projectId: project, useEmulators: 'false', release: 'true' };
    const location = (value: string) => ({ origin: value, hostname: value });
    for (const trustedOrigin of trustedOrigins) {
      expect(offlineBrowserMode(config, location(trustedOrigin))).toBe('enabled');
      expect(offlineBrowserMode({ ...config, release: 'recovery' }, location(trustedOrigin))).toBe('recovery');
      expect(offlineBrowserMode({ ...config, release: undefined }, location(trustedOrigin))).toBeUndefined();
    }
    for (const wrongOrigin of untrustedOrigins) {
      expect(offlineBrowserMode(config, location(wrongOrigin))).toBeUndefined();
    }
  });

  it('preserves strict loopback demo operation without access to the cloud signer', async () => {
    installEnv({ ...demoEnv, JUSTKVIZ_OFFLINE_SIGNING_KEY: privatePem() });
    sdk.app.mockReturnValue({ options: { projectId: demoProject } });
    const demoScope = requireOfflineRuntime(eventId, undefined, 'issue');
    const { offlineCors } = await import('../functions/src/offline/activation');
    const { cloudOfflineSigner, offlineSigningSecrets } = await import('../functions/src/offline/signing');
    expect(offlineCors).toBe(true);
    expect(demoScope.environment).toBe(demoProject);
    expect(cloudOfflineSigner(demoScope)).toBeUndefined();
    expect(offlineSigningSecrets).toEqual([]);
    vi.stubEnv('STORAGE_EMULATOR_HOST', 'http://storage.example.test:9199');
    expect(() => requireOfflineMedia(eventId, undefined)).toThrow(expect.objectContaining(failed));
    expectNoPrivilegedIo();
  });

  it('keeps all five callable handlers dormant by default and never binds a secret', async () => {
    installEnv({ GCLOUD_PROJECT: project, JUSTKVIZ_OFFLINE_SIGNING_KEY: privatePem() });
    const { readOfflineTrust, prepareOfflineEvent, authorizeOfflineEvent } = await import('../functions/src/offline/prepare');
    const { previewOfflineSync, commitOfflineSync } = await import('../functions/src/offline/sync');
    for (const callable of [readOfflineTrust, prepareOfflineEvent, authorizeOfflineEvent, previewOfflineSync, commitOfflineSync]) {
      expect(callable.__endpoint.secretEnvironmentVariables ?? []).toEqual([]);
    }
    await expect(readOfflineTrust.run(request({ eventId }))).rejects.toMatchObject(failed);
    await expect(prepareOfflineEvent.run(request({ eventId, requestId: 'request' }))).rejects.toMatchObject(failed);
    await expect(authorizeOfflineEvent.run(request({ eventId, exportId: payload.exportId, manifestDigest: payload.manifestDigest }))).rejects.toMatchObject(failed);
    await expect(previewOfflineSync.run(request({ eventId }))).rejects.toMatchObject(failed);
    await expect(commitOfflineSync.run(request({ eventId }))).rejects.toMatchObject(failed);
    expect(sdk.app).not.toHaveBeenCalled();
    expectNoPrivilegedIo();
  });

  it.each([{ policy: 'pilot', env: cloudEnv }, { policy: 'global', env: globalEnv }])(
    'keeps only preview and commit reachable in $policy recovery mode without signer access', async ({ policy, env }) => {
      installEnv({ ...env, JUSTKVIZ_OFFLINE_RECOVERY_ONLY: 'true' });
      const { readOfflineTrust, prepareOfflineEvent, authorizeOfflineEvent } = await import('../functions/src/offline/prepare');
      const { previewOfflineSync, commitOfflineSync } = await import('../functions/src/offline/sync');
      for (const callable of [readOfflineTrust, prepareOfflineEvent, authorizeOfflineEvent, previewOfflineSync, commitOfflineSync]) {
        expect(callable.__endpoint.secretEnvironmentVariables ?? []).toEqual([]);
      }
      await expect(readOfflineTrust.run(request({ eventId }))).rejects.toMatchObject(failed);
      await expect(prepareOfflineEvent.run(request({ eventId, requestId: 'request' }))).rejects.toMatchObject(failed);
      await expect(authorizeOfflineEvent.run(request({ eventId, exportId: payload.exportId, manifestDigest: payload.manifestDigest }))).rejects.toMatchObject(failed);
      expect(() => requireOfflineMedia(eventId, origin)).toThrow(expect.objectContaining(failed));
      expect(requireOfflineRuntime(eventId, origin, 'sync')).toEqual(scope);
      for (const callable of [previewOfflineSync, commitOfflineSync]) {
        await expect(callable.run(request({ eventId, exportId: payload.exportId, operations: 'invalid' }))).rejects.toMatchObject({ code: 'invalid-argument' });
        await expect(callable.run(request({ eventId: 'different-event' }))).rejects.toMatchObject(
          policy === 'pilot' ? failed : { code: 'invalid-argument' },
        );
        await expect(callable.run(request({ eventId }, null))).rejects.toMatchObject(failed);
      }
      expectNoPrivilegedIo();
    },
  );

  it('binds only issuance to a valid private PKCS8 P-256 key and validates it before privileged I/O', async () => {
    const pem = privatePem();
    installEnv({ ...cloudEnv, JUSTKVIZ_OFFLINE_SIGNING_KEY: pem });
    const { readOfflineTrust, prepareOfflineEvent, authorizeOfflineEvent } = await import('../functions/src/offline/prepare');
    const { previewOfflineSync, commitOfflineSync } = await import('../functions/src/offline/sync');
    const { cloudOfflineSigner, signOfflineGrant } = await import('../functions/src/offline/signing');
    for (const callable of [readOfflineTrust, prepareOfflineEvent]) {
      expect(callable.__endpoint.secretEnvironmentVariables).toEqual([{ key: 'JUSTKVIZ_OFFLINE_SIGNING_KEY' }]);
    }
    for (const callable of [authorizeOfflineEvent, previewOfflineSync, commitOfflineSync]) {
      expect(callable.__endpoint.secretEnvironmentVariables ?? []).toEqual([]);
    }
    const signer = cloudOfflineSigner(scope)!;
    const trust = signer.trust;
    expect(trust).toMatchObject(scope);
    expect(trust.publicJwk).not.toHaveProperty('d');
    const grant = signOfflineGrant(payload, signer);
    expect(grant.keyId).toBe(trust.keyId);
    expect(verify('sha256', Buffer.from(canonicalOfflineJson(payload)), {
      key: createPublicKey({ key: trust.publicJwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363',
    }, Buffer.from(grant.signature, 'base64url'))).toBe(true);
    expect(() => signOfflineGrant({ ...payload, environment: demoProject }, signer)).toThrow(expect.objectContaining(failed));
    for (const invalid of [undefined, 'invalid', pem + pem, privatePem('secp384r1'),
      createPublicKey(pem).export({ type: 'spki', format: 'pem' }).toString()]) {
      vi.stubEnv('JUSTKVIZ_OFFLINE_SIGNING_KEY', invalid);
      await expect(readOfflineTrust.run(request({ eventId }))).rejects.toMatchObject(failed);
      await expect(prepareOfflineEvent.run(request({ eventId, requestId: 'request' }))).rejects.toMatchObject(failed);
    }
    expectNoPrivilegedIo();
  });

  it('rejects server-owned export envelopes with a foreign environment even when a receipt exists', async () => {
    installEnv({ ...cloudEnv, JUSTKVIZ_OFFLINE_SIGNING_KEY: privatePem() });
    const { cloudOfflineSigner, signOfflineGrant } = await import('../functions/src/offline/signing');
    const { assertOfflineExportContext } = await import('../functions/src/offline/source');
    const grant = signOfflineGrant(payload, cloudOfflineSigner(scope)!);
    const record = { ...payload, grant, manifestSeed: { ...scope, event: { id: eventId } }, receipt: { replayed: false } };
    expect(() => assertOfflineExportContext(record, scope, eventId)).not.toThrow();
    expect(() => assertOfflineExportContext(record, { ...scope, environment: demoProject }, eventId)).toThrow(expect.objectContaining(failed));
    expect(() => assertOfflineExportContext(record, scope, 'other-event')).toThrow(expect.objectContaining(failed));
    expect(() => assertOfflineExportContext({ ...record, grant: { ...grant, payload: { ...payload, snapshotId: 'different' } } }, scope, eventId))
      .toThrow(expect.objectContaining(failed));
    expectNoPrivilegedIo();
  });

  it('rejects a foreign stored receipt through preview and commit before snapshot reads or writes', async () => {
    installEnv({ ...cloudEnv, JUSTKVIZ_OFFLINE_RECOVERY_ONLY: 'true' });
    const { previewOfflineSync, commitOfflineSync } = await import('../functions/src/offline/sync');
    const { offlinePermissions } = await import('../functions/src/offline/source');
    const member = { uid: auth.uid, status: 'active', version: 4, sessionValidAfter: 0,
      permissions: offlinePermissions, events: { mode: 'selected', ids: [eventId] } };
    const record = { ...payload, actorId: member.uid, membershipVersion: member.version,
      manifestSeed: { environment: demoProject }, receipt: { replayed: false } };
    const transaction = {
      get: vi.fn().mockResolvedValue({ data: () => member }),
      getAll: vi.fn().mockResolvedValue([{ data: () => ({ lifecycleStatus: 'completed' }) }, { data: () => record }]),
      set: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(),
    };
    const doc = vi.fn((path: string) => path);
    sdk.firestore.mockReturnValue({ doc, runTransaction: (action: (tx: typeof transaction) => Promise<unknown>) => action(transaction) });
    sdk.auth.mockReturnValue({ getUser: vi.fn().mockResolvedValue({ uid: auth.uid, emailVerified: true }) });
    const operations = [{ type: 'start', payload: {}, operationId: 'synthetic-op', sequence: 1,
      observedAtMs: 150, previousHash: '0'.repeat(64), hash: 'a'.repeat(64) }];
    const input = { eventId, exportId: payload.exportId, operations };
    await expect(previewOfflineSync.run(request(input))).rejects.toMatchObject(failed);
    await expect(commitOfflineSync.run(request({ ...input, previewDigest: 'a'.repeat(64) }))).rejects.toMatchObject(failed);
    expect(transaction.getAll).toHaveBeenCalledTimes(2);
    expect(doc.mock.calls.flat()).toEqual([
      'memberships/' + auth.uid, 'events/' + eventId, 'events/' + eventId + '/offlineExports/' + payload.exportId,
      'memberships/' + auth.uid, 'events/' + eventId, 'events/' + eventId + '/offlineExports/' + payload.exportId,
    ]);
    for (const write of [transaction.set, transaction.create, transaction.update, transaction.delete]) expect(write).not.toHaveBeenCalled();
  });
});
