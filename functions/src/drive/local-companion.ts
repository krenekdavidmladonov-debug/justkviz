import { createHash, randomBytes } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp, type Transaction } from 'firebase-admin/firestore';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import type { Membership } from '@filmovy-kviz/quiz-domain';
import { authorize, freshIdentity, type AuthIdentity } from '../access/authorization.js';
import { requireRealDriveRuntime } from './config.js';
import { importTarget, type DriveImportJob, type DriveImportLocator, type DriveImportStatus } from './import-model.js';
import { firestoreDriveImportStore } from './import-store.js';
import { DriveImportService, type DriveImportFiles, type PreparedDriveMedia } from './imports.js';
import { driveRuntimeSecrets, withDriveAccess } from './runtime.js';
import type { DriveConnection } from './service.js';
import { assertLocalDevice, assertLocalOwner, bindLocalDevice, localDenied, localHash, localLeaseMillis, localPermissions,
  parseLocalToken, type LocalAuthority, type LocalDevice, type LocalPairing } from './local-device.js';
import { maximumLocalOutput, validateLocalOutput } from './local-output.js';

const projectId = () => process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? '';
export function requireLocalCompanionRuntime(): void {
  // Real providers remain unreachable in the emulator; offline tests inject their own ports below.
  requireRealDriveRuntime();
  if (process.env.DRIVE_CONNECTION_ENABLED !== 'true' || process.env.DRIVE_MEDIA_ENABLED !== 'true'
    || process.env.DRIVE_MEDIA_LOCAL_ENABLED !== 'true') throw new HttpsError('failed-precondition', 'Místní příprava médií není zapnutá.');
}
const deviceRef = (deviceId: string) => getFirestore().doc('driveMediaCompanions/' + deviceId);
async function authority(tx: Transaction, uid: string): Promise<LocalAuthority> {
  const user = await getAuth().getUser(uid).catch(() => null);
  const [member, connection] = await tx.getAll(getFirestore().doc('memberships/' + uid), getFirestore().doc('driveConnections/' + uid));
  if (!user || !member?.data() || !connection?.data()) localDenied();
  const result: LocalAuthority = { member: member.data() as Membership, connection: connection.data() as DriveConnection,
    verified: !user.disabled && user.emailVerified, authValidAfter: user.tokensValidAfterTime ? Date.parse(user.tokensValidAfterTime) : 0 };
  if (result.member.uid !== uid) localDenied();
  assertLocalOwner(result); return result;
}
async function readDevice(tx: Transaction, deviceId: string, token: string) {
  const device = (await tx.get(deviceRef(deviceId))).data() as LocalDevice | undefined;
  if (!device || !/^[A-Za-z0-9_-]{1,128}$/u.test(device.ownerUid)) localDenied();
  const current = await authority(tx, device.ownerUid);
  assertLocalDevice(device, current, projectId(), Date.now(), token);
  return device;
}
export async function configureLocalCompanion(auth: AuthIdentity, action: 'pair' | 'status' | 'revoke') {
  await freshIdentity(auth);
  const uid = auth!.uid, deviceId = localHash('justkviz-local-companion:v1:' + uid), now = Date.now();
  const code = action === 'pair' ? randomBytes(32).toString('base64url') : undefined;
  return getFirestore().runTransaction(async tx => {
    // Repeat verified account/session and membership authorization on every retry.
    await freshIdentity(auth);
    const member = await authorize(auth, localPermissions, undefined, tx);
    if (member.role !== 'owner') localDenied();
    const ref = deviceRef(deviceId);
    const stored = (await tx.get(ref)).data() as LocalDevice | undefined;
    if (action === 'pair') {
      const current = await authority(tx, uid);
      const pairingHash = localHash(code!), pairingExpiresAt = now + 300_000;
      const device = { ...bindLocalDevice(current, projectId(), deviceId, now), pairingHash };
      tx.set(ref, device);
      tx.create(getFirestore().doc('driveMediaPairings/' + pairingHash), { ownerUid: uid, deviceId, expiresAt: pairingExpiresAt, consumed: false } satisfies LocalPairing);
      tx.create(getFirestore().collection('accessAudit').doc(), { kind: 'drive-companion-pair-begin', actorUid: uid, at: Timestamp.fromMillis(now) });
      return { enabled: true, paired: false, pairingCode: code, pairingExpiresAt };
    }
    if (action === 'revoke') {
      if (stored) tx.set(ref, { ...stored, revoked: true, tokenHash: '', pairingHash: '', activeJob: null });
      tx.create(getFirestore().collection('accessAudit').doc(), { kind: 'drive-companion-revoked', actorUid: uid, at: Timestamp.fromMillis(now) });
      return { enabled: true, paired: false };
    }
    let paired = false;
    try { assertLocalDevice(stored, await authority(tx, uid), projectId(), now); paired = !!stored.tokenHash; } catch { /* Status exposes only current pairing state. */ }
    return { enabled: true, paired, ...(paired && stored ? { expiresAt: stored.expiresAt,
      ...(stored.activeJob && stored.activeJob.expiresAt > now ? { processing: true } : {}),
      ...(stored.lastSeen === undefined ? {} : { lastSeen: stored.lastSeen }) } : {}) };
  });
}

