import { assertCapability, assertEventOperational } from '../events/guards.js';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { eventOperational, scopeAllows, type Membership } from '@filmovy-kviz/quiz-domain';
import { accessActor, authorize, freshIdentity, securedOnCall, runAccessTransaction } from '../access/authorization.js';
import { getFirestore, Timestamp, type Transaction } from 'firebase-admin/firestore';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { isObject } from '../events/validation.js';
import { commitScore, commitRoundScores, scoreHash } from '../scoring/core.js';
import { parseScoreRequest, parseRoundScoreRequest } from '../scoring/validation.js';

const options = { region: 'europe-west1', cors: true, maxInstances: 10 };
const db = () => getFirestore();
const deny = () => new HttpsError('permission-denied', 'Referee access expired or revoked.');
const digest = (value: string) => createHash('sha256').update('referee-access-v1:' + value).digest('hex');
function record(value: unknown): Record<string, unknown> { if (!isObject(value)) throw new HttpsError('invalid-argument', 'Malformed request.'); return value; }
function id(data: Record<string, unknown>, field: string): string { const value = data[field]; if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,150}$/u.test(value)) throw new HttpsError('invalid-argument', 'Invalid identifier.'); return value; }
function revision(data: Record<string, unknown>): number { if (!Number.isSafeInteger(data.expectedVersion) || (data.expectedVersion as number) < 1) throw new HttpsError('invalid-argument', 'Invalid access version.'); return data.expectedVersion as number; }
function expiry(data: Record<string, unknown>): Timestamp { const value = typeof data.expiresAt === 'string' ? Date.parse(data.expiresAt) : NaN; const now = Date.now(); if (!Number.isFinite(value) || value <= now || value > now + 30 * 86400000) throw new HttpsError('invalid-argument', 'Expiry must be within the next 30 days.'); return Timestamp.fromMillis(value); }
function label(data: Record<string, unknown>): string { const value = data.label; if (typeof value !== 'string' || !value.trim() || value.trim().length > 80 || /[\p{Cc}\p{Cf}]/u.test(value)) throw new HttpsError('invalid-argument', 'Invalid access label.'); return value.trim(); }
function organizer(request: CallableRequest) {
  return Promise.resolve(accessActor(request.auth).uid);
}
async function eventIn(transaction: Transaction, eventId: string, referee = false) {
  const event = (await transaction.get(db().doc('events/' + eventId))).data();
  if (referee && (!event || !eventOperational(event))) throw deny();
  assertEventOperational(event);
  if (!event || (referee ? !['ready', 'live', 'finalizing'].includes(event.lifecycleStatus as string) : ['archived', 'cancelled', 'completed'].includes(event.lifecycleStatus as string))) throw referee ? deny() : new HttpsError('failed-precondition', 'Event is unavailable.');
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
    const next = { ...old, capabilityVersion: event.capabilityVersion ?? 0, version: expectedVersion + 1, revoked: data.action === 'revoke', keyHash: data.action === 'rotate' ? digest(secret) : null, expiresAt: nextExpiry ?? (old.expiresAt as Timestamp), ...(data.action === 'rotate' ? { issuedBy: uid } : {}), updatedBy: uid, updatedAt: Timestamp.now() };
    transaction.set(ref, next); return { ...metadata(accessId, next), key: data.action === 'rotate' ? secret : null };
  });
});

