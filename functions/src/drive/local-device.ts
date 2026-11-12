import { createHash, timingSafeEqual } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import type { Membership } from '@filmovy-kviz/quiz-domain';
import type { DriveConnection } from './service.js';

export const localPermissions = ['users.manage', 'quiz.media.upload', 'quiz.media.attach', 'quiz.edit', 'quiz.read', 'quiz.answers.read'] as const;
export const deviceLifetime = 180 * 24 * 60 * 60 * 1000;
export const localLeaseMillis = 900_000;
export const localHash = (value: string): string => createHash('sha256').update(value).digest('hex');
export interface LocalDevice {
  ownerUid: string; deviceId: string; tokenHash?: string; expiresAt: number; revoked: boolean;
  membershipVersion: number; sessionValidAfter: number; authValidAfter: number;
  connectionRevision: number; connectionGeneration: number; accountPermissionId: string; folderId: string;
  project: string; lastSeen?: number; pairingHash?: string;
  activeJob?: { jobId: string; leaseId: string; expiresAt: number };
}
export interface LocalPairing { ownerUid: string; deviceId: string; expiresAt: number; consumed: boolean }
export interface LocalAuthority { member: Membership; authValidAfter: number; connection: DriveConnection; verified: boolean }
export function localDenied(): never { throw new HttpsError('permission-denied', 'Místní příprava média není povolena.'); }
export function assertLocalOwner(authority: LocalAuthority): void {
  const { member, connection } = authority;
  if (!authority.verified || member.role !== 'owner' || member.status !== 'active'
    || !Number.isSafeInteger(member.version) || member.version < 1 || !Number.isSafeInteger(member.sessionValidAfter)
    || !Number.isFinite(authority.authValidAfter) || !Array.isArray(member.permissions)
    || !localPermissions.every(permission => member.permissions.includes(permission))
    || !connection.refreshToken || !connection.account || !connection.folder || connection.reauthorizationRequired || connection.revokingUntil) localDenied();
}
export function bindLocalDevice(authority: LocalAuthority, project: string, deviceId: string, now: number): LocalDevice {
  assertLocalOwner(authority);
  return { ownerUid: authority.member.uid, deviceId, project, revoked: false, expiresAt: now + deviceLifetime,
    membershipVersion: authority.member.version, sessionValidAfter: authority.member.sessionValidAfter, authValidAfter: authority.authValidAfter,
    connectionRevision: authority.connection.revision, connectionGeneration: authority.connection.generation,
    accountPermissionId: authority.connection.account!.permissionId, folderId: authority.connection.folder!.id };
}
export function assertLocalDevice(device: LocalDevice | undefined, authority: LocalAuthority, project: string, now: number, token?: string): asserts device is LocalDevice {
  assertLocalOwner(authority);
  if (!device || device.ownerUid !== authority.member.uid || device.project !== project || device.revoked || device.expiresAt <= now
    || !Number.isFinite(device.expiresAt) || device.expiresAt > now + deviceLifetime
    || device.membershipVersion !== authority.member.version || device.sessionValidAfter !== authority.member.sessionValidAfter
    || device.authValidAfter !== authority.authValidAfter || device.connectionRevision !== authority.connection.revision
    || device.connectionGeneration !== authority.connection.generation || device.accountPermissionId !== authority.connection.account!.permissionId
    || device.folderId !== authority.connection.folder!.id) localDenied();
  if (token !== undefined && (!device.tokenHash || !/^[a-f0-9]{64}$/u.test(device.tokenHash)
    || !timingSafeEqual(Buffer.from(device.tokenHash, 'hex'), Buffer.from(localHash(token), 'hex')))) localDenied();
}
export function parseLocalToken(value: unknown): { deviceId: string; token: string } {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}\.[A-Za-z0-9_-]{43}$/u.test(value)) localDenied();
  return { deviceId: value.slice(0, 64), token: value };
}