async function exchangePairing(code: string) {
  const hash = localHash(code), tokenSecret = randomBytes(32).toString('base64url');
  return getFirestore().runTransaction(async tx => {
    const ref = getFirestore().doc('driveMediaPairings/' + hash), pairing = (await tx.get(ref)).data() as LocalPairing | undefined;
    if (!pairing || pairing.consumed || pairing.expiresAt <= Date.now() || pairing.expiresAt > Date.now() + 300_000
      || !/^[a-f0-9]{64}$/u.test(pairing.deviceId) || !/^[A-Za-z0-9_-]{1,128}$/u.test(pairing.ownerUid)) localDenied();
    const device = (await tx.get(deviceRef(pairing.deviceId))).data() as LocalDevice | undefined;
    const current = await authority(tx, pairing.ownerUid);
    assertLocalDevice(device, current, projectId(), Date.now());
    if (device.pairingHash !== hash || device.tokenHash) localDenied();
    const token = device.deviceId + '.' + tokenSecret;
    tx.update(ref, { consumed: true });
    const next = { ...device, tokenHash: localHash(token), lastSeen: Date.now() }; delete next.pairingHash;
    tx.set(deviceRef(device.deviceId), next);
    tx.create(getFirestore().collection('accessAudit').doc(), { kind: 'drive-companion-pair-complete', actorUid: device.ownerUid, at: Timestamp.fromMillis(Date.now()) });
    return { token, deviceId: device.deviceId, expiresAt: device.expiresAt };
  });
}

