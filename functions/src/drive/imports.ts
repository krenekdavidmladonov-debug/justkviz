import { createHash, randomUUID } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import type { DriveFileReference } from './files.js';
import { authorizeImport, connectedImport, deriveImportSource, importDigest, importTarget, publicImportStatus, sourceFingerprint,
  type DriveImportAsset, type DriveImportConnection, type DriveImportJob, type DriveImportLocator, type DriveImportOutput,
  type DriveImportSource, type DriveImportStatus, type DriveImportStore, type DriveImportTarget, type DriveImportView } from './import-model.js';

export interface PreparedDriveMedia { bytes: Uint8Array; contentType: string; durationSeconds?: number }
export interface DriveImportProcessor {
  /** Trusted adapter verifies codecs/signatures and restricts HTTPS image fetching against SSRF; no network is performed here. */
  prepare(source: DriveImportSource, target: DriveImportTarget): Promise<PreparedDriveMedia>;
}
export interface DriveImportFiles {
  /** Adapter checks current account/folder privacy, refreshes credentials server-side, and never accepts browser tokens. */
  generateId(connection: DriveImportConnection): Promise<string>;
  /** Must reuse exact ID; existing-file retries verify identical bytes, metadata, private ACL and parent. */
  upload(connection: DriveImportConnection, input: { id: string; folderId: string; name: string; mimeType: string; bytes: Uint8Array }): Promise<DriveFileReference>;
}
class ImportHalt extends Error { constructor(readonly status: DriveImportStatus) { super('Příprava média již není aktuální.'); } }
class InvalidOutput extends Error { constructor(readonly code: 'invalid-output' | 'artifact-changed') { super('Výstup média neodpovídá úloze.'); } }
type JobStep = { halt: DriveImportStatus } | { job: DriveImportJob };
const withoutLease = (job: DriveImportJob): DriveImportJob => { const copy = { ...job }; delete copy.lease; return copy; };
const matchesTarget = (job: DriveImportJob, target: DriveImportLocator, ownerUid: string) => job.ownerUid === ownerUid && job.jobId === target.jobId
  && job.quizId === target.quizId && job.slideId === target.slideId && job.field === target.field;
const locator = (job: DriveImportJob): DriveImportLocator => ({ quizId: job.quizId, slideId: job.slideId, field: job.field, jobId: job.jobId });

function preparedOutput(source: DriveImportSource, prepared: PreparedDriveMedia): DriveImportOutput {
  const maximum = source.kind === 'image' ? 10 * 1024 * 1024 : 25 * 1024 * 1024;
  if (!(prepared.bytes instanceof Uint8Array) || prepared.bytes.length < 1 || prepared.bytes.length > maximum
    || !(source.kind === 'video' ? prepared.contentType === 'video/mp4' : source.kind === 'audio' ? prepared.contentType === 'audio/mpeg'
      : ['image/png', 'image/jpeg', 'image/webp'].includes(prepared.contentType))) throw new InvalidOutput('invalid-output');
  if (source.type === 'owned-image' && (prepared.contentType !== source.contentType || prepared.bytes.length !== source.size)) throw new InvalidOutput('invalid-output');
  if (source.type === 'youtube' && (typeof prepared.durationSeconds !== 'number' || !Number.isFinite(prepared.durationSeconds)
    || prepared.durationSeconds <= 0 || prepared.durationSeconds > 180.3
    || Math.abs(prepared.durationSeconds - (source.endSeconds - source.startSeconds)) > 0.3)) throw new InvalidOutput('invalid-output');
  return { contentType: prepared.contentType, size: prepared.bytes.length,
    sha256: createHash('sha256').update(prepared.bytes).digest('hex'), md5Checksum: createHash('md5').update(prepared.bytes).digest('hex'),
    ...(source.type === 'youtube' ? { durationSeconds: prepared.durationSeconds! } : {}) };
}

