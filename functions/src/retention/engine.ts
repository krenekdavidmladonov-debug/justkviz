import { createHash, randomUUID } from 'node:crypto';
import { FieldPath, Timestamp, type Firestore, type Transaction } from 'firebase-admin/firestore';

export type RetentionMode = 'off' | 'preview' | 'apply';
export const contactRetentionDays = 90;
export const retentionDocumentLimit = 200;
export const retentionCollections = ['registrations', 'emailIntents', 'emailSecrets', 'emailCampaigns', 'registrationOperations', 'registrationAbuse'] as const;
const day = 86_400_000;
const safeRegistrationFields = ['schemaVersion', 'eventId', 'teamName', 'normalizedTeamName', 'memberCount', 'status', 'source', 'revision', 'createdAt', 'updatedAt', 'cancelledAt', 'cancelledBy', 'createdBy', 'updatedBy'] as const;
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const timestampMillis = (value: unknown): number | undefined => value instanceof Timestamp ? value.toMillis() : undefined;

/** Only a recorded event end can start a retention period. A scheduled start cannot. */
export function retentionEndMillis(event: Record<string, unknown>, now: number): number | undefined {
  if (!['completed', 'cancelled'].includes(event.lifecycleStatus as string)
    || ![undefined, 'active', 'archived'].includes(event.disposition as undefined | string)
    || event.restoring === true || event.restoreInProgress === true || event.restoration !== undefined) return undefined;
  const startsAt = timestampMillis(event.startsAt);
  if (startsAt === undefined || startsAt > now) return undefined;
  const end = timestampMillis(object(event.lifecycleStatus === 'cancelled' ? event.cancellation : event.completion).at);
  if (end === undefined || end > now || (event.lifecycleStatus === 'completed' && end < startsAt)) return undefined;
  return end;
}

export interface RetentionSummary {
  mode: RetentionMode;
  scannedEvents: number;
  eligibleEvents: number;
  anonymized: number;
  deleted: number;
  examinedDocuments: number;
  writtenDocuments: number;
  skippedBusy: number;
  resultsMode: 'off' | 'preview';
  resultsCandidates: number;
  nextPreviewCursor?: string;
}
export interface RetentionOptions {
  readonly mode: RetentionMode;
  readonly resultsMode?: 'off' | 'preview';
  readonly now?: Date;
  readonly maxDocuments?: number;
  readonly eventLimit?: number;
  readonly startAfterEventId?: string;
  readonly previewCursor?: string;
}

function resultsDue(end: number, now: number): boolean {
  const anniversary = new Date(end);
  const year = anniversary.getUTCFullYear(), month = anniversary.getUTCMonth(), date = anniversary.getUTCDate();
  anniversary.setUTCDate(1);
  anniversary.setUTCFullYear(year + 1);
  anniversary.setUTCMonth(month);
  const monthEnd = new Date(Date.UTC(year + 1, month + 1, 0)).getUTCDate();
  anniversary.setUTCDate(Math.min(date, monthEnd));
  return anniversary.getTime() < now;
}

async function activeDelivery(tx: Transaction, db: Firestore, eventId: string, event: Record<string, unknown>, now: number): Promise<boolean> {
  if (event.liveSessionId !== undefined && event.liveSessionId !== null) {
    if (typeof event.liveSessionId !== 'string' || !/^[^/]{1,1500}$/u.test(event.liveSessionId)) return true;
    const pointed = (await tx.get(db.collection('sessions').doc(event.liveSessionId))).data();
    if (!pointed || pointed.eventId !== eventId || pointed.status !== 'ended') return true;
  }
  const sessions = await tx.get(db.collection('sessions').where('eventId', '==', eventId)
    .where('status', 'in', ['waiting', 'active']).limit(1));
  if (!sessions.empty) return true;
  const leases = await tx.get(db.collection('events').doc(eventId).collection('emailIntents')
    .where('status', '==', 'processing').where('leaseUntil', '>', Timestamp.fromMillis(now)).limit(1));
  return !leases.empty;
}

