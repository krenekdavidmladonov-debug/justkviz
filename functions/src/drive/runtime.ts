import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError } from 'firebase-functions/v2/https';
import { hasPermission, scopeAllows, type Membership } from '@filmovy-kviz/quiz-domain';
import { driveConfiguration, type DriveConfiguration } from './config.js';
import { GoogleDriveFiles, type DriveFiles } from './files.js';
import { DriveProviderError, GoogleDriveProvider, type DriveAccount, type DriveFolder, type DriveProvider } from './provider.js';
import type { DriveConnection } from './service.js';

const clientSecret = defineSecret('DRIVE_OAUTH_CLIENT_SECRET'), keyring = defineSecret('DRIVE_TOKEN_KEYRING');
const ownerPermissions = ['users.manage', 'quiz.read', 'quiz.media.upload'] as const;
export const driveRuntimeEnabled = process.env.DRIVE_CONNECTION_ENABLED === 'true';
/** Disabled endpoint discovery must never bind or access secrets. */
export const driveRuntimeSecrets: ReturnType<typeof defineSecret>[] = driveRuntimeEnabled ? [clientSecret, keyring] : [];
export function driveRuntimeConfiguration(): DriveConfiguration {
  const config = driveConfiguration(process.env, driveRuntimeEnabled
    ? { clientSecret: clientSecret.value(), keyring: keyring.value() } : { clientSecret: '', keyring: '' });
  if (!config) throw new HttpsError('failed-precondition', 'Připojení Disku není nakonfigurované.');
  return config;
}
export interface DriveAccessBinding {
  ownerUid: string;
  quizId: string;
  /** Exact generation for current upload/job operations. Historical reads bind account identity instead. */
  connectionGeneration?: number;
  accountPermissionId?: string;
  folderId?: string;
}
export interface DriveAccess {
  /** Internal callback only. Never return or persist this credential. */
  accessToken: string;
  account: DriveAccount;
  folder: DriveFolder;
  files: DriveFiles;
  assertCurrent(): Promise<void>;
}
interface Snapshot {
  memberVersion: number;
  sessionValidAfter: number;
  authValidAfter: string;
  connection: DriveConnection & { account: DriveAccount; folder: DriveFolder };
}
/** Optional transport/config injection supports entirely offline protocol tests. */
export interface DriveRuntimeDependencies { config: DriveConfiguration; provider: DriveProvider; files: DriveFiles }
function unavailable(): never { throw new HttpsError('failed-precondition', 'Soukromé médium na Disku není dostupné.'); }
function identifier(value: string, maximum: number): void {
  if (typeof value !== 'string' || !value || value.length > maximum || value.includes('/')
    || [...value].some(point => point.charCodeAt(0) < 32 || point.charCodeAt(0) === 127)) unavailable();
}
function same(actual: Snapshot, expected: Snapshot): void {
  const a = actual.connection, e = expected.connection;
  if (actual.memberVersion !== expected.memberVersion || actual.sessionValidAfter !== expected.sessionValidAfter
    || actual.authValidAfter !== expected.authValidAfter || a.revision !== e.revision || a.generation !== e.generation
    || a.folder.id !== e.folder.id || a.account.permissionId !== e.account.permissionId || a.account.email !== e.account.email) unavailable();
}