/** Pure orchestration over transaction/provider ports. No callables, cloud activation or public projection writes. */
export class DriveImportService {
  constructor(private readonly ownerUid: string, private readonly store: DriveImportStore,
    private readonly processor: DriveImportProcessor, private readonly files: DriveImportFiles,
    private readonly now: () => number = Date.now, private readonly leaseMillis = 900_000) {
    if (!Number.isSafeInteger(leaseMillis) || leaseMillis < 1000 || leaseMillis > 1_800_000) throw new Error('Invalid media lease configuration.');
  }

  async request(input: unknown, execution: 'cloud' | 'local' = 'cloud'): Promise<DriveImportStatus> {
    const target = importTarget(input);
    return this.store.run(this.ownerUid, target, async view => {
      authorizeImport(view, this.ownerUid, target);
      if (target.field !== 'mediaSource') throw new HttpsError('failed-precondition', 'Disk je určený pouze pro video a audio. Obrázky používají původní odkaz.');
      const connection = connectedImport(view, this.ownerUid), source = await deriveImportSource(view, target);
      if ('importJobId' in source) {
        const job = await view.readJob(source.importJobId);
        if (!job || job.ownerUid !== this.ownerUid || job.quizId !== target.quizId || job.status !== 'ready' || job.assetId !== source.assetId
          || job.accountPermissionId !== connection.accountPermissionId) throw new HttpsError('failed-precondition', 'Původ média není dostupný pro současné připojení.');
        return publicImportStatus(job);
      }
      const fingerprint = sourceFingerprint(source);
      const jobId = importDigest([this.ownerUid, view.member.version, view.member.sessionValidAfter, view.authValidAfter ?? 0,
        connection.revision, connection.generation, connection.folderId, connection.accountPermissionId, target.quizId, target.slideId, target.field, fingerprint]);
      const existing = await view.readJob(jobId);
      if (existing) {
        if (!matchesTarget(existing, { ...target, jobId }, this.ownerUid)) throw new HttpsError('failed-precondition', 'Úloha média není dostupná.');
        if (execution === 'local' && source.type === 'youtube' && (existing.status === 'failed' || existing.status === 'stale' || existing.status === 'queued'
          || (existing.status === 'processing' && (!existing.lease || existing.lease.expiresAt <= this.now())))) {
          const reset = existing.status === 'failed' || existing.status === 'stale' || existing.execution !== 'local';
          const queued: DriveImportJob = { ...withoutLease(existing), execution: 'local', status: 'queued', attempt: reset ? 0 : existing.attempt, updatedAt: this.now() };
          delete queued.errorCode;
          delete queued.localRetry;
          view.writeJob(queued); return publicImportStatus(queued);
        }
        return publicImportStatus(existing);
      }
      const job: DriveImportJob = { schemaVersion: 1, ...target, jobId, ownerUid: this.ownerUid,
        membershipVersion: view.member.version, connectionRevision: connection.revision, connectionGeneration: connection.generation,
        folderId: connection.folderId, accountPermissionId: connection.accountPermissionId, authValidAfter: view.authValidAfter ?? 0,
        source, sourceFingerprint: fingerprint, sourceQuizRevision: view.quiz!.revision,
        ...(execution === 'local' && source.type === 'youtube' ? { execution: 'local' as const } : {}),
        status: 'queued', createdAt: this.now(), updatedAt: this.now(), attempt: 0 };
      view.writeJob(job);
      return publicImportStatus(job);
    });
  }

  async status(input: unknown): Promise<DriveImportStatus> {
    const target = importTarget(input, true) as DriveImportLocator;
    return this.store.run(this.ownerUid, target, async view => {
      authorizeImport(view, this.ownerUid, target);
      const job = await view.readJob(target.jobId);
      if (!job || !matchesTarget(job, target, this.ownerUid)) throw new HttpsError('not-found', 'Úloha média není dostupná.');
      if (job.status === 'ready' && (!view.connection?.connected || view.connection.accountPermissionId !== job.accountPermissionId)) {
        return { jobId: job.jobId, status: 'stale', errorCode: 'connection-changed' };
      }
      return publicImportStatus(job);
    });
  }

