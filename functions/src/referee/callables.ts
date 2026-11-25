import { currentScores, fingerprint, parseCursor } from './sync.js';
import { isWarmupPing, warmupResponse } from '../warmup/ping.js';
import { assertEventOperational } from '../events/guards.js';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { eventScoringEpoch, eventOperational, scopeAllows, type Membership } from '@filmovy-kviz/quiz-domain';
import { accessActor, securedOnCall, runAccessTransaction } from '../access/authorization.js';
import { getFirestore, Timestamp, type Transaction } from 'firebase-admin/firestore';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { isObject } from '../events/validation.js';
import { commitScore, commitRoundScores, scoreHash } from '../scoring/core.js';
import { parseScoreRequest, parseRoundScoreRequest } from '../scoring/validation.js';
import { registrationOrder } from '../registrations/order.js';
import { snapshotRoundQuestionCounts } from '../scoring/snapshot-rounds.js';

const options = { region: 'europe-west1', cors: true, maxInstances: 10 };
const db = () => getFirestore();
const accessMessages = {
  'not-found': 'Odkaz je neplatný nebo byl nahrazen novým. Otevřete znovu odkaz nebo QR od organizátora.',
  revoked: 'Organizátor tento přístup odebral.',
  expired: 'Platnost odkazu vypršela. Požádejte organizátora o nový odkaz.',
  'issuer-inactive': 'Přístup zneplatněn – správce, který ho vydal, už nemá oprávnění. Požádejte o nový odkaz.',
  'event-closed': 'Akce už není otevřená pro zápis bodů.',
};
const deny = (reason: keyof typeof accessMessages) => new HttpsError('permission-denied', accessMessages[reason], { refereeAccess: reason });
const digest = (value: string) => createHash('sha256').update('referee-access-v1:' + value).digest('hex');
function record(value: unknown): Record<string, unknown> { if (!isObject(value)) throw new HttpsError('invalid-argument', 'Malformed request.'); return value; }
function id(data: Record<string, unknown>, field: string): string { const value = data[field]; if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,150}$/u.test(value)) throw new HttpsError('invalid-argument', 'Invalid identifier.'); return value; }
function revision(data: Record<string, unknown>): number { if (!Number.isSafeInteger(data.expectedVersion) || (data.expectedVersion as number) < 1) throw new HttpsError('invalid-argument', 'Invalid access version.'); return data.expectedVersion as number; }
function expiry(data: Record<string, unknown>): Timestamp { const value = typeof data.expiresAt === 'string' ? Date.parse(data.expiresAt) : NaN; const now = Date.now(); if (!Number.isFinite(value) || value <= now || value > now + 30 * 86400000) throw new HttpsError('invalid-argument', 'Platnost přístupu musí být v budoucnosti a nejvýše 30 dnů dopředu.'); return Timestamp.fromMillis(value); }
function label(data: Record<string, unknown>): string { const value = data.label; if (typeof value !== 'string' || !value.trim() || value.trim().length > 80 || /[\p{Cc}\p{Cf}]/u.test(value)) throw new HttpsError('invalid-argument', 'Invalid access label.'); return value.trim(); }
function organizer(request: CallableRequest) {
  return Promise.resolve(accessActor(request.auth).uid);
}
async function eventIn(transaction: Transaction, eventId: string) {
  const event = (await transaction.get(db().doc('events/' + eventId))).data();
  assertEventOperational(event);
  if (['archived', 'cancelled', 'completed'].includes(event.lifecycleStatus as string)) throw new HttpsError('failed-precondition', 'Event is unavailable.');
  return event;
}
function metadata(accessId: string, data: Record<string, unknown>) { return { accessId, label: String(data.label), expiresAt: (data.expiresAt as Timestamp).toDate().toISOString(), version: data.version as number,
  status: data.revoked === true ? 'revoked' : (data.expiresAt as Timestamp).toMillis() <= Date.now() ? 'expired' : 'active' }; }

