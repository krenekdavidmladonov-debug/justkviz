import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, Timestamp, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import type { Membership } from '@filmovy-kviz/quiz-domain';
import { isQuestionKind, quizRevision } from '../editor/model.js';
import type { EditorSlideKind } from '../editor/types.js';
import { assertQuizActive } from '../quizzes/guards.js';
import { importId, type DriveImportAttachment, type DriveImportAsset, type DriveImportJob, type DriveImportStore,
  type DriveImportView, type SourceAsset } from './import-model.js';
import type { DriveConnection } from './service.js';

export interface DriveImportStoreDependencies {
  db?: Firestore; auth?: Pick<Auth, 'getUser'>; now?: () => number;
  /** Read the current device in this transaction. Return buffered writes, executed only after every read. */
  guard?: (tx: Transaction, ownerUid: string, target: import('./import-model.js').DriveImportTarget) => Promise<((jobs: readonly DriveImportJob[]) => void) | void>;
}
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Narrow merge only: retain legacy source, answers, notes, extension fields and all counts. */
export function importAttachmentPatch(slide: Record<string, unknown>, attachment: DriveImportAttachment): Record<string, unknown> {
  const provenance = object(slide.driveImportProvenance);
  return { [attachment.field]: attachment.reference,
    ...(attachment.clipStartSeconds === undefined ? {} : { clipStartSeconds: attachment.clipStartSeconds }),
    ...(attachment.clipEndSeconds === undefined ? {} : { clipEndSeconds: attachment.clipEndSeconds }),
    driveImportProvenance: { ...provenance, [attachment.field]: attachment.privateProvenance } };
}
/** Existing derived question documents are merge-patched, never recreated from incomplete media input. */
export function importQuestionPatch(attachment: DriveImportAttachment): Record<string, unknown> {
  return { [attachment.field]: attachment.reference,
    ...(attachment.clipStartSeconds === undefined ? {} : { clipStartSeconds: attachment.clipStartSeconds, videoStart: attachment.clipStartSeconds }),
    ...(attachment.clipEndSeconds === undefined ? {} : { clipEndSeconds: attachment.clipEndSeconds, videoEnd: attachment.clipEndSeconds }) };
}