  private async staleCode(view: DriveImportView, job: DriveImportJob): Promise<DriveImportJob['errorCode'] | undefined> {
    if (view.member.version !== job.membershipVersion || (view.authValidAfter ?? 0) !== job.authValidAfter) return 'membership-changed';
    const connection = view.connection;
    if (!connection || connection.ownerUid !== job.ownerUid || !connection.connected || connection.revision !== job.connectionRevision
      || connection.generation !== job.connectionGeneration || connection.folderId !== job.folderId || connection.accountPermissionId !== job.accountPermissionId) return 'connection-changed';
    try {
      const source = await deriveImportSource(view, job);
      if ('importJobId' in source) return source.importJobId === job.jobId && source.assetId === job.assetId && job.status === 'ready' ? undefined : 'source-changed';
      return sourceFingerprint(source) === job.sourceFingerprint ? undefined : 'source-changed';
    } catch { return 'source-changed'; }
  }

  private async checkpoint(job: DriveImportJob, update?: (current: DriveImportJob) => DriveImportJob): Promise<DriveImportJob> {
    const result = await this.store.run<JobStep>(this.ownerUid, job, async view => {
      authorizeImport(view, this.ownerUid, job);
      const current = await view.readJob(job.jobId);
      if (!current || !matchesTarget(current, locator(job), this.ownerUid)) throw new HttpsError('not-found', 'Úloha média není dostupná.');
      if (current.status !== 'processing' || current.lease?.id !== job.lease?.id || current.lease!.expiresAt <= this.now()) return { halt: publicImportStatus(current) };
      const errorCode = await this.staleCode(view, current);
      if (errorCode) {
        const stale: DriveImportJob = { ...withoutLease(current), status: 'stale', errorCode, updatedAt: this.now() };
        view.writeJob(stale); return { halt: publicImportStatus(stale) };
      }
      const next = update ? update(current) : current;
      if (update) view.writeJob(next);
      return { job: next };
    });
    if ('halt' in result) throw new ImportHalt(result.halt);
    return result.job;
  }

  /** Claim only an authoritative local YouTube job. Device exclusivity belongs to the transaction guard. */
  async claimLocal(input: unknown): Promise<DriveImportJob | null> {
    const target = importTarget(input, true) as DriveImportLocator;
    return this.store.run(this.ownerUid, target, async view => {
      authorizeImport(view, this.ownerUid, target);
      const job = await view.readJob(target.jobId);
      if (!job || !matchesTarget(job, target, this.ownerUid) || job.execution !== 'local' || job.source.type !== 'youtube'
        || ['ready', 'stale'].includes(job.status)
        || (job.status === 'processing' && job.lease && job.lease.expiresAt > this.now())) return null;
      if (job.attempt >= 3) {
        if (job.status !== 'failed') view.writeJob({ ...withoutLease(job), status: 'failed', localRetry: false, errorCode: 'processing-failed', updatedAt: this.now() });
        return null;
      }
      const errorCode = await this.staleCode(view, job);
      if (errorCode) {
        view.writeJob({ ...withoutLease(job), status: 'stale', errorCode, updatedAt: this.now() }); return null;
      }
      const claimed: DriveImportJob = { ...job, status: 'processing', attempt: job.attempt + 1,
        lease: { id: randomUUID(), expiresAt: this.now() + this.leaseMillis }, updatedAt: this.now() };
      delete claimed.errorCode;
      view.writeJob(claimed); return claimed;
    });
  }

  async failLocal(input: unknown, leaseId: string, errorCode: 'processing-failed' | 'invalid-output' = 'processing-failed'): Promise<DriveImportStatus> {
    const target = importTarget(input, true) as DriveImportLocator;
    return this.store.run(this.ownerUid, target, async view => {
      authorizeImport(view, this.ownerUid, target);
      const job = await view.readJob(target.jobId);
      if (!job || !matchesTarget(job, target, this.ownerUid) || job.execution !== 'local' || job.status !== 'processing'
        || job.lease?.id !== leaseId || job.lease.expiresAt <= this.now()) throw new HttpsError('aborted', 'Úloha média již není aktuální.');
      const stale = await this.staleCode(view, job);
      const next: DriveImportJob = { ...withoutLease(job), status: stale ? 'stale' : 'failed', errorCode: stale ?? errorCode,
        localRetry: !stale && errorCode === 'processing-failed' && job.attempt < 3, updatedAt: this.now() };
      view.writeJob(next); return publicImportStatus(next);
    });
  }