function guardedService(device: LocalDevice, token: string, target: DriveImportLocator, mode: 'claim' | 'check' | 'replay', leaseId?: string) {
  const store = firestoreDriveImportStore({ guard: async tx => {
    const current = await readDevice(tx, device.deviceId, token), now = Date.now();
    if (mode === 'claim') {
      if (current.activeJob && current.activeJob.expiresAt > now) throw new HttpsError('aborted', 'Počítač již připravuje médium.');
    } else if (mode === 'check' && (!current.activeJob || current.activeJob.jobId !== target.jobId
      || current.activeJob.leaseId !== leaseId || current.activeJob.expiresAt <= now)) {
      throw new HttpsError('aborted', 'Úloha média již není aktuální.');
    }
    return jobs => {
      const claimed = mode === 'claim' ? jobs.find(job => job.jobId === target.jobId && job.status === 'processing' && job.lease) : undefined;
      tx.update(deviceRef(current.deviceId), { lastSeen: now,
        ...(claimed?.lease ? { activeJob: { jobId: target.jobId, leaseId: claimed.lease.id, expiresAt: claimed.lease.expiresAt } } : {}) });
    };
  } });
  const files: DriveImportFiles = {
    generateId: connection => withDriveAccess({ ownerUid: device.ownerUid, quizId: target.quizId, connectionGeneration: connection.generation,
      accountPermissionId: connection.accountPermissionId, folderId: connection.folderId }, access => access.files.generateId(access.accessToken)),
    upload: (connection, input) => withDriveAccess({ ownerUid: device.ownerUid, quizId: target.quizId, connectionGeneration: connection.generation,
      accountPermissionId: connection.accountPermissionId, folderId: connection.folderId }, access => access.files.upload(access.accessToken, { ...input, account: access.account })),
  };
  return new DriveImportService(device.ownerUid, store, { prepare: () => { throw new Error('LOCAL_PREPARATION_REQUIRED'); } }, files, Date.now, localLeaseMillis);
}
async function releaseDevice(device: LocalDevice, token: string, jobId: string, leaseId: string) {
  await getFirestore().runTransaction(async tx => {
    const current = await readDevice(tx, device.deviceId, token);
    if (current.activeJob?.jobId === jobId && current.activeJob.leaseId === leaseId) tx.update(deviceRef(current.deviceId), { activeJob: null, lastSeen: Date.now() });
  });
}
async function locate(deviceId: string, token: string, jobId: string): Promise<{ device: LocalDevice; job: DriveImportJob; target: DriveImportLocator }> {
  return getFirestore().runTransaction(async tx => {
    const device = await readDevice(tx, deviceId, token);
    const job = (await tx.get(getFirestore().doc('driveMediaJobs/' + jobId))).data() as DriveImportJob | undefined;
    if (!job || job.ownerUid !== device.ownerUid || job.execution !== 'local' || job.source.type !== 'youtube') localDenied();
    const target = importTarget({ quizId: job.quizId, slideId: job.slideId, field: job.field, jobId }, true) as DriveImportLocator;
    return { device, job, target };
  });
}