/** Construct lazily: disabled Function discovery performs no Auth/Firestore IO or SDK initialization. */
export function firestoreDriveImportStore(dependencies: DriveImportStoreDependencies = {}): DriveImportStore {
  return { run: (ownerUid, target, handler) => {
    importId(ownerUid); importId(target.quizId); importId(target.slideId);
    const db = dependencies.db ?? getFirestore(), auth = dependencies.auth ?? getAuth(), now = dependencies.now ?? Date.now;
    return db.runTransaction(async tx => {
      // Repeat on every Firestore retry; an old request/lease never substitutes for a current Auth account.
      const user = await auth.getUser(ownerUid).catch(() => null);
      if (!user || user.disabled || !user.emailVerified) throw new HttpsError('permission-denied', 'Příprava média není povolena.');
      const quizRef = db.doc('quizzes/' + target.quizId), slideRef = quizRef.collection('slides').doc(target.slideId);
      const [memberSnapshot, connectionSnapshot, quizSnapshot, slideSnapshot] = await tx.getAll(db.doc('memberships/' + ownerUid),
        db.doc('driveConnections/' + ownerUid), quizRef, slideRef);
      const member = memberSnapshot!.data() as Membership | undefined;
      if (!member || member.uid !== ownerUid || member.status !== 'active') throw new HttpsError('permission-denied', 'Příprava média není povolena.');
      const quiz = quizSnapshot!.data(), slide = slideSnapshot!.data();
      assertQuizActive(quiz);
      const stored = connectionSnapshot!.data() as DriveConnection | undefined;
      const authValidAfter = user.tokensValidAfterTime ? Date.parse(user.tokensValidAfterTime) : 0;
      if (!Number.isFinite(authValidAfter) || !Number.isFinite(member.sessionValidAfter)) throw new HttpsError('permission-denied', 'Příprava média není povolena.');
      const guardedWrite = await dependencies.guard?.(tx, ownerUid, target);
      const jobs: DriveImportJob[] = [], assets: DriveImportAsset[] = [], attachments: DriveImportAttachment[] = [];
      const jobCache = new Map<string, DriveImportJob | undefined>();
      const view: DriveImportView = { freshIdentity: true, member, authValidAfter,
        ...(stored ? { connection: { ownerUid, connected: !!stored.refreshToken && !!stored.account && !!stored.folder
          && !stored.reauthorizationRequired && !(stored.revokingUntil && stored.revokingUntil > now()),
        revision: stored.revision, generation: stored.generation, folderId: stored.folder?.id ?? '', accountPermissionId: stored.account?.permissionId ?? '' } } : {}),
        quiz: { id: target.quizId, revision: quizRevision(quiz!), createdBy: typeof quiz!.createdBy === 'string' ? quiz!.createdBy : '', active: true },
        ...(slide ? { slide } : {}),
        readJob: async id => {
          if (!/^[a-f0-9]{64}$/u.test(id)) throw new HttpsError('invalid-argument', 'Neplatná úloha média.');
          if (!jobCache.has(id)) jobCache.set(id, (await tx.get(db.doc('driveMediaJobs/' + id))).data() as DriveImportJob | undefined);
          const job = jobCache.get(id);
          // Historical ready assets use current read authorization; unfinished work cannot survive an Auth/session revocation.
          if (job && job.status !== 'ready' && (!Number.isFinite(job.createdAt)
            || job.createdAt <= Math.max(authValidAfter, member.sessionValidAfter * 1000))) throw new HttpsError('permission-denied', 'Příprava média vyžaduje nový požadavek.');
          return job;
        },
        readAsset: async id => {
          if (!/^[a-f0-9]{64}$/u.test(id)) throw new HttpsError('invalid-argument', 'Neplatné médium.');
          return (await tx.get(quizRef.collection('mediaAssets').doc(id))).data() as SourceAsset | undefined;
        },
        writeJob: job => { jobs.push(job); }, createAsset: asset => { assets.push(asset); },
        attachMedia: attachment => { attachments.push(attachment); },
      };
      const result = await handler(view);
      // No SDK writes until the domain handler has finished every read.
      if (attachments.length > 1) throw new HttpsError('failed-precondition', 'Neplatná změna média.');
      let questionRef: ReturnType<typeof db.doc> | undefined;
      if (attachments.length && slide && slide.isQuestion !== false && typeof slide.roundId === 'string'
        && (slide.isQuestion === true || (typeof slide.kind === 'string' && isQuestionKind(slide.kind.toLowerCase() as EditorSlideKind)))) {
        const candidate = quizRef.collection('rounds').doc(importId(slide.roundId)).collection('questions').doc(target.slideId);
        // Some retained V1 slides have no derived question or no explicit flag. Never invent one from a media patch.
        if ((await tx.get(candidate)).data() !== undefined) questionRef = candidate;
      }
      guardedWrite?.(jobs);
      for (const job of jobs) {
        if (job.ownerUid !== ownerUid || job.quizId !== target.quizId || job.slideId !== target.slideId || job.field !== target.field) throw new HttpsError('failed-precondition', 'Neplatná úloha média.');
        tx.set(db.doc('driveMediaJobs/' + job.jobId), job);
      }
      for (const asset of assets) {
        if (asset.quizId !== target.quizId || asset.createdBy !== ownerUid) throw new HttpsError('failed-precondition', 'Neplatné médium.');
        tx.create(quizRef.collection('mediaAssets').doc(asset.assetId), asset);
      }
      for (const attachment of attachments) {
        if (!slide || attachment.field !== target.field || attachment.expectedQuizRevision !== view.quiz!.revision) throw new HttpsError('aborted', 'Zdroj média se změnil.');
        const timestamp = Timestamp.fromMillis(now());
        tx.update(slideRef, importAttachmentPatch(slide, attachment));
        if (questionRef) tx.update(questionRef, importQuestionPatch(attachment));
        tx.update(quizRef, { revision: view.quiz!.revision + 1, updatedAt: timestamp, updatedBy: ownerUid });
        tx.create(db.collection('accessAudit').doc(), { kind: 'drive-media-attached', actorUid: ownerUid,
          quizId: target.quizId, slideId: target.slideId, field: target.field, at: timestamp });
      }
      return result;
    });
  } };
}