export interface RefereeCredential { eventId: string; accessId: string; key: string }
function credential(value: unknown): RefereeCredential {
  const data = record(value), eventId = id(data, 'eventId'), accessId = id(data, 'accessId');
  if (typeof data.key !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(data.key)) throw deny();
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
  if (!grant || grant.revoked || !(grant.expiresAt instanceof Timestamp) || grant.expiresAt.toMillis() <= Date.now() || typeof grant.keyHash !== 'string' || grant.keyHash.length !== supplied.length || !timingSafeEqual(Buffer.from(grant.keyHash), supplied)) throw deny();
  const event = await eventIn(transaction, c.eventId, true);
  assertCapability(event, grant);
  // Delegated bearer access cannot outlive the issuer's current ability to grant scoring.
  // Legacy grants retain their original issuer; rotation explicitly transfers issuance.
  const issuerUid: unknown = grant.issuedBy ?? grant.createdBy;
  if (typeof issuerUid !== 'string' || !issuerUid || issuerUid.includes('/')) throw deny();
  const issuer = (await transaction.get(db().doc(`memberships/${issuerUid}`))).data() as Membership | undefined;
  if (!issuer || issuer.uid !== issuerUid || issuer.status !== 'active'
    || !Array.isArray(issuer.permissions) || !issuer.permissions.includes('event.manage') || !issuer.permissions.includes('event.score')
    || !scopeAllows(issuer.events, c.eventId, issuerUid, event.createdBy)) throw deny();
  const identity = await getAuth().getUser(issuerUid).catch(() => null);
  if (!identity || identity.disabled || !identity.emailVerified) throw deny();
  return { grant, event };
}
export const readRefereeEvent = onCall(options, async request => {
  const c = credential(request.data); await throttle(request);
  if (request.auth) await freshIdentity(request.auth);
  return db().runTransaction(async transaction => {
    if (request.auth) await authorize(request.auth, ['event.read'], { kind: 'event', id: c.eventId }, transaction);
    const { grant, event } = await accessIn(transaction, c);
    const snapshotId = record(event.quizAssignment).snapshotId;
    if (typeof snapshotId !== 'string') throw deny();
    const rounds = await transaction.get(db().collection(`quizSnapshots/${snapshotId}/rounds`).orderBy('position'));
    const teams = await transaction.get(db().collection(`events/${c.eventId}/registrations`).where('status', '==', 'accepted'));
    const scores = await transaction.get(db().collection(`events/${c.eventId}/scores`));
    const accepted = new Set(teams.docs.map(d => d.id));
    return { eventId: c.eventId, title: String(event.title), label: String(grant.label), snapshotId,
      rounds: rounds.docs.map(d => ({ id: d.id, title: String(d.data().title ?? 'Kolo') })),
      teams: teams.docs.map(d => ({ id: d.id, name: String(d.data().teamName) })),
      scores: scores.docs.filter(d => accepted.has(d.data().teamId as string)).map(d => { const s = d.data(); return { teamId: s.teamId as string, roundId: s.roundId as string, halfPoints: s.halfPoints as number | null, revision: s.revision as number }; }) };
  });
});
export const readRefereeHistory = onCall(options, async request => {
  const c = credential(request.data), data = record(request.data), teamId = id(data, 'teamId'), roundId = id(data, 'roundId'); await throttle(request);
  if (request.auth) await freshIdentity(request.auth);
  return db().runTransaction(async transaction => {
    if (request.auth) await authorize(request.auth, ['event.read'], { kind: 'event', id: c.eventId }, transaction);
    const { event } = await accessIn(transaction, c);
    const team = (await transaction.get(db().doc(`events/${c.eventId}/registrations/${teamId}`))).data();
    if (!team || team.eventId !== c.eventId || team.status !== 'accepted') throw deny();
    const round = await transaction.get(db().doc(`quizSnapshots/${record(event.quizAssignment).snapshotId as string}/rounds/${roundId}`)); if (!round.exists) throw deny();
    const history = await transaction.get(db().collection(`events/${c.eventId}/scores/${scoreHash([teamId, roundId])}/history`).orderBy('revision', 'desc').limit(100));
    return history.docs.map(d => { const h = d.data(); return { revision: h.revision as number, halfPoints: h.halfPoints as number | null, previousHalfPoints: h.previousHalfPoints as number | null, reason: String(h.reason), createdAt: (h.createdAt as Timestamp).toDate().toISOString(), actorLabel: typeof h.actorLabel === 'string' ? h.actorLabel : 'Pořadatel' }; });
  });
});
export const saveRefereeScore = onCall(options, async request => {
  const data = record(request.data), c = credential(data.credential); await throttle(request);
  if (request.auth) await freshIdentity(request.auth);
  if (isObject(data.score) && 'scores' in data.score) {
    if (Object.keys(data).some(key => !['credential', 'score'].includes(key))) throw new HttpsError('invalid-argument', 'Unsupported round request.');
    const input = parseRoundScoreRequest(data.score); if (input.eventId !== c.eventId) throw deny();
    return commitRoundScores(input, async transaction => {
      if (request.auth) await authorize(request.auth, ['event.score'], { kind: 'event', id: c.eventId }, transaction);
      const { grant } = await accessIn(transaction, c);
      return { key: 'referee:' + c.accessId, audit: { actorAccessId: c.accessId, actorLabel: String(grant.label) } };
    });
  }
  const input = parseScoreRequest(data.score); if (input.eventId !== c.eventId) throw deny();
  return commitScore(input, async transaction => {
    if (request.auth) await authorize(request.auth, ['event.score'], { kind: 'event', id: c.eventId }, transaction);
    const { grant } = await accessIn(transaction, c); return { key: 'referee:' + c.accessId, audit: { actorAccessId: c.accessId, actorLabel: String(grant.label) } };
  });
});
