import { afterAll, beforeEach, expect, test, vi } from 'vitest';
import type { Membership } from '../packages/quiz-domain/src/index';

interface User { uid: string; emailVerified: boolean; disabled: boolean; tokensValidAfterTime?: string }
interface Fixture {
  records: Record<string, Record<string, unknown>>;
  user: User | undefined;
  writes: string[];
  beforeTransaction?: () => void;
}
const fixture = vi.hoisted((): Fixture => ({ records: {}, user: undefined, writes: [] }));
type Ref = { path: string; get: () => Promise<{ data: () => Record<string, unknown> | undefined }> };
function document(path: string): Ref { return { path, get: () => Promise.resolve({ data: () => fixture.records[path] }) }; }
const database = {
  doc: document,
  collection: (path: string) => ({ doc: () => document(path + '/synthetic-audit') }),
  async runTransaction<T>(handler: (tx: unknown) => Promise<T>): Promise<T> {
    fixture.beforeTransaction?.();
    const pending: [string, Record<string, unknown>][] = [];
    const write = (ref: Ref, value: Record<string, unknown>) => { pending.push([ref.path, value]); };
    const result = await handler({ get: (ref: Ref) => ref.get(), set: write, create: write });
    for (const [path, value] of pending) { fixture.records[path] = value; fixture.writes.push(path); }
    return result;
  },
};
vi.mock('../functions/node_modules/firebase-admin/lib/esm/firestore/index.js', async () => ({
  Timestamp: (await import('firebase/firestore')).Timestamp, getFirestore: () => database,
}));
vi.mock('../functions/node_modules/firebase-admin/lib/esm/auth/index.js', () => ({ getAuth: () => ({ getUser: () =>
  fixture.user ? Promise.resolve(fixture.user) : Promise.reject(new Error('Synthetic missing identity')) }) }));

// Invoke the real exported callable handlers and real authorization functions.
// Only Firebase storage/Auth and Google fetch are replaced with offline fixtures.
vi.stubEnv('DRIVE_CONNECTION_ENABLED', undefined);
const callables = await import('../functions/src/drive/callables');
const endpoints = [
  { name: 'readDriveConnection', target: callables.readDriveConnection, data: {} },
  { name: 'beginDriveConnection', target: callables.beginDriveConnection, data: {} },
  { name: 'completeDriveConnection', target: callables.completeDriveConnection, data: { code: 'synthetic-code', state: 'a'.repeat(43) } },
  { name: 'getDriveFolderPicker', target: callables.getDriveFolderPicker, data: {} },
  { name: 'selectDriveFolder', target: callables.selectDriveFolder, data: { folderId: 'private_folder' } },
  { name: 'createDriveMediaFolder', target: callables.createDriveMediaFolder, data: {} },
  { name: 'disconnectDriveConnection', target: callables.disconnectDriveConnection, data: {} },
];
const googleFetch = vi.fn<typeof fetch>(() => Promise.reject(new Error('Unexpected Google IO')));
type Auth = { uid: string; token: { email_verified: boolean; auth_time: number; role: string } } | undefined;
let auth: Auth;
function owner(patch: Partial<Membership> = {}): void {
  const member: Membership = { uid: 'owner', status: 'active', role: 'owner', permissions: ['users.manage', 'quiz.media.upload'],
    version: 1, sessionValidAfter: 0, displayName: 'Synthetic owner', email: 'owner@gmail.com',
    quizzes: { mode: 'all', ids: [] }, events: { mode: 'all', ids: [] }, ...patch };
  fixture.records['memberships/owner'] = member as unknown as Record<string, unknown>;
}
function reset(): void {
  fixture.records = {}; fixture.writes = []; fixture.beforeTransaction = undefined;
  fixture.user = { uid: 'owner', emailVerified: true, disabled: false };
  auth = { uid: 'owner', token: { email_verified: true, auth_time: 100, role: 'admin' } };
  owner();
}
beforeEach(() => { reset(); googleFetch.mockClear(); vi.stubGlobal('fetch', googleFetch); });
afterAll(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const deniedCases: { name: string; change: () => void; code: string }[] = [
  { name: 'unauthenticated', change: () => { auth = undefined; }, code: 'unauthenticated' },
  { name: 'missing Auth account', change: () => { fixture.user = undefined; }, code: 'permission-denied' },
  { name: 'disabled Auth account', change: () => { fixture.user!.disabled = true; }, code: 'permission-denied' },
  { name: 'unverified current Auth account', change: () => { fixture.user!.emailVerified = false; }, code: 'permission-denied' },
  { name: 'unverified token', change: () => { auth!.token.email_verified = false; }, code: 'permission-denied' },
  { name: 'revoked Auth token', change: () => { fixture.user!.tokensValidAfterTime = new Date(101_000).toISOString(); }, code: 'unauthenticated' },
  { name: 'missing current membership despite admin claim', change: () => { delete fixture.records['memberships/owner']; }, code: 'permission-denied' },
  { name: 'suspended current membership', change: () => { owner({ status: 'suspended' }); }, code: 'permission-denied' },
  { name: 'mismatched membership UID', change: () => { owner({ uid: 'other' }); }, code: 'permission-denied' },
  { name: 'membership session cutoff', change: () => { owner({ sessionValidAfter: 100 }); }, code: 'permission-denied' },
  { name: 'owner without users.manage', change: () => { owner({ permissions: ['quiz.media.upload'] }); }, code: 'permission-denied' },
  { name: 'owner without quiz.media.upload', change: () => { owner({ permissions: ['users.manage'] }); }, code: 'permission-denied' },
  { name: 'owner with role label only', change: () => { owner({ permissions: [] }); }, code: 'permission-denied' },
  { name: 'manager with both concrete permissions', change: () => { owner({ role: 'manager' }); }, code: 'permission-denied' },
];
test.each(deniedCases)('all seven callables reject $name before any credential or Google IO', async denied => {
  for (const endpoint of endpoints) {
    reset(); denied.change();
    const request = { auth, data: endpoint.data } as unknown as Parameters<typeof endpoint.target.run>[0];
    await expect(endpoint.target.run(request), endpoint.name).rejects.toMatchObject({ code: denied.code });
    expect(fixture.writes, endpoint.name).toEqual([]);
    expect(googleFetch, endpoint.name).not.toHaveBeenCalled();
  }
});
test('a current owner with both concrete permissions reads the default disabled status without Google IO or secret bindings', async () => {
  const request = { auth, data: {} } as unknown as Parameters<typeof callables.readDriveConnection.run>[0];
  await expect(callables.readDriveConnection.run(request)).resolves.toEqual({ configured: false, status: 'not-configured', message: 'Připojení Disku zatím není nakonfigurované.', mediaImportEnabled: false });
  expect(googleFetch).not.toHaveBeenCalled(); expect(fixture.writes).toEqual([]);
  for (const endpoint of endpoints) expect(endpoint.target.__endpoint.secretEnvironmentVariables ?? []).toEqual([]);
});
test('the Firestore transaction rechecks current membership and fresh Auth after invocation authorization', async () => {
  const request = { auth, data: {} } as unknown as Parameters<typeof callables.readDriveConnection.run>[0];
  for (const change of [() => owner({ status: 'suspended' }), () => owner({ permissions: ['users.manage'] }),
    () => owner({ role: 'manager' }), () => { fixture.user!.disabled = true; }]) {
    reset(); fixture.beforeTransaction = change;
    await expect(callables.readDriveConnection.run(request)).rejects.toMatchObject({ code: 'permission-denied' });
    expect(fixture.writes).toEqual([]); expect(googleFetch).not.toHaveBeenCalled();
  }
});