export const listRefereeAccess = securedOnCall('listRefereeAccess', options, async request => {
  await organizer(request); const eventId = id(record(request.data), 'eventId');
  return runAccessTransaction(db(), async transaction => { await eventIn(transaction, eventId); const grants = await transaction.get(db().collection('events/' + eventId + '/refereeAccess')); return grants.docs.map(d => metadata(d.id, d.data())); });
});
export const issueRefereeAccess = securedOnCall('issueRefereeAccess', options, async request => {
  const uid = await organizer(request), data = record(request.data), eventId = id(data, 'eventId'), requestId = id(data, 'requestId');
  const name = label(data), expiresAt = expiry(data), accessId = scoreHash([uid, eventId, requestId]), secret = randomBytes(32).toString('base64url');
  const ref = db().doc(`events/${eventId}/refereeAccess/${accessId}`), fingerprint = scoreHash([name, data.expiresAt]);
  return runAccessTransaction(db(), async transaction => {
    const event = await eventIn(transaction, eventId); const old = (await transaction.get(ref)).data();
    if (old) { if (old.fingerprint !== fingerprint) throw new HttpsError('already-exists', 'Issuance request changed.'); return { ...metadata(accessId, old), key: null }; }
    const grants = await transaction.get(db().collection(`events/${eventId}/refereeAccess`));
    if (grants.size >= 50) throw new HttpsError('resource-exhausted', 'At most 50 named accesses per event. Reuse an existing access.');
    const grant = { capabilityVersion: event.capabilityVersion ?? 0, label: name, expiresAt, version: 1, revoked: false, keyHash: digest(secret), createdBy: uid, issuedBy: uid, createdAt: Timestamp.now(), fingerprint };
    transaction.create(ref, grant); return { ...metadata(accessId, grant), key: secret };
  });
});
export const changeRefereeAccess = securedOnCall('changeRefereeAccess', options, async request => {
  const uid = await organizer(request), data = record(request.data), eventId = id(data, 'eventId'), accessId = id(data, 'accessId'), expectedVersion = revision(data);
  if (!['revoke', 'rotate'].includes(data.action as string)) throw new HttpsError('invalid-argument', 'Invalid access action.');
  const nextExpiry = data.action === 'rotate' ? expiry(data) : null, secret = randomBytes(32).toString('base64url'), ref = db().doc(`events/${eventId}/refereeAccess/${accessId}`);
  return runAccessTransaction(db(), async transaction => {
    const event = await eventIn(transaction, eventId); const old = (await transaction.get(ref)).data();
    if (!old) throw new HttpsError('not-found', 'Access not found.');
    if (old.version !== expectedVersion) throw new HttpsError('aborted', 'Access changed. Reload the list.');
    const next = { ...old, capabilityVersion: event.capabilityVersion ?? 0, version: expectedVersion + 1, revoked: data.action === 'revoke', keyHash: data.action === 'rotate' ? digest(secret) : old.keyHash as unknown, expiresAt: nextExpiry ?? (old.expiresAt as Timestamp), ...(data.action === 'rotate' ? { issuedBy: uid } : {}), updatedBy: uid, updatedAt: Timestamp.now() };
    transaction.set(ref, next); return { ...metadata(accessId, next), key: data.action === 'rotate' ? secret : null };
  });
});