export interface CompanionPorts {
  enabled(): void;
  pair(code: string): Promise<{ token: string; deviceId: string; expiresAt: number }>;
  claim(token: string): Promise<{ job: null | (DriveImportLocator & { leaseId: string; expiresAt: number; source: DriveImportJob['source'] }) }>;
  complete(token: string, jobId: string, leaseId: string, bytes: Buffer): Promise<DriveImportStatus>;
  fail(token: string, jobId: string, leaseId: string, code: string): Promise<DriveImportStatus>;
}
export const localCompanionRuntimePorts: CompanionPorts = {
  enabled: requireLocalCompanionRuntime, pair: exchangePairing,
  claim: async token => {
    const { deviceId } = parseLocalToken(token);
    const device = await getFirestore().runTransaction(tx => readDevice(tx, deviceId, token));
    if (device.activeJob && device.activeJob.expiresAt > Date.now()) return { job: null };
    // Equality-only filters use Firestore's automatic single-field index merging. Keep every query bounded.
    const batches = await Promise.all(['queued', 'failed', 'processing'].map(status => {
      const query = getFirestore().collection('driveMediaJobs').where('ownerUid', '==', device.ownerUid).where('execution', '==', 'local').where('status', '==', status);
      return (status === 'failed' ? query.where('localRetry', '==', true) : query).limit(20).get();
    }));
    const candidates = batches.flatMap(batch => batch.docs.map(doc => doc.data() as DriveImportJob))
      .filter(job => (job.attempt < 3 || job.status === 'processing') && (!job.lease || job.lease.expiresAt <= Date.now())).sort((a, b) => a.updatedAt - b.updatedAt);
    for (const candidate of candidates) {
      const target = importTarget({ quizId: candidate.quizId, slideId: candidate.slideId, field: candidate.field, jobId: candidate.jobId }, true) as DriveImportLocator;
      let claimed: DriveImportJob | null;
      try { claimed = await guardedService(device, token, target, 'claim').claimLocal(target); }
      catch (error) {
        if (!(error instanceof HttpsError) || !['failed-precondition', 'not-found', 'permission-denied'].includes(error.code)) throw error;
        // Removed/trashed source must not poison other queued work. Recheck the grant and exact owner before marking stale.
        await getFirestore().runTransaction(async tx => {
          await readDevice(tx, deviceId, token);
          const ref = getFirestore().doc('driveMediaJobs/' + target.jobId), current = (await tx.get(ref)).data() as DriveImportJob | undefined;
          if (current?.ownerUid === device.ownerUid && current.execution === 'local' && !['ready', 'stale'].includes(current.status)
            && (!current.lease || current.lease.expiresAt <= Date.now())) {
            const stale = { ...current, status: 'stale', errorCode: error.code === 'permission-denied' ? 'membership-changed' : 'source-changed', updatedAt: Date.now() }; delete stale.lease; tx.set(ref, stale);
          }
        });
        continue;
      }
      if (claimed?.lease) return { job: { ...target, leaseId: claimed.lease.id, expiresAt: claimed.lease.expiresAt, source: claimed.source } };
    }
    // Status tracks presence even when there is no pending job.
    await getFirestore().runTransaction(async tx => { const current = await readDevice(tx, deviceId, token); tx.update(deviceRef(deviceId), { lastSeen: Date.now() }); return current; });
    return { job: null };
  },
  complete: async (token, jobId, leaseId, bytes) => {
    const { deviceId } = parseLocalToken(token), { device, job, target } = await locate(deviceId, token, jobId);
    if (job.status === 'ready') {
      const status = await guardedService(device, token, target, 'replay').status(target);
      if (status.status !== 'ready') throw new HttpsError('aborted', 'Úloha média již není aktuální.');
      if (!job.output || job.output.size !== bytes.length || job.output.sha256 !== createHash('sha256').update(bytes).digest('hex')) {
        throw new HttpsError('aborted', 'Výstup média se změnil.');
      }
      return status;
    }
    const service = guardedService(device, token, target, 'check', leaseId);
    await service.inspectLocal(target, leaseId);
    // Repeat all guards after bounded validation and around external Drive IO.
    let prepared: PreparedDriveMedia;
    try { prepared = await validateLocalOutput(job.source, bytes); }
    catch {
      const failed = await service.failLocal(target, leaseId, 'invalid-output');
      await releaseDevice(device, token, jobId, leaseId); return failed;
    }
    const status = await service.completeLocal(target, leaseId, prepared);
    if (['ready', 'failed', 'stale'].includes(status.status)) await releaseDevice(device, token, jobId, leaseId);
    return status;
  },
  fail: async (token, jobId, leaseId) => {
    const { deviceId } = parseLocalToken(token), { device, target } = await locate(deviceId, token, jobId);
    const status = await guardedService(device, token, target, 'check', leaseId).failLocal(target, leaseId);
    await releaseDevice(device, token, jobId, leaseId); return status;
  },
};
interface CompanionRequest { method: string; get(name: string): string | undefined; query: Record<string, unknown>; body: unknown; rawBody?: Buffer }
interface CompanionResponse { set(name: string, value: string): CompanionResponse; status(code: number): CompanionResponse; json(value: unknown): unknown; end(): unknown }
const object = (input: unknown): Record<string, unknown> => input && typeof input === 'object' && !Array.isArray(input) && !Buffer.isBuffer(input) ? input as Record<string, unknown> : {};
const exact = (input: Record<string, unknown>, fields: string[]) => Object.keys(input).length === fields.length && Object.keys(input).every(key => fields.includes(key));
const validJob = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const validLease = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(value);
/** No browser origins, cookies, redirects, caller URLs, file paths or executable arguments. */
export function companionHandler(ports: CompanionPorts) {
  return async (request: CompanionRequest, response: CompanionResponse): Promise<void> => {
    response.set('Cache-Control', 'no-store').set('X-Content-Type-Options', 'nosniff');
    if (request.method !== 'POST') { response.status(405).end(); return; }
    if (request.get('origin') || request.get('cookie')) { response.status(403).end(); return; }
    try {
      ports.enabled();
      const contentType = request.get('content-type')?.split(';')[0]?.trim().toLowerCase(), body = object(request.body);
      if (contentType === 'application/json' && Object.keys(request.query).length === 0 && body.action === 'pair') {
        if (!exact(body, ['action', 'code']) || typeof body.code !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(body.code)
          || (request.rawBody?.length ?? 0) > 1024) throw new HttpsError('invalid-argument', 'Neplatný požadavek.');
        response.json(await ports.pair(body.code)); return;
      }
      const bearer = request.get('authorization');
      if (!bearer?.startsWith('Bearer ')) localDenied();
      const { token } = parseLocalToken(bearer.slice(7));
      if (contentType === 'application/octet-stream') {
        if (!exact(request.query, ['action', 'jobId', 'leaseId']) || request.query.action !== 'complete'
          || !validJob(request.query.jobId) || !validLease(request.query.leaseId)) throw new HttpsError('invalid-argument', 'Neplatný požadavek.');
        const bytes = request.rawBody;
        if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > maximumLocalOutput) { response.status(413).end(); return; }
        response.json(await ports.complete(token, request.query.jobId, request.query.leaseId, bytes)); return;
      }
      if (contentType !== 'application/json' || Object.keys(request.query).length || (request.rawBody?.length ?? 0) > 2048) throw new HttpsError('invalid-argument', 'Neplatný požadavek.');
      if (body.action === 'claim' && exact(body, ['action'])) { response.json(await ports.claim(token)); return; }
      if (body.action === 'fail' && exact(body, ['action', 'jobId', 'leaseId', 'code']) && validJob(body.jobId) && validLease(body.leaseId)
        && typeof body.code === 'string' && ['processing-failed', 'invalid-output', 'deadline-exceeded', 'provider-unavailable'].includes(body.code)) {
        response.json(await ports.fail(token, body.jobId, body.leaseId, body.code)); return;
      }
      throw new HttpsError('invalid-argument', 'Neplatný požadavek.');
    } catch (error) {
      const code = error instanceof HttpsError ? error.code : 'unavailable';
      response.status(code === 'aborted' ? 409 : ['permission-denied', 'unauthenticated'].includes(code) ? 403
        : code === 'invalid-argument' ? 400 : code === 'failed-precondition' ? 412 : 503).json({ error: code });
    }
  };
}
export const configureDriveMediaCompanion = onCall({ region: 'europe-west1', cors: true, timeoutSeconds: 30, maxInstances: 5 }, async request => {
  const data = object(request.data);
  if (!exact(data, ['action']) || !['pair', 'status', 'revoke'].includes(String(data.action))) throw new HttpsError('invalid-argument', 'Neplatný požadavek.');
  if (process.env.DRIVE_MEDIA_LOCAL_ENABLED !== 'true' && data.action === 'status') {
    await freshIdentity(request.auth); const member = await authorize(request.auth, localPermissions); if (member.role !== 'owner') localDenied();
    return { enabled: false, paired: false };
  }
  // Revocation remains available during rollback even while new local work is disabled.
  if (data.action === 'revoke') { requireRealDriveRuntime(); return configureLocalCompanion(request.auth, 'revoke'); }
  requireLocalCompanionRuntime();
  return configureLocalCompanion(request.auth, data.action as 'pair' | 'status' | 'revoke');
});
export const driveMediaCompanion = onRequest({ region: 'europe-west1', cors: false, timeoutSeconds: 120, memory: '512MiB',
  cpu: 1, concurrency: 1, maxInstances: 2, secrets: driveRuntimeSecrets }, companionHandler(localCompanionRuntimePorts));
