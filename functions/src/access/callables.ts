import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp, type Transaction } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { canDelegate, grantErrors, permissions, roleLabels, type AccessGrant, type AccessScope, type Membership } from '@filmovy-kviz/quiz-domain';
import { authorize, freshIdentity, identity, membership } from './authorization.js';

const options = { region: 'europe-west1', cors: true, maxInstances: 10 };
const db = () => getFirestore();
const deny = () => new HttpsError('permission-denied', 'Tuto změnu přístupu nemůžete provést.');
const hash = (token: string) => createHash('sha256').update('justkviz-invite-v1:' + token).digest('hex');
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpsError('invalid-argument', 'Neplatný požadavek.');
  return value as Record<string, unknown>;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,150}$/u.test(value)) throw new HttpsError('invalid-argument', 'Neplatný identifikátor.');
  return value;
}
function scope(value: unknown): AccessScope {
  const data = object(value);
  if (!['none', 'own', 'selected', 'all'].includes(String(data.mode)) || !Array.isArray(data.ids) || data.ids.length > 500 || Object.keys(data).some(k => !['mode', 'ids'].includes(k))) throw new HttpsError('invalid-argument', 'Neplatný rozsah.');
  const ids = [...new Set(data.ids.map(id))];
  if (data.mode !== 'selected' && ids.length) throw new HttpsError('invalid-argument', 'Identifikátory patří jen do vybraného rozsahu.');
  return { mode: data.mode as AccessScope['mode'], ids };
}
export function parseAccessGrant(value: unknown): AccessGrant {
  const data = object(value);
  const requested: unknown[] = Array.isArray(data.permissions) ? data.permissions as unknown[] : [];
  if (typeof data.role !== 'string' || !Object.hasOwn(roleLabels, data.role) || !Array.isArray(data.permissions)
    || requested.some(p => typeof p !== 'string' || !permissions.some(known => known === p)) || Object.keys(data).some(k => !['role', 'permissions', 'quizzes', 'events'].includes(k))) throw new HttpsError('invalid-argument', 'Neplatná oprávnění.');
  const grant: AccessGrant = { role: data.role as AccessGrant['role'], permissions: [...new Set(requested)] as AccessGrant['permissions'], quizzes: scope(data.quizzes), events: scope(data.events) };
  const errors = grantErrors(grant);
  if (errors.length) throw new HttpsError('invalid-argument', errors.join(' '));
  return grant;
}
async function serializeChanges(tx: Transaction, requireActivation = false) {
  const ref = db().doc('accessControl/state');
  const state = (await tx.get(ref)).data();
  if (requireActivation && state?.collaborationEnabled !== true) throw new HttpsError('failed-precondition', 'Pozvánky budou dostupné po dokončení bezpečné aktivace modulu.');
  return () => tx.set(ref, { revision: Number(state?.revision ?? 0) + 1, updatedAt: Timestamp.now() }, { merge: true });
}
function audit(tx: Transaction, actorUid: string, kind: string, targetId: string, changes: Record<string, unknown>) {
  tx.create(db().collection('accessAudit').doc(), { actorUid, kind, targetId, changes, at: Timestamp.now() });
}
async function delegate(tx: Transaction, actor: Membership, grant: AccessGrant) {
  const resolved = { ...actor };
  for (const key of ['quizzes', 'events'] as const) {
    if (actor[key].mode !== 'own' || grant[key].mode !== 'selected' || !grant[key].ids.length) continue;
    const resources = await tx.getAll(...grant[key].ids.map(resourceId => db().doc(`${key}/${resourceId}`)));
    resolved[key] = { mode: 'selected', ids: resources.filter(doc => doc.get('createdBy') === actor.uid).map(doc => doc.id) };
  }
  if (!canDelegate(resolved, grant)) throw deny();
}
function grantOf(member: Membership): AccessGrant { return { role: member.role, permissions: member.permissions, quizzes: member.quizzes, events: member.events }; }
function version(data: Record<string, unknown>, current: Record<string, unknown>) {
  if (!Number.isSafeInteger(data.expectedVersion) || data.expectedVersion !== current.version) throw new HttpsError('aborted', 'Přístup se změnil. Načtěte jej znovu.');
}
export const getMyAccess = onCall(options, async request => {
  const user = await freshIdentity(request.auth);
  const member = await membership(request.auth).catch(error => { if (error instanceof HttpsError && error.code === 'permission-denied') return null; throw error; });
  return { member, profile: { uid: user.uid, displayName: user.displayName ?? '', email: user.email ?? '', emailVerified: user.emailVerified, providers: user.providerData.map(p => p.providerId) } };
});
export const listAccessUsers = onCall(options, async request => {
  await freshIdentity(request.auth);
  await authorize(request.auth, ['users.manage']);
  const [members, invites, control] = await Promise.all([db().collection('memberships').limit(501).get(), db().collection('accessInvites').limit(501).get(), db().doc('accessControl/state').get()]);
  if (members.size > 500 || invites.size > 500) throw new HttpsError('resource-exhausted', 'Seznam je příliš velký.');
  const users = [];
  // Auth returns identity metadata; hashes and credentials are never requested or returned.
  for (let offset = 0; offset < members.size; offset += 100) {
    const batch = members.docs.slice(offset, offset + 100);
    const profiles = await getAuth().getUsers(batch.map(d => ({ uid: d.id })));
    const byId = new Map(profiles.users.map(u => [u.uid, u]));
    users.push(...batch.map(d => { const p = byId.get(d.id); return { ...d.data(), uid: d.id, email: p?.email ?? '', displayName: p?.displayName ?? '', lastLoginAt: p?.metadata.lastSignInTime ?? null, emailVerified: p?.emailVerified ?? false }; }));
  }
  await authorize(request.auth, ['users.manage']);
  return { users, invitations: invites.docs.map(d => invitationMetadata(d.id, d.data())), collaborationEnabled: control.get('collaborationEnabled') === true };
});
function invitationMetadata(inviteId: string, data: Record<string, unknown>) {
  return { inviteId, email: data.email, grant: data.grant, version: data.version, createdBy: data.createdBy,
    status: data.status === 'invited' && Number(data.expiresAt) <= Date.now() ? 'expired' : data.status, expiresAt: data.expiresAt };
}
export const createAccessInvitation = onCall(options, async request => {
  await freshIdentity(request.auth);
  const data = object(request.data), grant = parseAccessGrant(data.grant);
  if (typeof data.email !== 'string' || data.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(data.email)) throw new HttpsError('invalid-argument', 'Zadejte platný e-mail.');
  const email = data.email.trim().toLowerCase(), inviteId = randomBytes(16).toString('hex'), token = randomBytes(32).toString('base64url');
  return db().runTransaction(async tx => {
    const actor = await authorize(request.auth, ['users.manage'], undefined, tx);
    await delegate(tx, actor, grant);
    const commit = await serializeChanges(tx, true);
    const duplicate = await tx.get(db().collection('accessInvites').where('email', '==', email).where('status', '==', 'invited').limit(1));
    if (!duplicate.empty) throw new HttpsError('already-exists', 'Pro tento e-mail už existuje pozvánka. Obnovte ji nebo odvolejte.');
    const invitation = { email, grant, version: 1, status: 'invited', tokenHash: hash(token), expiresAt: Date.now() + 7 * 86400000, createdBy: actor.uid, createdAt: Timestamp.now() };
    tx.create(db().doc(`accessInvites/${inviteId}`), invitation);
    audit(tx, actor.uid, 'invitation-created', inviteId, { grant }); commit();
    return { ...invitationMetadata(inviteId, invitation), token };
  });
});
export const changeAccessInvitation = onCall(options, async request => {
  await freshIdentity(request.auth);
  const data = object(request.data), inviteId = id(data.inviteId);
  if (!['revoke', 'reissue'].includes(String(data.action))) throw new HttpsError('invalid-argument', 'Neplatná akce.');
  const token = randomBytes(32).toString('base64url');
  return db().runTransaction(async tx => {
    const actor = await authorize(request.auth, ['users.manage'], undefined, tx);
    const ref = db().doc(`accessInvites/${inviteId}`), current = (await tx.get(ref)).data();
    if (!current) throw deny();
    await delegate(tx, actor, parseAccessGrant(current.grant)); version(data, current);
    if (current.status === 'accepted') throw new HttpsError('failed-precondition', 'Pozvánka už byla přijata. Upravte členství.');
    const commit = await serializeChanges(tx, data.action === 'reissue');
    const next = { ...current, status: data.action === 'revoke' ? 'revoked' : 'invited', tokenHash: data.action === 'revoke' ? null : hash(token),
      version: Number(current.version) + 1, expiresAt: Date.now() + 7 * 86400000, createdBy: actor.uid, updatedAt: Timestamp.now() };
    tx.set(ref, next); audit(tx, actor.uid, `invitation-${String(data.action)}`, inviteId, { version: next.version }); commit();
    return { ...invitationMetadata(inviteId, next), token: data.action === 'reissue' ? token : null };
  });
});
export const acceptAccessInvitation = onCall(options, async request => {
  const user = await freshIdentity(request.auth), data = object(request.data), inviteId = id(data.inviteId);
  if (typeof data.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(data.token)) throw deny();
  if (!user.email || user.email.toLowerCase() !== String(request.auth?.token.email).toLowerCase()) throw deny();
  const digest = hash(data.token);
  return db().runTransaction(async tx => {
    const ref = db().doc(`accessInvites/${inviteId}`), invitation = (await tx.get(ref)).data();
    const memberRef = db().doc(`memberships/${user.uid}`), current = await tx.get(memberRef);
    if (!invitation || invitation.status !== 'invited' || Number(invitation.expiresAt) <= Date.now() || invitation.email !== user.email!.toLowerCase()
      || typeof invitation.tokenHash !== 'string' || invitation.tokenHash.length !== digest.length
      || !timingSafeEqual(Buffer.from(invitation.tokenHash), Buffer.from(digest))) throw deny();
    if (current.exists) throw new HttpsError('failed-precondition', 'Účet už má členství. Správce musí upravit stávající přístup.');
    const issuerUid = id(invitation.createdBy);
    const issuer = (await tx.get(db().doc(`memberships/${issuerUid}`))).data() as Membership | undefined;
    const grant = parseAccessGrant(invitation.grant);
    if (!issuer) throw deny(); await delegate(tx, issuer, grant);
    const issuerIdentity = await getAuth().getUser(issuerUid).catch(() => null);
    if (!issuerIdentity || issuerIdentity.disabled || !issuerIdentity.emailVerified) throw deny();
    const commit = await serializeChanges(tx, true);
    const member: Membership = { ...grant, uid: user.uid, email: user.email!, displayName: user.displayName ?? '', status: 'active', version: 1, sessionValidAfter: 0 };
    tx.create(memberRef, { ...member, createdAt: Timestamp.now(), createdBy: issuer.uid });
    tx.update(ref, { status: 'accepted', tokenHash: null, acceptedBy: user.uid, acceptedAt: Timestamp.now(), version: Number(invitation.version) + 1 });
    audit(tx, user.uid, 'invitation-accepted', user.uid, { inviteId, grant }); commit();
    return { member };
  });
});
export const updateAccessMembership = onCall(options, async request => {
  await freshIdentity(request.auth);
  const data = object(request.data), uid = id(data.uid), grant = parseAccessGrant(data.grant);
  if (!['active', 'suspended'].includes(String(data.status))) throw new HttpsError('invalid-argument', 'Neplatný stav.');
  return db().runTransaction(async tx => {
    const actor = await authorize(request.auth, ['users.manage'], undefined, tx);
    if (uid === actor.uid) throw new HttpsError('permission-denied', 'Vlastní oprávnění musí změnit jiný oprávněný správce.');
    const ref = db().doc(`memberships/${uid}`), current = (await tx.get(ref)).data() as Membership | undefined;
    if (!current) throw deny(); version(data, current as unknown as Record<string, unknown>);
    // Becoming owner is exclusively an operator-reviewed transfer; no browser endpoint can create one.
    await delegate(tx, actor, grant);
    if (current.role === 'owner') {
      if (actor.role !== 'owner') throw deny();
      const owners = await tx.get(db().collection('memberships').where('role', '==', 'owner').where('status', '==', 'active'));
      if (owners.size <= 1) throw new HttpsError('failed-precondition', 'Posledního vlastníka nelze odebrat ani pozastavit.');
    } else await delegate(tx, actor, grantOf(current));
    const commit = await serializeChanges(tx), nextVersion = current.version + 1;
    tx.update(ref, { ...grant, status: data.status, version: nextVersion, updatedBy: actor.uid, updatedAt: Timestamp.now() });
    audit(tx, actor.uid, 'membership-changed', uid, { before: grantOf(current), after: grant, previousStatus: current.status, status: data.status, version: nextVersion }); commit();
    return { version: nextVersion };
  });
});
function auditTime(value: unknown): string | null {
  // Accept supported legacy ISO strings without rewriting history or inventing a time.
  const date = value instanceof Timestamp ? value.toDate()
    : typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
export const listAccessAudit = onCall(options, async request => {
  await freshIdentity(request.auth); await authorize(request.auth, ['users.manage']);
  const entries = await db().collection('accessAudit').orderBy('at', 'desc').limit(100).get();
  await authorize(request.auth, ['users.manage']);
  return entries.docs.map(d => ({ id: d.id, ...d.data(), at: auditTime(d.get('at')) }));
});
export const revokeMySessions = onCall(options, async request => {
  const { uid } = identity(request.auth);
  const authTime = Number(request.auth?.token.auth_time);
  if (!Number.isFinite(authTime) || Date.now() / 1000 - authTime > 300) throw new HttpsError('unauthenticated', 'Z bezpečnostních důvodů zadejte znovu heslo.');
  const user = await getAuth().getUser(uid);
  if (user.disabled || (user.tokensValidAfterTime && authTime < Math.floor(Date.parse(user.tokensValidAfterTime) / 1000))) throw deny();
  const cutoff = Math.floor(Date.now() / 1000);
  await db().runTransaction(async tx => {
    const ref = db().doc(`memberships/${uid}`), current = (await tx.get(ref)).data();
    if (current && authTime <= Number(current.sessionValidAfter)) throw deny();
    if (current) tx.update(ref, { sessionValidAfter: cutoff, version: Number(current.version) + 1 });
    audit(tx, uid, 'sessions-revoked', uid, {});
  });
  await getAuth().revokeRefreshTokens(uid);
  return { revoked: true };
});
