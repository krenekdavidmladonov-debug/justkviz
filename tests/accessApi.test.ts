import { beforeEach, expect, it, vi } from 'vitest';
import { FirebaseError } from 'firebase/app';
import { Timestamp } from 'firebase/firestore';
import { accessCall, invalidatePrivateAccess } from '../apps/web/src/features/access/api';

const sdk = vi.hoisted(() => ({ invoke: vi.fn(), clear: vi.fn() }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => sdk.invoke }));
vi.mock('../apps/web/src/services/firebase/client', () => ({ getFirebaseServices: () => ({ functions: {} }) }));
vi.mock('../apps/web/src/features/media/mediaBlobCache', () => ({ quizMediaBlobCache: { clear: sdk.clear } }));
beforeEach(() => { invalidatePrivateAccess(); sdk.invoke.mockReset(); sdk.clear.mockClear(); });

it('preserves the FirebaseError instance, code and details while adding callable context', async () => {
  const failure = Object.assign(new FirebaseError('functions/permission-denied', 'Denied'), { details: { reason: 'membership-inactive' } });
  sdk.invoke.mockRejectedValue(failure);
  await expect(accessCall('updateAccessMembership')).rejects.toBe(failure);
  expect(failure).toBeInstanceOf(FirebaseError);
  expect(failure.code).toBe('functions/permission-denied'); expect(failure.details).toEqual({ reason: 'membership-inactive' });
  expect(failure.message).toContain('updateAccessMembership'); expect(failure.message).toContain('functions/permission-denied');
});

it('rejects a successful response whose authority epoch was invalidated while pending', async () => {
  let resolve!: (value: unknown) => void;
  sdk.invoke.mockImplementation(() => new Promise(done => { resolve = done; }));
  const result = accessCall('listAccessUsers');
  const rejected = expect(result).rejects.toThrow('Přihlášení nebo oprávnění se změnilo.');
  invalidatePrivateAccess(); resolve({ data: { users: [{ uid: 'old-identity' }] } });
  await rejected; expect(sdk.clear).toHaveBeenCalledOnce();
});

it('keeps an authorization rejection rejected after epoch invalidation without converting it to data', async () => {
  let reject!: (error: unknown) => void;
  sdk.invoke.mockImplementation(() => new Promise((_done, fail) => { reject = fail; }));
  const denied = new FirebaseError('functions/permission-denied', 'Membership revoked');
  const result = accessCall('listAccessUsers'); const rejected = expect(result).rejects.toBe(denied);
  invalidatePrivateAccess(); reject(denied); await rejected;
  expect(denied.code).toBe('functions/permission-denied');
});

it('decodes fresh callable responses without losing nested timestamp values', async () => {
  sdk.invoke.mockResolvedValue({ data: { entries: [{ at: { $timestamp: 1000 } }] } });
  const result = await accessCall<{ entries: { at: Timestamp }[] }>('readAccessData');
  expect(result.entries[0]?.at).toBeInstanceOf(Timestamp); expect(result.entries[0]?.at.toMillis()).toBe(1000);
});

it('provides operation and error code when the SDK rejects a non-Error value', async () => {
  sdk.invoke.mockRejectedValue({ code: 'functions/unavailable' });
  const result = accessCall('createAccessInvitation');
  await expect(result).rejects.toBeInstanceOf(Error);
  await expect(result).rejects.toMatchObject({ code: 'functions/unavailable' });
  await expect(result).rejects.toThrow('createAccessInvitation');
});
