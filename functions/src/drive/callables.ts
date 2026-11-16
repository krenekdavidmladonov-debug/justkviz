import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { authorize, freshIdentity } from '../access/authorization.js';
import { driveConfiguration } from './config.js';
import { GoogleDriveProvider } from './provider.js';
import { DriveConnectionService, type DriveConnection, type DriveOAuthState, type DriveStore } from './service.js';

const clientSecret = defineSecret('DRIVE_OAUTH_CLIENT_SECRET'), keyring = defineSecret('DRIVE_TOKEN_KEYRING');
// Disabled function discovery binds no secrets and performs no Google or secret IO.
const enabled = process.env.DRIVE_CONNECTION_ENABLED === 'true';
const options = { region: 'europe-west1', cors: true, maxInstances: 5, timeoutSeconds: 60,
  ...(enabled ? { secrets: [clientSecret, keyring] } : {}) };
function input(data: unknown, allowed: string[]): Record<string, unknown> {
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => !allowed.includes(key))
    || allowed.some(key => !Object.prototype.hasOwnProperty.call(data, key))) throw new HttpsError('invalid-argument', 'Neplatný požadavek pro připojení Disku.');
  return data as Record<string, unknown>;
}
export function driveStore(request: CallableRequest): DriveStore {
  return { run: (stateHash, handler) => getFirestore().runTransaction(async tx => {
    await freshIdentity(request.auth);
    const member = await authorize(request.auth, ['users.manage', 'quiz.media.upload'], undefined, tx);
    if (member.role !== 'owner') throw new HttpsError('permission-denied', 'Připojení Disku může spravovat pouze vlastník.');
    const db = getFirestore(), connectionRef = db.doc('driveConnections/' + member.uid);
    const stateRef = stateHash ? db.doc('driveOAuthStates/' + stateHash) : undefined;
    const connection = (await tx.get(connectionRef)).data() as DriveConnection | undefined;
    const state = stateRef ? (await tx.get(stateRef)).data() as DriveOAuthState | undefined : undefined;
    if (connection && (!Number.isSafeInteger(connection.revision) || connection.revision < 0
      || !Number.isSafeInteger(connection.generation) || connection.generation < 0
      || (connection.folderCreation !== undefined && (!connection.folderCreation || typeof connection.folderCreation !== 'object'
        || typeof connection.folderCreation.id !== 'string' || !/^[a-zA-Z0-9_-]{5,200}$/u.test(connection.folderCreation.id))))) {
      throw new HttpsError('failed-precondition', 'Připojení Disku není dostupné.');
    }
    return handler({ membershipVersion: member.version, connection: connection ?? { revision: 0, generation: 0 }, state,
      writeConnection: next => { tx.set(connectionRef, next); },
      writeState: next => { if (!stateRef) throw new HttpsError('internal', 'Připojení Disku není dostupné.'); tx.set(stateRef, next); },
      audit: kind => { tx.create(db.collection('accessAudit').doc(), { kind, actorUid: member.uid, at: Timestamp.now() }); },
    });
  }) };
}
function callable(keys: string[], handler: (service: DriveConnectionService, data: Record<string, unknown>) => unknown) {
  return onCall(options, async request => {
    const data = input(request.data, keys);
    await freshIdentity(request.auth);
    const member = await authorize(request.auth, ['users.manage', 'quiz.media.upload']);
    if (member.role !== 'owner') throw new HttpsError('permission-denied', 'Připojení Disku může spravovat pouze vlastník.');
    const config = driveConfiguration(process.env, enabled ? { clientSecret: clientSecret.value(), keyring: keyring.value() } : { clientSecret: '', keyring: '' });
    // A disabled config still supplies a never-used provider; read/disconnect remain available.
    const provider = new GoogleDriveProvider(config ?? { clientId: '', clientSecret: '', redirectUri: '', developerKey: '', appId: '', vault: {
      seal: () => { throw new Error('Drive unavailable.'); }, open: () => { throw new Error('Drive unavailable.'); },
    } });
    const service = new DriveConnectionService(request.auth?.uid ?? '', driveStore(request), config, provider);
    try { return await handler(service, data); }
    catch (error) { if (error instanceof HttpsError) throw error; throw new HttpsError('unavailable', 'Připojení Disku není nyní dostupné.'); }
  });
}
export const readDriveConnection = callable([], async service => ({ ...await service.read(),
  mediaImportEnabled: enabled && process.env.DRIVE_MEDIA_ENABLED === 'true',
  ...(process.env.DRIVE_MEDIA_LOCAL_ENABLED === 'true' ? { mediaImportMode: 'local' as const } : {}) }));
export const beginDriveConnection = callable([], service => service.begin());
export const completeDriveConnection = callable(['code', 'state'], (service, data) => service.complete(data.code, data.state));
export const getDriveFolderPicker = callable([], service => service.picker());
export const selectDriveFolder = callable(['folderId'], (service, data) => service.select(data.folderId));
export const createDriveMediaFolder = callable([], service => service.createFolder());
export const disconnectDriveConnection = callable([], service => service.disconnect());