  /** Check scope, exact source and lease before spending resources on an untrusted artifact. */
  async inspectLocal(input: unknown, leaseId: string): Promise<DriveImportJob> {
    const target = importTarget(input, true) as DriveImportLocator;
    return this.store.run(this.ownerUid, target, async view => {
      authorizeImport(view, this.ownerUid, target);
      const job = await view.readJob(target.jobId);
      if (!job || !matchesTarget(job, target, this.ownerUid) || job.execution !== 'local' || job.source.type !== 'youtube'
        || job.status !== 'processing' || job.lease?.id !== leaseId || job.lease.expiresAt <= this.now()
        || await this.staleCode(view, job)) throw new HttpsError('aborted', 'Úloha média již není aktuální.');
      return job;
    });
  }

  run(input: unknown): Promise<DriveImportStatus> { return this.process(input); }
  completeLocal(input: unknown, leaseId: string, prepared: PreparedDriveMedia): Promise<DriveImportStatus> {
    return this.process(input, { leaseId, prepared });
  }

  private async process(input: unknown, local?: { leaseId: string; prepared: PreparedDriveMedia }): Promise<DriveImportStatus> {
    const target = importTarget(input, true) as DriveImportLocator;
    const claimed = await this.store.run<JobStep>(this.ownerUid, target, async view => {
      authorizeImport(view, this.ownerUid, target);
      const job = await view.readJob(target.jobId);
      if (!job || !matchesTarget(job, target, this.ownerUid)) throw new HttpsError('not-found', 'Úloha média není dostupná.');
      if (local) {
        if (job.execution !== 'local' || job.source.type !== 'youtube' || job.status !== 'processing' || job.lease?.id !== local.leaseId
          || job.lease.expiresAt <= this.now()) throw new HttpsError('aborted', 'Úloha média již není aktuální.');
        const stale = await this.staleCode(view, job);
        if (stale) throw new HttpsError('aborted', 'Zdroj média již není aktuální.');
        return { job };
      }
      if (job.execution === 'local') throw new HttpsError('failed-precondition', 'Úlohu zpracovává místní počítač.');
      if (job.status === 'ready' || job.status === 'stale' || (job.status === 'processing' && job.lease && job.lease.expiresAt > this.now())) return { halt: publicImportStatus(job) };
      const errorCode = await this.staleCode(view, job);
      if (errorCode) {
        const stale: DriveImportJob = { ...withoutLease(job), status: 'stale', errorCode, updatedAt: this.now() };
        view.writeJob(stale); return { halt: publicImportStatus(stale) };
      }
      const processing: DriveImportJob = { ...job, status: 'processing', attempt: job.attempt + 1,
        lease: { id: randomUUID(), expiresAt: this.now() + this.leaseMillis }, updatedAt: this.now() };
      delete processing.errorCode;
      view.writeJob(processing); return { job: processing };
    });
    if ('halt' in claimed) return claimed.halt;
    let job = claimed.job;
    try {
      await this.checkpoint(job);
      const prepared = local?.prepared ?? await this.processor.prepare(job.source, target), output = preparedOutput(job.source, prepared);
      job = await this.checkpoint(job, current => {
        if (current.output && importDigest(current.output) !== importDigest(output)) throw new InvalidOutput('artifact-changed');
        return { ...current, output, updatedAt: this.now() };
      });
      const connection: DriveImportConnection = { ownerUid: job.ownerUid, connected: true, revision: job.connectionRevision,
        generation: job.connectionGeneration, folderId: job.folderId, accountPermissionId: job.accountPermissionId };
      if (!job.fileId) {
        await this.checkpoint(job);
        const id = await this.files.generateId(connection);
        if (!/^[A-Za-z0-9_-]{5,200}$/u.test(id)) throw new InvalidOutput('invalid-output');
        job = await this.checkpoint(job, current => ({ ...current, fileId: current.fileId ?? id, updatedAt: this.now() }));
      }
      await this.checkpoint(job);
      const extension = output.contentType === 'video/mp4' ? 'mp4' : output.contentType === 'audio/mpeg' ? 'mp3'
        : output.contentType === 'image/png' ? 'png' : output.contentType === 'image/jpeg' ? 'jpg' : 'webp';
      const file = await this.files.upload(connection, { id: job.fileId!, folderId: job.folderId,
        name: `justkviz-${job.jobId}.${extension}`, mimeType: output.contentType, bytes: prepared.bytes });
      if (file.id !== job.fileId || file.folderId !== job.folderId || file.mimeType !== output.contentType || file.size !== output.size
        || file.sha256 !== output.sha256 || file.md5Checksum !== output.md5Checksum) throw new InvalidOutput('invalid-output');
      const result = await this.store.run(this.ownerUid, target, async view => {
        authorizeImport(view, this.ownerUid, target);
        const current = await view.readJob(job.jobId);
        if (!current || current.status !== 'processing' || current.lease?.id !== job.lease?.id || current.lease!.expiresAt <= this.now()) return current ? publicImportStatus(current) : { jobId: job.jobId, status: 'stale' as const };
        const errorCode = await this.staleCode(view, current);
        if (errorCode) {
          const stale: DriveImportJob = { ...withoutLease(current), status: 'stale', errorCode, updatedAt: this.now() };
          view.writeJob(stale); return publicImportStatus(stale);
        }
        const assetId = importDigest(['drive-asset-v1', job.jobId]);
        const privateProvenance = { source: job.source, sourceFingerprint: job.sourceFingerprint, sourceQuizRevision: job.sourceQuizRevision, field: job.field };
        const asset: DriveImportAsset = { quizId: job.quizId, assetId, kind: job.source.kind, contentType: output.contentType,
          size: output.size, status: 'ready', storageBackend: 'drive', generation: 'drive:' + output.sha256, sha256: output.sha256, createdBy: this.ownerUid,
          createdAt: this.now(), readyAt: this.now(), importJobId: job.jobId,
          drive: { ownerUid: this.ownerUid, accountPermissionId: job.accountPermissionId, connectionGeneration: job.connectionGeneration, file }, privateProvenance };
        view.createAsset(asset);
        view.attachMedia({ field: job.field, reference: `quiz-asset:${job.quizId}/${assetId}`, expectedQuizRevision: view.quiz!.revision,
          ...(job.source.type === 'youtube' ? { clipStartSeconds: 0, clipEndSeconds: output.durationSeconds! } : {}),
          privateProvenance: { ...privateProvenance, importJobId: job.jobId } });
        const ready: DriveImportJob = { ...withoutLease(current), status: 'ready', assetId, updatedAt: this.now() };
        view.writeJob(ready); return publicImportStatus(ready);
      });
      return result;
    } catch (error) {
      if (error instanceof ImportHalt) return error.status;
      const errorCode = error instanceof InvalidOutput ? error.code : 'processing-failed';
      return this.store.run(this.ownerUid, target, async view => {
        authorizeImport(view, this.ownerUid, target);
        const current = await view.readJob(job.jobId);
        if (!current || current.status !== 'processing' || current.lease?.id !== job.lease?.id) return current ? publicImportStatus(current) : { jobId: job.jobId, status: 'stale' as const };
        const stale = await this.staleCode(view, current);
        const failed: DriveImportJob = { ...withoutLease(current), status: stale ? 'stale' : 'failed', errorCode: stale ?? errorCode,
          ...(current.execution === 'local' ? { localRetry: !stale && errorCode === 'processing-failed' && current.attempt < 3 } : {}), updatedAt: this.now() };
        view.writeJob(failed); return publicImportStatus(failed);
      });
    }
  }
}