export interface RefereeCredential { eventId: string; accessId: string; key: string }
function credential(value: unknown): RefereeCredential {
  const data = record(value), eventId = id(data, 'eventId'), accessId = id(data, 'accessId');
  if (typeof data.key !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(data.key)) throw deny('not-found');
  return { eventId, accessId, key: data.key };
}
// Bounded fixed-window ingress protection. No raw IP, key or request body is persisted.
async function throttle(request: CallableRequest) {
  const now = Date.now(), ref = db().doc('refereeRateLimits/' + digest(request.rawRequest.ip ?? 'unknown'));
  const allowed = await db().runTransaction(async transaction => { const old = (await transaction.get(ref)).data(); const fresh = !old || now >= Number(old.until); const count = fresh ? 1 : Number(old.count) + 1; if (count > 180) return false; transaction.set(ref, { count, until: fresh ? now + 60000 : Number(old.until) }); return true; });
  if (!allowed) throw new HttpsError('resource-exhausted', 'Too many access requests. Try again later.');
}
async function accessIn(transaction: Transaction, c: RefereeCredential) {
  const grant = (await transaction.get(db().doc(`events/${c.eventId}/refereeAccess/${c.accessId}`))).data();
  const supplied = Buffer.from(digest(c.key));
  // Always compare equal-length hashes before disclosing any grant state.
  const expected = Buffer.from(typeof grant?.keyHash === 'string' && /^[a-f0-9]{64}$/u.test(grant.keyHash) ? grant.keyHash : '0'.repeat(64));
  const matches = timingSafeEqual(expected, supplied);
  if (!grant || !matches) throw deny('not-found');
  if (grant.revoked === true) throw deny('revoked');
  if (!(grant.expiresAt instanceof Timestamp)) throw new HttpsError('failed-precondition', 'Platnost přístupu není správně nastavená. Požádejte organizátora o kontrolu.');
  if (grant.expiresAt.toMillis() <= Date.now()) throw deny('expired');
  const event = (await transaction.get(db().doc('events/' + c.eventId))).data();
  if (!event) throw deny('event-closed');
  // Delegated bearer access cannot outlive the issuer's current ability to grant scoring.
  // Legacy grants retain their original issuer; rotation explicitly transfers issuance.
  const issuerUid: unknown = grant.issuedBy ?? grant.createdBy;
  if (typeof issuerUid !== 'string' || !issuerUid || issuerUid.includes('/')) throw deny('issuer-inactive');
  const issuer = (await transaction.get(db().doc(`memberships/${issuerUid}`))).data() as Membership | undefined;
  if (!issuer || issuer.uid !== issuerUid || issuer.status !== 'active'
    || !Array.isArray(issuer.permissions) || !issuer.permissions.includes('event.manage') || !issuer.permissions.includes('event.score')
    || !scopeAllows(issuer.events, c.eventId, issuerUid, event.createdBy)) throw deny('issuer-inactive');
  const identity = await getAuth().getUser(issuerUid).catch((error: unknown) => {
    if ((error as { code?: string }).code === 'auth/user-not-found') return null;
    throw error;
  });
  if (!identity || identity.disabled || !identity.emailVerified) throw deny('issuer-inactive');
  if (!eventOperational(event) || !['ready', 'live', 'finalizing'].includes(event.lifecycleStatus as string)
    || (event.capabilityVersion ?? 0) !== (grant.capabilityVersion ?? 0)) throw deny('event-closed');
  return { grant, event };
}
function snapshotIn(event: Record<string, unknown>): string {
  if (!isObject(event.quizAssignment) || typeof event.quizAssignment.snapshotId !== 'string' || !event.quizAssignment.snapshotId) {
    throw new HttpsError('failed-precondition', 'Akce nemá připravený kvíz. Požádejte organizátora o kontrolu.');
  }
  return event.quizAssignment.snapshotId;
}
export const readRefereeEvent = onCall(options, async request => {
  if (isWarmupPing(request.data)) return warmupResponse();
  const data = record(request.data);
  const c = credential(data); await throttle(request);
  return db().runTransaction(async transaction => {
    const { grant, event } = await accessIn(transaction, c);
    const snapshotId = snapshotIn(event);
    const scoringEpoch = eventScoringEpoch(event.scoring);
    const meta = { title: String(event.title), label: String(grant.label), expiresAt: (grant.expiresAt as Timestamp).toDate().toISOString() };
    const root = db().doc('events/' + c.eventId);
    const registrations = await transaction.get(root.collection('registrations').where('status', '==', 'accepted').select('teamName', 'createdAt'));
    const teams = registrationOrder(registrations.docs).map(d => ({ id: d.id, name: String(d.data().teamName) }));
    const sync = data.sync === true;
    const shape = sync ? fingerprint([c.eventId, c.accessId, snapshotId, scoringEpoch, teams]) : undefined;
    const scores = await currentScores(transaction, root.collection('scores'), new Set(teams.map(team => team.id)), shape);
    let cursor: string | undefined;
    if (shape) {
      const previous = parseCursor(data.cursor);
      const metadata = fingerprint(meta);
      cursor = [shape, scores.version, metadata].join('.');
      if (previous && previous.shape === shape && previous.version <= scores.version) {
        const changed = previous.version === scores.version ? [] : scores.rows.filter(row => row.version > previous.version).map(row => row.score);
        return { sync: changed.length ? 'delta' : 'unchanged', cursor, scores: changed, ...(previous.metadata !== metadata ? meta : {}) };
      }
    }
    const snapshot = db().doc(`quizSnapshots/${snapshotId}`);
    const rounds = await transaction.get(snapshot.collection('rounds').orderBy('position'));
    const counts = await snapshotRoundQuestionCounts(transaction, snapshot.collection('slides'), rounds.docs);
    return { eventId: c.eventId, ...meta, snapshotId, scoringEpoch,
      rounds: rounds.docs.map(d => ({ id: d.id, title: String(d.data().title ?? 'Kolo'), questionCount: counts.get(d.id)! })),
      teams, scores: scores.rows.map(row => row.score), ...(cursor ? { sync: 'full', cursor } : {}) };
  });
});
export const readRefereeHistory = onCall(options, async request => {
  const c = credential(request.data), data = record(request.data), teamId = id(data, 'teamId'), roundId = id(data, 'roundId'); await throttle(request);
  return db().runTransaction(async transaction => {
    const { event } = await accessIn(transaction, c);
    const team = (await transaction.get(db().doc(`events/${c.eventId}/registrations/${teamId}`))).data();
    if (!team || team.eventId !== c.eventId || team.status !== 'accepted') throw new HttpsError('failed-precondition', 'Tým už není na soupisce přijatých týmů.');
    const round = await transaction.get(db().doc(`quizSnapshots/${snapshotIn(event)}/rounds/${roundId}`)); if (!round.exists) throw new HttpsError('failed-precondition', 'Kolo v připraveném kvízu neexistuje.');
    const history = await transaction.get(db().collection(`events/${c.eventId}/scores/${scoreHash([teamId, roundId])}/history`).orderBy('revision', 'desc').limit(100));
    return history.docs.map(d => { const h = d.data(); return { revision: h.revision as number, halfPoints: h.halfPoints as number | null, previousHalfPoints: h.previousHalfPoints as number | null, reason: String(h.reason), createdAt: (h.createdAt as Timestamp).toDate().toISOString(), actorLabel: typeof h.actorLabel === 'string' ? h.actorLabel : 'Pořadatel' }; });
  });
});
export const saveRefereeScore = onCall(options, async request => {
  const data = record(request.data), c = credential(data.credential); await throttle(request);
  if (isObject(data.score) && 'scores' in data.score) {
    if (Object.keys(data).some(key => !['credential', 'score'].includes(key))) throw new HttpsError('invalid-argument', 'Unsupported round request.');
    const input = parseRoundScoreRequest(data.score); if (input.eventId !== c.eventId) throw new HttpsError('invalid-argument', 'Body patří k jiné akci než odkaz rozhodčího.');
    return commitRoundScores(input, async transaction => {
      const { grant } = await accessIn(transaction, c);
      return { key: 'referee:' + c.accessId, audit: { actorAccessId: c.accessId, actorLabel: String(grant.label) } };
    });
  }
  const input = parseScoreRequest(data.score); if (input.eventId !== c.eventId) throw new HttpsError('invalid-argument', 'Body patří k jiné akci než odkaz rozhodčího.');
  return commitScore(input, async transaction => {
    const { grant } = await accessIn(transaction, c); return { key: 'referee:' + c.accessId, audit: { actorAccessId: c.accessId, actorLabel: String(grant.label) } };
  });
});