interface Step { done: boolean; skipped: boolean; examined: number; anonymized: number; deleted: number; written: number }
async function contactStep(db: Firestore, eventId: string, options: RetentionOptions, now: Timestamp, remaining: number): Promise<Step> {
  const eventRef = db.collection('events').doc(eventId);
  const progressRef = db.collection('retentionState').doc('contact-event-' + createHash('sha256').update(eventId).digest('hex'));
  return db.runTransaction(async tx => {
    const event = (await tx.get(eventRef)).data();
    const end = event ? retentionEndMillis(event, now.toMillis()) : undefined;
    const noChange = { done: true, skipped: false, examined: 0, anonymized: 0, deleted: 0, written: 0 };
    if (!event || end === undefined || end >= now.toMillis() - contactRetentionDays * day) return noChange;
    if (await activeDelivery(tx, db, eventId, event, now.toMillis())) return { ...noChange, skipped: true };
    const progress = (await tx.get(progressRef)).data();
    const matching = progress?.endMillis === end;
    const phase = matching && Number.isSafeInteger(progress.phase) ? Number(progress.phase) : 0;
    if (phase >= retentionCollections.length) return noChange;
    const collection = retentionCollections[phase]!;
    let query = eventRef.collection(collection).orderBy(FieldPath.documentId()).limit(remaining);
    if (matching && typeof progress.lastId === 'string') query = query.startAfter(progress.lastId);
    const rows = await tx.get(query);
    const donePhase = rows.size < remaining;
    const nextPhase = donePhase ? phase + 1 : phase;
    let anonymized = 0, deleted = 0;
    for (const row of rows.docs) {
      if (collection === 'registrations') {
        if (row.get('contactsAnonymizedAt') instanceof Timestamp) continue;
        anonymized++;
        if (options.mode === 'apply') {
          const data = row.data();
          const safe = Object.fromEntries(safeRegistrationFields.filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]]));
          tx.set(row.ref, { ...safe, contactsAnonymizedAt: now, contactRetentionVersion: 1 });
        }
      } else {
        deleted++;
        if (options.mode === 'apply') tx.delete(row.ref);
      }
    }
    if (options.mode === 'apply') {
      const done = nextPhase >= retentionCollections.length;
      tx.set(progressRef, { version: 1, eventId, endMillis: end, phase: nextPhase,
        ...(donePhase ? {} : { lastId: rows.docs.at(-1)!.id }), updatedAt: now });
      tx.update(eventRef, { contactRetention: { version: 1, state: done ? 'complete' : 'processing', startedAt: object(event.contactRetention).startedAt ?? now,
        ...(done ? { completedAt: now } : {}) } });
      if (anonymized + deleted > 0) tx.create(db.collection('retentionAudit').doc(randomUUID()), {
        version: 1, action: 'contacts-anonymized', eventId, at: now, anonymized, deleted, documents: anonymized + deleted,
      });
    }
    return { done: nextPhase >= retentionCollections.length, skipped: false, examined: rows.size, anonymized, deleted,
      written: options.mode === 'apply' ? anonymized + deleted + 2 + Number(anonymized + deleted > 0) : 0 };
  });
}

interface PreviewCursor {
  readonly version: 1;
  readonly nowMillis: number;
  readonly eventId?: string;
  readonly phase?: number;
  readonly lastDocumentId?: string;
  readonly afterEventId?: string;
}
function previewCursor(value: string | undefined): PreviewCursor | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > 12_000 || !/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error('Invalid retention preview cursor.');
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')); }
  catch { throw new Error('Invalid retention preview cursor.'); }
  const cursor = object(parsed);
  if (cursor.version !== 1 || typeof cursor.nowMillis !== 'number' || !Number.isFinite(cursor.nowMillis)
    || Object.keys(cursor).some(key => !['version', 'nowMillis', 'eventId', 'phase', 'lastDocumentId', 'afterEventId'].includes(key))
    || ['eventId', 'lastDocumentId', 'afterEventId'].some(key => cursor[key] !== undefined && (typeof cursor[key] !== 'string' || !/^[^/]{1,1500}$/u.test(cursor[key])))
    || (cursor.eventId !== undefined && cursor.afterEventId !== undefined)
    || (cursor.eventId !== undefined && (!Number.isSafeInteger(cursor.phase) || Number(cursor.phase) < 0 || Number(cursor.phase) >= retentionCollections.length))
    || (cursor.eventId === undefined && (cursor.phase !== undefined || cursor.lastDocumentId !== undefined))) throw new Error('Invalid retention preview cursor.');
  return cursor as unknown as PreviewCursor;
}
const encodePreviewCursor = (cursor: PreviewCursor): string => Buffer.from(JSON.stringify(cursor)).toString('base64url');