/** Server-only owner grant; reader/actor authorization remains the caller's independent responsibility. */
export async function withDriveAccess<T>(binding: DriveAccessBinding, action: (access: DriveAccess) => Promise<T>,
  dependencies?: DriveRuntimeDependencies): Promise<T> {
  identifier(binding.ownerUid, 128); identifier(binding.quizId, 150);
  if (binding.connectionGeneration === undefined && binding.accountPermissionId === undefined) unavailable();
  if (binding.connectionGeneration !== undefined && (!Number.isSafeInteger(binding.connectionGeneration) || binding.connectionGeneration < 0)) unavailable();
  if (binding.accountPermissionId !== undefined && !/^[a-zA-Z0-9_-]{1,200}$/u.test(binding.accountPermissionId)) unavailable();
  const db = getFirestore(), connectionRef = db.doc('driveConnections/' + binding.ownerUid);
  const read = (expected?: Snapshot, mutate?: (connection: Snapshot['connection']) => DriveConnection) => db.runTransaction(async tx => {
    // Keep each checkpoint fresh, but fetch its independent Auth/Firestore state together.
    const [user, [memberRecord, quizRecord, connectionRecord]] = await Promise.all([
      getAuth().getUser(binding.ownerUid).catch(() => null),
      tx.getAll(db.doc('memberships/' + binding.ownerUid), db.doc('quizzes/' + binding.quizId), connectionRef),
    ]);
    if (!user || user.uid !== binding.ownerUid || user.disabled || !user.emailVerified) unavailable();
    const member = memberRecord?.data() as Membership | undefined;
    const quiz = quizRecord?.data();
    const connection = connectionRecord?.data() as Snapshot['connection'] | undefined;
    if (!quiz || !member || member.uid !== binding.ownerUid || member.status !== 'active' || member.role !== 'owner'
      || !Number.isSafeInteger(member.version) || member.version < 0 || !Number.isSafeInteger(member.sessionValidAfter)
      || member.sessionValidAfter < 0 || !Array.isArray(member.permissions)
      || !ownerPermissions.every(permission => hasPermission(member, permission))
      || !scopeAllows(member.quizzes, binding.quizId, member.uid, quiz.createdBy)
      || !connection || !Number.isSafeInteger(connection.revision) || connection.revision < 0
      || !Number.isSafeInteger(connection.generation) || connection.generation < 0
      || (binding.connectionGeneration !== undefined && connection.generation !== binding.connectionGeneration) || connection.reauthorizationRequired || connection.revokingUntil
      || !connection.refreshToken || !connection.account || !connection.folder
      || (binding.accountPermissionId !== undefined && connection.account.permissionId !== binding.accountPermissionId)
      || (binding.folderId !== undefined && connection.folder.id !== binding.folderId)) unavailable();
    const snapshot: Snapshot = { memberVersion: member.version, sessionValidAfter: member.sessionValidAfter,
      authValidAfter: user.tokensValidAfterTime ?? '', connection: structuredClone(connection) };
    if (expected) same(snapshot, expected);
    if (mutate) {
      const next = mutate(connection);
      tx.set(connectionRef, next);
      snapshot.connection = structuredClone(next) as Snapshot['connection'];
    }
    return snapshot;
  });
  let snapshot = await read();
  const config = dependencies?.config ?? driveRuntimeConfiguration();
  const provider = dependencies?.provider ?? new GoogleDriveProvider(config);
  const files = dependencies?.files ?? new GoogleDriveFiles();
  try {
    const context = 'justkviz-drive:v1:' + binding.ownerUid + ':refresh:' + snapshot.connection.generation;
    const token = await provider.refresh(config.vault.open(snapshot.connection.refreshToken!, context));
    const [accountResult, folderResult] = await Promise.allSettled([
      provider.account(token.accessToken),
      provider.folder(token.accessToken, snapshot.connection.folder.id, snapshot.connection.account),
    ]);
    // Preserve account/reauthorization failure precedence even if the folder finishes first.
    if (accountResult.status === 'rejected') throw accountResult.reason;
    const account = accountResult.value;
    if (account.permissionId !== snapshot.connection.account.permissionId || account.email !== snapshot.connection.account.email) throw new DriveProviderError(true);
    if (folderResult.status === 'rejected') throw folderResult.reason;
    const folder = folderResult.value;
    if (folder.id !== snapshot.connection.folder.id) unavailable();
    snapshot = await read(snapshot, token.refreshToken ? connection => ({ ...connection, revision: connection.revision + 1,
      refreshToken: config.vault.seal(token.refreshToken!, context) }) : undefined);
    const result = await action({ accessToken: token.accessToken, account, folder, files,
      assertCurrent: async () => { await read(snapshot); } });
    await read(snapshot);
    return result;
  } catch (error) {
    if (error instanceof DriveProviderError && error.reauthorization) {
      await read(snapshot, connection => ({ ...connection, revision: connection.revision + 1, reauthorizationRequired: true }));
    }
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('unavailable', 'Soukromé médium na Disku není dostupné.');
  }
}
