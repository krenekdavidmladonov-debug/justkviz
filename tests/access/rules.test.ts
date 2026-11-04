import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, Timestamp, query, where, documentId } from 'firebase/firestore';
import { ref, uploadBytes, getBytes } from 'firebase/storage';
import { beforeAll, afterAll, beforeEach, expect, test } from 'vitest';
import { permissions, rolePresets, type Membership } from '../../packages/quiz-domain/src/access.js';

let env: RulesTestEnvironment;
const member = (uid: string, overrides: Partial<Membership> = {}): Membership => ({ uid, role: 'creator', status: 'active', email: `${uid}@example.test`, displayName: uid, version: 1, sessionValidAfter: 0,
  permissions: [...rolePresets.creator], quizzes: { mode: 'selected', ids: ['a'] }, events: { mode: 'selected', ids: ['event-a'] }, ...overrides });
const client = (uid: string, claims = {}) => env.authenticatedContext(uid, { email_verified: true, auth_time: 1000, ...claims });
beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-justkviz-access',
    firestore: { host: '127.0.0.1', port: 8188, rules: readFileSync('tests/access/firestore.candidate.rules', 'utf8') },
    storage: { host: '127.0.0.1', port: 9299, rules: readFileSync('tests/access/storage.candidate.rules', 'utf8') } });
});
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore(); await env.clearStorage();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (const id of ['a', 'b']) {
      await setDoc(doc(db, `quizzes/${id}`), { title: id, createdBy: id === 'a' ? 'creator' : 'other' });
      await setDoc(doc(db, `quizzes/${id}/slides/question`), { correctAnswer: 'PRIVATE', moderatorNote: 'NOTE', legacy: { raw: { secret: 'RAW' } } });
      await setDoc(doc(db, `events/event-${id}`), { createdBy: 'owner' });
      await setDoc(doc(db, `events/event-${id}/scores/pair`), { halfPoints: 2 });
      await setDoc(doc(db, `events/event-${id}/registrations/team`), { contactEmail: 'PRIVATE@example.test' });
      await setDoc(doc(db, `sessions/session-${id}`), { eventId: `event-${id}`, quizId: id });
    }
    await setDoc(doc(db, 'quizSnapshots/snapshot'), { quizId: 'a' });
    await setDoc(doc(db, 'quizSnapshots/snapshot/slides/question'), { correctAnswer: 'PRIVATE' });
    await setDoc(doc(db, 'publicSessions/known'), { title: 'Public question' });
    await setDoc(doc(db, 'publicEvents/listed'), { title: 'Public event', registrationPublished: true });
    await setDoc(doc(db, 'memberships/creator'), member('creator'));
    await setDoc(doc(db, 'memberships/viewer'), member('viewer', { role: 'viewer', permissions: [...rolePresets.viewer] }));
    await setDoc(doc(db, 'memberships/owner'), member('owner', { role: 'owner', permissions: [...permissions], quizzes: { mode: 'all', ids: [] }, events: { mode: 'all', ids: [] } }));
  });
});
test('legacy claims and self-created identities cannot read or write private data', async () => {
  for (const uid of ['legacy-admin', 'new-user']) {
    const db = client(uid, { role: 'admin' }).firestore();
    await assertFails(getDoc(doc(db, 'quizzes/a')));
    await assertFails(setDoc(doc(db, `memberships/${uid}`), member(uid)));
    await assertFails(setDoc(doc(db, `users/${uid}`), { role: 'owner' }));
    await assertFails(setDoc(doc(db, 'media/legacy'), { public: true }));
  }
});
test('creator A has a valid scoped query; B and the unbounded collection query are denied', async () => {
  const db = client('creator').firestore();
  await assertSucceeds(getDoc(doc(db, 'quizzes/a/slides/question')));
  await assertSucceeds(getDocs(query(collection(db, 'quizzes'), where(documentId(), 'in', ['a']))));
  await assertFails(getDoc(doc(db, 'quizzes/b/slides/question')));
  await assertFails(getDocs(collection(db, 'quizzes')));
  await assertFails(updateDoc(doc(db, 'quizzes/a'), { title: 'Forged' }));
});
test('viewer never downloads answer, note, raw or contact documents, even for assigned content', async () => {
  const db = client('viewer', { role: 'admin' }).firestore();
  for (const path of ['quizzes/a', 'quizzes/a/slides/question', 'quizSnapshots/snapshot/slides/question', 'events/event-a', 'events/event-a/registrations/team']) await assertFails(getDoc(doc(db, path)));
  await assertSucceeds(getDoc(doc(db, 'events/event-a/scores/pair')));
  await assertFails(getDoc(doc(db, 'events/event-b/scores/pair')));
  await assertSucceeds(getDoc(doc(db, 'sessions/session-a')));
  await assertFails(getDoc(doc(db, 'sessions/session-b')));
  await assertFails(updateDoc(doc(db, 'events/event-a/scores/pair'), { halfPoints: 100 }));
});
test('suspension, scope removal and session cutoff affect an already issued token', async () => {
  const db = client('creator').firestore();
  await assertSucceeds(getDoc(doc(db, 'quizzes/a')));
  for (const changes of [{ status: 'suspended' }, { quizzes: { mode: 'selected', ids: [] } }, { sessionValidAfter: 1000 }]) {
    await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'memberships/creator'), { ...member('creator'), ...changes }));
    await assertFails(getDoc(doc(db, 'quizzes/a')));
    await assertSucceeds(getDoc(doc(db, 'memberships/creator')));
  }
});
test('none and empty selected fail closed; own uses immutable createdBy and verified identity', async () => {
  for (const scope of [{ mode: 'none', ids: [] }, { mode: 'selected', ids: [] }]) {
    await env.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), 'memberships/creator'), { quizzes: scope }));
    await assertFails(getDoc(doc(client('creator').firestore(), 'quizzes/a')));
  }
  await env.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), 'memberships/creator'), { quizzes: { mode: 'own', ids: [] } }));
  await assertSucceeds(getDoc(doc(client('creator').firestore(), 'quizzes/a')));
  await assertFails(getDoc(doc(client('creator').firestore(), 'quizzes/b')));
  await assertFails(getDoc(doc(client('creator', { email_verified: false }).firestore(), 'quizzes/a')));
});
test('invitations, access audit and owner fields have no browser write path', async () => {
  const db = client('owner').firestore();
  for (const path of ['memberships/owner', 'accessInvites/token', 'accessAudit/audit', 'accessControl/state', 'users/owner']) {
    await assertFails(setDoc(doc(db, path), { role: 'owner' }));
  }
  await assertFails(getDocs(collection(db, 'accessInvites')));
  await assertFails(getDocs(collection(db, 'accessAudit')));
});
test('legacy snapshots require mediated reads; owned snapshots respect trash and full permissions', async () => {
  const ownerDb = client('owner').firestore();
  for (const path of ['events/event-a', 'events/event-a/registrations/team']) await assertSucceeds(getDoc(doc(ownerDb, path)));
  await assertFails(getDoc(doc(ownerDb, 'quizSnapshots/snapshot/slides/question')));
  await env.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), 'quizSnapshots/snapshot'), { eventId: 'event-a' }));
  await assertFails(getDoc(doc(ownerDb, 'quizSnapshots/snapshot/slides/question')));
  await env.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), 'events/event-a'), { quizAssignment: { snapshotId: 'snapshot' } }));
  await assertSucceeds(getDoc(doc(ownerDb, 'quizSnapshots/snapshot/slides/question')));
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'memberships/moderator'), member('moderator', { role: 'moderator', permissions: [...rolePresets.moderator], quizzes: { mode: 'none', ids: [] } })));
  const moderatorDb = client('moderator').firestore();
  await assertSucceeds(getDoc(doc(moderatorDb, 'sessions/session-a')));
  for (const path of ['quizzes/a', 'quizSnapshots/snapshot/slides/question', 'events/event-a/registrations/team']) await assertFails(getDoc(doc(moderatorDb, path)));
  await env.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), 'events/event-a'), { disposition: 'trash' }));
  for (const path of ['events/event-a','events/event-a/registrations/team','events/event-a/scores/pair','sessions/session-a','quizSnapshots/snapshot/slides/question']) await assertFails(getDoc(doc(ownerDb, path)));
});
test('relocking revokes direct historical snapshot get and list without granting source or other event access', async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'memberships/event-reader'), member('event-reader', {
      role: 'viewer', permissions: ['event.read', 'event.contacts', 'event.answers.read', 'event.notes.read'],
      quizzes: { mode: 'none', ids: [] },
    }));
    for (const [snapshotId, eventId] of [['s1', 'event-a'], ['s2', 'event-a'], ['other', 'event-b']]) {
      await setDoc(doc(db, `quizSnapshots/${snapshotId}`), { eventId, quizId: 'a' });
      await setDoc(doc(db, `quizSnapshots/${snapshotId}/slides/question`), {
        correctAnswer: `PRIVATE-${snapshotId}`, moderatorNote: 'NOTE', legacy: { raw: 'RAW' },
      });
      await setDoc(doc(db, `quizSnapshots/${snapshotId}/rounds/round`), { title: 'Round' });
    }
    await updateDoc(doc(db, 'events/event-a'), { quizAssignment: { snapshotId: 's1' } });
    await updateDoc(doc(db, 'events/event-b'), { quizAssignment: { snapshotId: 'other' } });
  });
  const db = client('event-reader').firestore();
  await assertFails(getDoc(doc(db, 'quizzes/a/slides/question')));
  const original = await assertSucceeds(getDoc(doc(db, 'quizSnapshots/s1/slides/question')));
  expect(original.get('correctAnswer')).toBe('PRIVATE-s1');
  await assertSucceeds(getDocs(collection(db, 'quizSnapshots/s1/slides')));
  await env.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), 'events/event-a'), { quizAssignment: { snapshotId: 's2' } }));
  for (const suffix of ['', '/slides/question', '/rounds/round']) await assertSucceeds(getDoc(doc(db, `quizSnapshots/s2${suffix}`)));
  const current = await assertSucceeds(getDocs(collection(db, 'quizSnapshots/s2/slides')));
  expect(current.docs[0]?.get('correctAnswer')).toBe('PRIVATE-s2');
  await assertSucceeds(getDocs(collection(db, 'quizSnapshots/s2/rounds')));
  for (const snapshotId of ['s1', 'other']) {
    for (const suffix of ['', '/slides/question', '/rounds/round']) await assertFails(getDoc(doc(db, `quizSnapshots/${snapshotId}${suffix}`)));
    for (const child of ['slides', 'rounds']) await assertFails(getDocs(collection(db, `quizSnapshots/${snapshotId}/${child}`)));
  }
  for (const assignment of [{}, { quizAssignment: null }, { quizAssignment: {} }]) {
    await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'events/event-a'), { createdBy: 'owner', ...assignment }));
    await assertFails(getDoc(doc(db, 'quizSnapshots/s2')));
    await assertFails(getDoc(doc(db, 'quizSnapshots/s2/slides/question')));
    await assertFails(getDocs(collection(db, 'quizSnapshots/s2/slides')));
  }
});
test('anonymous projector and public events remain available with private writes denied', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(db, 'publicSessions/known')));
  await assertSucceeds(getDocs(query(collection(db, 'publicEvents'), where('registrationPublished', '==', true))));
  await assertFails(getDocs(collection(db, 'publicEvents')));
  await assertFails(getDocs(collection(db, 'publicSessions')));
  await assertFails(setDoc(doc(db, 'publicSessions/known'), { revealedAnswer: 'Forged' }));
});
test('Storage enforces current membership, scope and upload grant version', async () => {
  const bytes = new Uint8Array([137, 80, 78, 71]);
  async function grant(assetId: string) {
    await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), `quizzes/a/mediaAssets/${assetId}`), {
      quizId: 'a', assetId, createdBy: 'creator', membershipVersion: 1, status: 'uploading', uploadExpiresAt: Timestamp.fromMillis(Date.now() + 60000), kind: 'image', contentType: 'image/png', size: bytes.length,
    }));
    return ref(client('creator').storage(), `quiz-assets/a/${assetId}/source`);
  }
  const first = await grant('first');
  await assertSucceeds(uploadBytes(first, bytes, { contentType: 'image/png' }));
  await assertFails(getBytes(first));
  const stale = await grant('stale');
  await env.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), 'memberships/creator'), { version: 2 }));
  await assertFails(uploadBytes(stale, bytes, { contentType: 'image/png' }));
  await env.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), 'memberships/creator'), { version: 1, status: 'suspended' }));
  await assertFails(uploadBytes(stale, bytes, { contentType: 'image/png' }));
});