/** The cursor is server-side continuation data. It must never enter logs or public responses. */
async function previewRetention(db: Firestore, options: RetentionOptions, summary: RetentionSummary, now: Timestamp, maximum: number, eventLimit: number, cursor?: PreviewCursor): Promise<RetentionSummary> {
  let query = db.collection('events').orderBy(FieldPath.documentId()).limit(eventLimit);
  if (cursor?.eventId) query = query.startAt(cursor.eventId);
  else if (cursor?.afterEventId ?? options.startAfterEventId) query = query.startAfter(cursor?.afterEventId ?? options.startAfterEventId);
  const events = await query.get();
  for (const row of events.docs) {
    const continuation = row.id === cursor?.eventId;
    summary.scannedEvents++;
    const result = await db.runTransaction(async tx => {
      const event = (await tx.get(row.ref)).data();
      const end = event ? retentionEndMillis(event, now.toMillis()) : undefined;
      if (!event || end === undefined) return { eligible: false, resultDue: false, busy: false, examined: 0, anonymized: 0, deleted: 0 };
      if (await activeDelivery(tx, db, row.id, event, now.toMillis())) return { eligible: false, resultDue: false, busy: true, examined: 0, anonymized: 0, deleted: 0 };
      const due = options.mode === 'preview' && end < now.toMillis() - contactRetentionDays * day;
      let examined = 0, anonymized = 0, deleted = 0;
      if (due) for (let phase = continuation ? cursor.phase! : 0; phase < retentionCollections.length; phase++) {
        const remaining = maximum - summary.examinedDocuments - examined;
        if (remaining < 1) return { eligible: true, resultDue: resultsDue(end, now.toMillis()), busy: false, examined, anonymized, deleted,
          next: { version: 1 as const, nowMillis: now.toMillis(), eventId: row.id, phase } };
        const collection = retentionCollections[phase]!;
        let docsQuery = row.ref.collection(collection).orderBy(FieldPath.documentId()).limit(remaining);
        if (continuation && phase === cursor.phase && cursor.lastDocumentId) docsQuery = docsQuery.startAfter(cursor.lastDocumentId);
        // Preview needs only the anonymization marker or the document count.
        const docs = await tx.get(collection === 'registrations' ? docsQuery.select('contactsAnonymizedAt') : docsQuery.select());
        examined += docs.size;
        if (collection === 'registrations') anonymized += docs.docs.filter(doc => !(doc.get('contactsAnonymizedAt') instanceof Timestamp)).length;
        else deleted += docs.size;
        if (docs.size === remaining) return { eligible: true, resultDue: resultsDue(end, now.toMillis()), busy: false, examined, anonymized, deleted,
          next: { version: 1 as const, nowMillis: now.toMillis(), eventId: row.id, phase, lastDocumentId: docs.docs.at(-1)!.id } };
      }
      return { eligible: due, resultDue: resultsDue(end, now.toMillis()), busy: false, examined, anonymized, deleted };
    });
    summary.examinedDocuments += result.examined;
    summary.anonymized += result.anonymized;
    summary.deleted += result.deleted;
    if (!continuation && result.eligible) summary.eligibleEvents++;
    if (!continuation && summary.resultsMode === 'preview' && result.resultDue) summary.resultsCandidates++;
    if (result.busy) summary.skippedBusy++;
    if (result.next) { summary.nextPreviewCursor = encodePreviewCursor(result.next); return summary; }
    if (summary.examinedDocuments >= maximum) {
      summary.nextPreviewCursor = encodePreviewCursor({ version: 1, nowMillis: now.toMillis(), afterEventId: row.id });
      return summary;
    }
  }
  if (events.size === eventLimit) summary.nextPreviewCursor = encodePreviewCursor({ version: 1, nowMillis: now.toMillis(), afterEventId: events.docs.at(-1)!.id });
  return summary;
}

