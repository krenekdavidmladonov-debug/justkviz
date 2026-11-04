import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { editorIdentity } from '../e2e/editor-identity.mjs';
import { mediaSlide } from '../e2e/media-fixture.mjs';
import { permissions, rolePresets } from '../../packages/quiz-domain/lib/access.js';
import { requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';
export async function browserFixture() {
  const env = requireFullEmulatorEnvironment(process.env, 'Personal access browser fixture'), owner = await editorIdentity();
  const require = createRequire(new URL('../../functions/package.json', import.meta.url));
  const sdk = require('firebase-admin/app'), server = sdk.initializeApp({ projectId: env.projectId }, randomUUID()), auth = require('firebase-admin/auth').getAuth(server);
  const { Timestamp } = require('firebase-admin/firestore'), db = owner.db, prefix = 'browser-access-' + randomUUID(), paths = [], users = [];
  const ownerUser = await auth.getUserByEmail(owner.email); await db.doc(`memberships/${ownerUser.uid}`).update({ role: 'owner', permissions: [...permissions] });
  await db.doc('accessControl/state').set({ collaborationEnabled: true, revision: 0 });
  async function quiz(title) {
    const { quizId } = await owner.call('createQuiz', { title, requestId: randomUUID() }); paths.push(`quizzes/${quizId}`);
    let revision = 0;
    for (const kind of ['intro', 'round', 'free', 'recap', 'end']) {
      const result = await owner.call('createQuizSlide', { quizId, expectedRevision: revision, position: revision + 1, slide: mediaSlide(kind, { title: kind === 'round' ? 'První kolo' : kind === 'intro' ? title : '', text: kind === 'free' ? 'Otázka pro kolegu' : '', correctAnswer: kind === 'free' ? 'ANSWER_PRIVATE_BROWSER' : '', moderatorNote: kind === 'free' ? 'NOTE_PRIVATE_BROWSER' : '', ...(kind === 'free' ? { answerMode: 'open', authoringStatus: 'ready' } : {}) }) }); revision = result.revision;
    }
    return quizId;
  }
  const quizA = await quiz('Přidělený kvíz A'), quizB = await quiz('Nepřístupný kvíz B');
  async function event(title) {
    const created = await owner.call('createEvent', { expectedRevision: 0, event: { title, startsAt: '2031-10-20T17:00:00Z', timeZone: 'Europe/Prague', venue: { name: 'Syntetický sál', publicLocation: 'Praha' }, teamCapacity: 20, peopleCapacity: 120, teamSizeMin: 2, teamSizeMax: 4 } });
    const eventId = created.eventId; paths.push(`events/${eventId}`, `publicEvents/${eventId}`);
    await owner.call('lockEventQuiz', { eventId, quizId: quizA, expectedRevision: created.revision, expectedQuizRevision: 5, acknowledgeWarnings: true });
    const snapshotId = (await db.doc(`events/${eventId}`).get()).get('quizAssignment.snapshotId'); paths.push(`quizSnapshots/${snapshotId}`);
    await db.doc(`events/${eventId}/registrations/team`).set({ eventId, teamName: 'Testovací tým', memberCount: 2, status: 'accepted', source: 'manual', contactEmail: 'CONTACT_PRIVATE_BROWSER@example.test', createdAt: Timestamp.now(), updatedAt: Timestamp.now(), revision: 1 });
    return { eventId, snapshotId };
  }
  const eventA = await event('Přidělená akce A'), eventB = await event('Nepřístupná akce B');
  async function person(role) {
    const email = `${prefix}-${role}@example.test`, password = randomUUID();
    const user = await auth.createUser({ email, password, emailVerified: true, displayName: role }); users.push(user.uid);
    const member = { uid: user.uid, email, displayName: role, role, permissions: [...rolePresets[role]], quizzes: { mode: role === 'viewer' ? 'selected' : 'none', ids: role === 'viewer' ? [quizA] : [] }, events: { mode: 'selected', ids: [eventA.eventId] }, status: 'active', version: 1, sessionValidAfter: 0 };
    await db.doc(`memberships/${user.uid}`).set(member); paths.push(`memberships/${user.uid}`); return { ...member, password };
  }
  const moderator = await person('moderator'), referee = await person('referee'), viewer = await person('viewer');
  const invitedEmail = `${prefix}-invited@example.test`, invitedPassword = randomUUID();
  return { ...env, db, auth, owner: { ...owner, uid: ownerUser.uid }, quizA, quizB, eventA, eventB, moderator, referee, viewer, invitedEmail, invitedPassword,
    async verificationLink(email, kind = 'VERIFY_EMAIL') {
      const response = await fetch(`http://${env.authEndpoint.host}:${env.authEndpoint.port}/emulator/v1/projects/${env.projectId}/oobCodes`);
      const entries = (await response.json()).oobCodes ?? []; return entries.filter(item => (item.email === email || item.newEmail === email) && item.requestType === kind).at(-1)?.oobLink;
    },
    async dispose() {
      const invited = await auth.getUserByEmail(invitedEmail).catch(() => null); if (invited) { users.push(invited.uid); paths.push(`memberships/${invited.uid}`); }
      const sessions = await db.collection('sessions').get(); for (const session of sessions.docs) if ([eventA.eventId, eventB.eventId].includes(session.get('eventId'))) paths.push(session.ref.path, `publicSessions/${session.id}`);
      const invitations = await db.collection('accessInvites').where('email', '==', invitedEmail).get(); paths.push(...invitations.docs.map(d => d.ref.path));
      const audit = await db.collection('accessAudit').get(); for (const entry of audit.docs) if ([ownerUser.uid, ...users].includes(entry.get('actorUid'))) paths.push(entry.ref.path);
      for (const path of new Set(paths)) await db.recursiveDelete(db.doc(path));
      for (const uid of users) await auth.deleteUser(uid);
      await db.doc(`memberships/${ownerUser.uid}`).delete(); await owner.dispose(); await sdk.deleteApp(server);
    } };
}
