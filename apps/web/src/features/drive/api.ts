import { accessCall } from '../access/api';

export interface DriveConnectionStatus {
  configured: boolean;
  mediaImportEnabled?: boolean;
  mediaImportMode?: 'local' | 'cloud';
  status: 'not-configured' | 'disconnected' | 'folder-required' | 'connected' | 'reauthorization-required';
  accountEmail?: string;
  folder?: { id: string; name: string; url: string };
  message?: string;
}
export interface DriveFolderPickerCredentials {
  accessToken: string;
  expiresAt: number;
  developerKey: string;
  appId: string;
  suggestedFolderName: string;
}
export const readDriveConnection = () => accessCall<DriveConnectionStatus>('readDriveConnection');
export const beginDriveConnection = () => accessCall<{ authorizationUrl: string; state: string }>('beginDriveConnection');
export const completeDriveConnection = (code: string, state: string) => accessCall<DriveConnectionStatus>('completeDriveConnection', { code, state });
export const getDriveFolderPicker = () => accessCall<DriveFolderPickerCredentials>('getDriveFolderPicker');
export const selectDriveFolder = (folderId: string) => accessCall<DriveConnectionStatus>('selectDriveFolder', { folderId });
export const createDriveMediaFolder = () => accessCall<DriveConnectionStatus>('createDriveMediaFolder');
export const disconnectDriveConnection = () => accessCall<DriveConnectionStatus>('disconnectDriveConnection');

export interface DriveMediaCompanionStatus {
  enabled: boolean;
  paired: boolean;
  processing?: boolean;
  lastSeen?: number;
  expiresAt?: number;
  pairingCode?: string;
  pairingExpiresAt?: number;
}
export async function configureDriveMediaCompanion(action: 'pair' | 'status' | 'revoke'): Promise<DriveMediaCompanionStatus> {
  const value = await accessCall<DriveMediaCompanionStatus>('configureDriveMediaCompanion', { action });
  if (!value || typeof value.enabled !== 'boolean' || typeof value.paired !== 'boolean'
    || (value.processing !== undefined && typeof value.processing !== 'boolean')
    || [value.lastSeen, value.expiresAt, value.pairingExpiresAt].some(time => time !== undefined && (!Number.isSafeInteger(time) || time < 0))
    || (value.pairingCode !== undefined && (typeof value.pairingCode !== 'string' || !/^[A-Za-z0-9_-]{8,200}$/u.test(value.pairingCode)))) {
    throw new Error('Neplatný stav připojeného počítače.');
  }
  return { enabled: value.enabled, paired: value.paired,
    ...(value.processing === undefined ? {} : { processing: value.processing }),
    ...(value.lastSeen === undefined ? {} : { lastSeen: value.lastSeen }),
    ...(value.expiresAt === undefined ? {} : { expiresAt: value.expiresAt }),
    ...(value.pairingCode === undefined ? {} : { pairingCode: value.pairingCode }),
    ...(value.pairingExpiresAt === undefined ? {} : { pairingExpiresAt: value.pairingExpiresAt }) };
}