/** Preview performs reads only, including its progress and audit behavior. */
export async function runRetention(db: Firestore, options: RetentionOptions): Promise<RetentionSummary> {
  if (!['off', 'preview', 'apply'].includes(options.mode) || (options.resultsMode !== undefined && !['off', 'preview'].includes(options.resultsMode))) throw new Error('Invalid retention mode.');
  if (options.startAfterEventId !== undefined && (typeof options.startAfterEventId !== 'string' || !/^[^/]{1,1500}$/u.test(options.startAfterEventId))) throw new Error('Invalid retention cursor.');
  const continuation = previewCursor(options.previewCursor);
  if (continuation && options.mode === 'apply') throw new Error('Preview cursor is read-only.');
  const nowDate = options.now ?? new Date(continuation?.nowMillis ?? Date.now());
  if (!Number.isFinite(nowDate.getTime())) throw new Error('Invalid retention clock.');
  const now = Timestamp.fromDate(nowDate);
  const maximum = options.maxDocuments ?? retentionDocumentLimit;
  const eventLimit = options.eventLimit ?? 50;
  if (!Number.isSafeInteger(maximum) || maximum < 5 || maximum > retentionDocumentLimit
    || !Number.isSafeInteger(eventLimit) || eventLimit < 1 || eventLimit > 200) throw new Error('Invalid retention batch limits.');
  const summary: RetentionSummary = { mode: options.mode, scannedEvents: 0, eligibleEvents: 0, anonymized: 0, deleted: 0,
    examinedDocuments: 0, writtenDocuments: 0, skippedBusy: 0, resultsMode: options.resultsMode ?? 'off', resultsCandidates: 0 };
  if (options.mode === 'off' && summary.resultsMode === 'off') return summary;
  if (options.mode !== 'apply') return previewRetention(db, options, summary, now, maximum, eventLimit, continuation);
  const scanRef = db.collection('retentionState').doc('contact-scan-v1');
  const scan = (await scanRef.get()).data();
  let query = db.collection('events').orderBy(FieldPath.documentId()).limit(eventLimit);
  const startingCursor: unknown = options.startAfterEventId ?? scan?.lastEventId;
  if (typeof startingCursor === 'string') query = query.startAfter(startingCursor);
  const events = await query.get();
  let lastEventId: string | null = null;
  for (const row of events.docs) {
    const end = retentionEndMillis(row.data(), now.toMillis());
    summary.scannedEvents++;
    if (summary.resultsMode === 'preview' && end !== undefined && resultsDue(end, now.toMillis())) {
      const busy = await db.runTransaction(async tx => {
        const event = (await tx.get(row.ref)).data();
        return !event || retentionEndMillis(event, now.toMillis()) === undefined || activeDelivery(tx, db, row.id, event, now.toMillis());
      });
      if (!busy) summary.resultsCandidates++;
    }
    if (end !== undefined && end < now.toMillis() - contactRetentionDays * day) {
      summary.eligibleEvents++;
      {
        let step: Step;
        do {
          step = await contactStep(db, row.id, options, now, Math.min(maximum - summary.examinedDocuments, maximum - summary.writtenDocuments - 4));
          summary.writtenDocuments += step.written;
          summary.anonymized += step.anonymized;
          summary.deleted += step.deleted;
          summary.examinedDocuments += step.examined;
          if (step.skipped) summary.skippedBusy++;
        } while (!step.done && !step.skipped && summary.examinedDocuments < maximum && summary.writtenDocuments < maximum - 4);
        if (!step.done) break;
      }
    }
    lastEventId = row.id;
    if (summary.examinedDocuments >= maximum || summary.writtenDocuments >= maximum - 4) break;
  }
  if (options.mode === 'apply') {
    const reachedEnd = events.size < eventLimit && lastEventId === events.docs.at(-1)?.id;
    const cursor: unknown = lastEventId ?? scan?.lastEventId;
    const nextCursor = !reachedEnd && !events.empty && typeof cursor === 'string' ? cursor : undefined;
    if (summary.writtenDocuments > 0 || nextCursor !== scan?.lastEventId) {
      await scanRef.set({ version: 1, ...(nextCursor ? { lastEventId: nextCursor } : {}), updatedAt: now });
      summary.writtenDocuments++;
    }
  }
  return summary;
}
