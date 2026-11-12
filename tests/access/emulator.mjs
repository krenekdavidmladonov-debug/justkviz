import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { initializeApp as clientApp, deleteApp as deleteClient } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';
import { permissions, rolePresets } from '../../packages/quiz-domain/lib/access.js';

const { projectId, authEndpoint, functionsEndpoint } = requireFullEmulatorEnvironment(process.env, 'Personal access tests');
const require = createRequire(new URL('../../functions/package.json', import.meta.url));
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getAuth: adminAuth } = require('firebase-admin/auth');
const { getFirestore, Timestamp, FieldValue } = require('firebase-admin/firestore');
const app = initializeApp({ projectId }), db = getFirestore(app), auth = adminAuth(app);
const prefix = 'access-' + randomBytes(5).toString('hex'), password = randomBytes(24).toString('base64url') + '!';
const accounts = [], documents = [];
let passed = 0;
const none = () => ({ mode: 'none', ids: [] }), all = () => ({ mode: 'all', ids: [] });
const selected = ids => ({ mode: 'selected', ids });
const quizA = prefix + '-a', quizB = prefix + '-b', eventA = prefix + '-event-a', eventB = prefix + '-event-b';
async function put(path, data) { await db.doc(path).set(data); documents.push(path); }
async function account(label, grant, emailVerified = true, claims = {}) {
  const uid = `${prefix}-${label}`, email = `${uid}@example.test`;
  await auth.createUser({ uid, email, emailVerified, password, displayName: label });
  await auth.setCustomUserClaims(uid, claims);
  if (grant) await put(`memberships/${uid}`, { ...grant, uid, email, displayName: label, status: 'active', version: 1, sessionValidAfter: 0 });
  const app = clientApp({ projectId, apiKey: 'demo-key', authDomain: `${projectId}.firebaseapp.com` }, uid);
  const identity = getAuth(app); connectAuthEmulator(identity, `http://${authEndpoint.host}:${authEndpoint.port}`, { disableWarnings: true });
  const functions = getFunctions(app, 'europe-west1'); connectFunctionsEmulator(functions, functionsEndpoint.host, functionsEndpoint.port);
  await signInWithEmailAndPassword(identity, email, password);
  const result = { uid, email, app, identity, call: async (name, data = {}) => (await httpsCallable(functions, name)(data)).data };
  accounts.push(result); return result;
}
async function denied(action, code = 'functions/permission-denied') { await assert.rejects(action, error => error.code === code); }
async function test(name, action) { await action(); passed++; console.log(`PASS ${name}`); }
const payload = slide => Object.fromEntries(['kind', 'title', 'text', 'moderatorNote', 'options', 'correctAnswer', 'media', 'presentation', 'backgroundImage', 'questionImage', 'answerImage', 'mediaSource', 'backgroundOverlay', 'clipStartSeconds', 'clipEndSeconds', 'authoringStatus', 'answerMode', 'imageLayout', 'answerExplanation'].filter(k => slide[k] !== undefined).map(k => [k, slide[k]]));
try {
  await db.doc('accessControl/state').set({ collaborationEnabled: true, revision: 0 });
  const owner = await account('owner', { role: 'owner', permissions, quizzes: all(), events: all() });
  await test('legacy string audit time cannot break the independent nonempty membership list', async () => {
    const entryId = prefix + '-legacy-audit', at = '2026-11-04T12:30:00.000Z';
    await put(`accessAudit/${entryId}`, { actorUid: owner.uid, targetId: owner.uid, kind: 'approved-owner-bootstrap', changes: {}, at });
    const overview = await owner.call('listAccessUsers');
    assert.ok(overview.users.some(user => user.uid === owner.uid));
    const entries = await owner.call('listAccessAudit');
    assert.equal(entries.find(entry => entry.id === entryId)?.at, at);
    await db.doc(`accessAudit/${entryId}`).update({ at: 'invalid-historical-time' });
    const invalid = (await owner.call('listAccessAudit')).find(entry => entry.id === entryId);
    assert.equal(invalid.at, null);
  });
  const creator = await account('creator', { role: 'creator', permissions: [...rolePresets.creator], quizzes: selected([quizA]), events: none() });
  const structure = await account('structure', { role: 'creator', permissions: ['quiz.read', 'quiz.edit'], quizzes: selected([quizA]), events: none() });
  const moderator = await account('moderator', { role: 'moderator', permissions: [...rolePresets.moderator], quizzes: none(), events: selected([eventA]) });
  const referee = await account('referee', { role: 'referee', permissions: [...rolePresets.referee], quizzes: none(), events: selected([eventA]) });
  const viewer = await account('viewer', { role: 'viewer', permissions: [...rolePresets.viewer], quizzes: selected([quizA]), events: selected([eventA]) }, true, { role: 'admin' });
  const manager = await account('manager', { role: 'manager', permissions, quizzes: selected([quizA]), events: selected([eventA]) });
  const legacy = await account('legacy-admin', null, true, { role: 'admin' });
  await test('owner overview is nonempty and Auth-only registration creates neither membership nor approval', async () => {
    const overview = await owner.call('listAccessUsers');
    assert.equal(overview.collaborationEnabled, true);
    assert.ok(overview.users.some(user => user.uid === owner.uid));
    assert.equal(overview.users.some(user => user.uid === legacy.uid), false);
    assert.equal((await legacy.call('getMyAccess')).member, null);
    for (const name of ['listAccessUsers', 'listAccessAudit']) {
      await denied(() => legacy.call(name));
      await denied(() => viewer.call(name));
    }
    await denied(() => legacy.call('updateAccessMembership', { uid: viewer.uid, expectedVersion: 1, grant: { role: 'viewer', permissions: rolePresets.viewer, quizzes: none(), events: none() }, status: 'active' }));
  });
  for (const id of [quizA, quizB]) {
    await put(`quizzes/${id}`, { title: id, description: '', status: 'draft', revision: 1, slideCount: 2, roundCount: 1, questionCount: 1, createdBy: creator.uid, updatedBy: owner.uid, createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
    await put(`quizzes/${id}/rounds/round`, { title: 'Round', position: 1, type: 'classic', questionCount: 1, slideCount: 2 });
    await put(`quizzes/${id}/slides/header`, { kind: 'round', title: 'Round', position: 1, roundId: 'round', isQuestion: false });
    await put(`quizzes/${id}/slides/question`, { kind: 'text', title: 'Question', text: 'Prompt', position: 2, roundId: 'round', isQuestion: true, authoringStatus: 'ready', answerMode: 'open', options: [],
      correctAnswer: 'ANSWER_PRIVATE_SENTINEL', moderatorNote: 'NOTE_PRIVATE_SENTINEL', answerExplanation: 'EXPLANATION_PRIVATE_SENTINEL', legacy: { raw: { value: 'RAW_PRIVATE_SENTINEL' } }, unknownExtension: { keep: true } });
    await put(`quizzes/${id}/rounds/round/questions/question`, { prompt: 'Prompt', type: 'text', position: 1, correctAnswer: 'ANSWER_PRIVATE_SENTINEL' });
  }
  for (const id of [eventA, eventB]) {
    const snapshotId = id + '-snapshot';
    await put(`events/${id}`, { title: id, startsAt: Timestamp.now(), timeZone: 'Europe/Prague', venue: { name: 'Local venue', publicLocation: 'Local' }, teamCapacity: 10, peopleCapacity: 50, teamSizeMin: 1, teamSizeMax: 5,
      acceptedTeams: 1, acceptedPeople: 2, revision: 1, createdBy: owner.uid, registrationPublished: false, registrationStatus: 'closed', lifecycleStatus: 'ready', scoring: { unitScale: 2, rankingMode: 'dense', started: false },
      quizAssignment: { quizId: quizA, quizRevision: 1, snapshotId, quizTitle: 'Snapshot', roundCount: 1, questionCount: 1, lockedAt: Timestamp.now() } });
    await put(`quizSnapshots/${snapshotId}`, { quizId: quizA, slideCount: 2, title: 'Snapshot' });
    await put(`quizSnapshots/${snapshotId}/rounds/round`, { title: 'Round', position: 1 });
    await put(`quizSnapshots/${snapshotId}/slides/question`, (await db.doc(`quizzes/${quizA}/slides/question`).get()).data());
    await put(`events/${id}/registrations/team`, { eventId: id, teamName: 'Synthetic team', status: 'accepted', contactEmail: 'CONTACT_PRIVATE_SENTINEL@example.test', memberCount: 2, source: 'online', createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
  }
  await test('legacy admin claim without membership is denied', () => denied(() => legacy.call('createQuiz', { title: 'Denied', requestId: prefix })));
  await test('scoped query returns A only; B cannot be read by guessing its URL', async () => {
    const rows = await creator.call('readAccessData', { operation: 'quizzes' }); assert.deepEqual(rows.map(r => r.id), [quizA]);
    await denied(() => creator.call('readAccessData', { operation: 'editor', quizId: quizB }));
  });
  await test('all legacy quiz mutations reject a foreign quiz before business validation', async () => {
    for (const name of ['updateQuizMetadata', 'updateQuizSlide', 'createQuizSlide', 'duplicateQuizSlide', 'deleteQuizSlide', 'moveQuizSlide', 'updateQuizRound', 'reorderQuizQuestion', 'moveQuizQuestionToRound', 'duplicateQuizRound', 'moveQuizRound', 'removeQuizRound', 'repairQuizPreflightIssue', 'createQuizRound', 'beginQuizMediaUpload', 'finalizeQuizMediaUpload']) {
      await denied(() => creator.call(name, { quizId: quizB, expectedRevision: 1, kind: 'video-timing' }));
    }
  });
  await test('viewer with stale admin claim receives no private answer, note, raw, or contact', async () => {
    const malformed = db.doc(`quizzes/${quizA}/slides/question`);
    await malformed.update({ mediaSource: [{ raw: 'RAW_PRIVATE_SENTINEL' }] });
    for (const request of [{ operation: 'editor', quizId: quizA }, { operation: 'quiz', quizId: quizA }, { operation: 'snapshotSlides', snapshotId: eventA + '-snapshot' }, { operation: 'roster', eventId: eventA }]) {
      const response = JSON.stringify(await viewer.call('readAccessData', request));
      for (const secret of ['ANSWER_PRIVATE_SENTINEL', 'NOTE_PRIVATE_SENTINEL', 'RAW_PRIVATE_SENTINEL', 'EXPLANATION_PRIVATE_SENTINEL', 'CONTACT_PRIVATE_SENTINEL']) assert.equal(response.includes(secret), false);
    }
    await denied(() => viewer.call('readAccessData', { operation: 'registrations', eventId: eventA }));
    await denied(() => viewer.call('updateQuizMetadata', { quizId: quizA }));
    await malformed.update({ mediaSource: FieldValue.delete() });
  });
  await test('redacted structure save preserves exact unseen and legacy fields', async () => {
    const before = (await db.doc(`quizzes/${quizA}/slides/question`).get()).data();
    const quiz = await structure.call('readAccessData', { operation: 'editor', quizId: quizA });
    const slide = quiz.slides.find(s => s.id === 'question');
    await structure.call('updateQuizSlide', { quizId: quizA, slideId: slide.id, expectedRevision: quiz.revision, slide: { ...payload(slide), text: 'Edited prompt' } });
    const after = (await db.doc(`quizzes/${quizA}/slides/question`).get()).data();
    for (const key of ['correctAnswer', 'moderatorNote', 'answerExplanation', 'legacy', 'unknownExtension']) assert.deepEqual(after[key], before[key]);
    await denied(() => structure.call('updateQuizSlide', { quizId: quizA, slideId: slide.id, expectedRevision: quiz.revision + 1, slide: { ...payload(slide), correctAnswer: 'Forged answer' } }));
  });
  await test('event-only actors cannot read source quiz or another event snapshot', async () => {
    const rows = await moderator.call('readAccessData', { operation: 'snapshotSlides', snapshotId: eventA + '-snapshot' }); assert.equal(rows[0].correctAnswer, 'ANSWER_PRIVATE_SENTINEL');
    await denied(() => moderator.call('readAccessData', { operation: 'editor', quizId: quizA }));
    await denied(() => moderator.call('readAccessData', { operation: 'snapshotSlides', snapshotId: eventB + '-snapshot' }));
    for (const name of ['updateEvent', 'cancelEvent', 'archiveEvent', 'configureEventRegistration', 'adminAddEventTeam', 'adminUpdateEventTeam', 'adminCancelEventRegistration', 'createEventLiveSession', 'previewInterimResults', 'controlInterimResults', 'previewFinalResults', 'controlFinalReveal', 'listRefereeAccess', 'issueRefereeAccess', 'changeRefereeAccess', 'previewEventTeamMessage', 'createEventTeamMessage', 'listEventTeamMessages', 'getEventTeamMessage']) await denied(() => moderator.call(name, { eventId: eventB }));
  });
  await test('snapshot export cannot turn event-note access into forbidden source-note access', async () => {
    const exporter = await account('restricted-exporter', { role: 'manager', permissions: ['quiz.read', 'quiz.export', 'quiz.answers.read', 'event.read', 'event.manage', 'event.notes.read'], quizzes: selected([quizA]), events: selected([eventA]) });
    const before = (await db.doc(`events/${eventA}`).get()).get('quizAssignment');
    await denied(() => exporter.call('lockEventQuiz', { quizId: quizA, eventId: eventA, expectedRevision: 1, expectedQuizRevision: 2, acknowledgeWarnings: true }));
    assert.deepEqual((await db.doc(`events/${eventA}`).get()).get('quizAssignment'), before);
  });
  await test('redacted legacy placeholders survive real API saves by full and structure-only editors', async () => {
    const ref = db.doc(`quizzes/${quizA}/slides/question`), original = (await ref.get()).data();
    const legacyFields = { title: { opaque: 'RAW_PRIVATE_SENTINEL' }, text: { opaque: 'RAW_PRIVATE_SENTINEL' }, options: ['Visible option', { opaque: 'RAW_PRIVATE_SENTINEL' }], mediaSource: [{ opaque: 'RAW_PRIVATE_SENTINEL' }] };
    try {
      for (const state of [{ authoringStatus: 'draft', answerMode: 'open' }, { authoringStatus: 'ready', answerMode: 'open' }, { authoringStatus: 'ready', answerMode: 'choice' }]) {
        const fields = { ...legacyFields, options: state.answerMode === 'open' ? [] : legacyFields.options };
        await ref.update({ ...fields, ...state, kind: 'text', correctAnswer: 'Visible option' });
        for (const [index, editor] of [creator, structure].entries()) {
          const quiz = await editor.call('readAccessData', { operation: 'editor', quizId: quizA }), slide = quiz.slides.find(s => s.id === 'question');
          assert.equal(JSON.stringify(slide).includes('RAW_PRIVATE_SENTINEL'), false);
          await editor.call('updateQuizSlide', { quizId: quizA, slideId: 'question', expectedRevision: quiz.revision, slide: { ...payload(slide), backgroundOverlay: 0.2 + index / 10 } });
          const saved = (await ref.get()).data();
          for (const [key, value] of Object.entries(fields)) assert.deepEqual(saved[key], value);
          assert.equal(saved.backgroundOverlay, 0.2 + index / 10);
          assert.equal(saved.authoringStatus, state.authoringStatus);
        }
      }
    } finally { await ref.set(original); }
  });
  await test('choice removal, reorder and kind probes cannot reveal or reinterpret hidden answers', async () => {
    const ref = db.doc(`quizzes/${quizA}/slides/question`), original = (await ref.get()).data();
    try {
      await ref.update({ kind: 'text', answerMode: 'choice', authoringStatus: 'ready', options: ['Alpha', 'Beta', 'Gamma', 'Delta'], correctAnswer: 'Beta' });
      const quiz = await structure.call('readAccessData', { operation: 'editor', quizId: quizA }), slide = quiz.slides.find(s => s.id === 'question');
      for (const change of [{ options: ['Beta', 'Gamma', 'Delta'] }, { options: ['Alpha', 'Gamma', 'Delta'] }, { options: ['Beta', 'Alpha', 'Gamma', 'Delta'] }, { kind: 'pl' }]) {
        await denied(() => structure.call('updateQuizSlide', { quizId: quizA, slideId: 'question', expectedRevision: quiz.revision, slide: { ...payload(slide), ...change } }));
        assert.equal((await db.doc(`quizzes/${quizA}`).get()).get('revision'), quiz.revision);
        assert.equal((await ref.get()).get('correctAnswer'), 'Beta');
      }
      const full = await creator.call('readAccessData', { operation: 'editor', quizId: quizA }), fullSlide = full.slides.find(s => s.id === 'question');
      await creator.call('updateQuizSlide', { quizId: quizA, slideId: 'question', expectedRevision: full.revision, slide: { ...payload(fullSlide), options: ['Alpha', 'Beta', 'Delta'] } });
      assert.equal((await db.doc(`quizzes/${quizA}`).get()).get('revision'), full.revision + 1);
    } finally { await ref.set(original); }
  });
  await test('referee scores only assigned event; viewer cannot score', async () => {
    const score = { eventId: eventA, snapshotId: eventA + '-snapshot', teamId: 'team', roundId: 'round', requestId: prefix, expectedRevision: 0, halfPoints: 4, reason: '' };
    await referee.call('saveEventScore', score);
    await denied(() => referee.call('saveEventScore', { ...score, eventId: eventB }));
    await denied(() => viewer.call('saveEventScore', score));
  });
  await test('live permission alone cannot disclose hidden answers through reveal or recap', async () => {
    const transport = await account('transport-only', { role: 'moderator', permissions: ['event.read', 'event.live'], quizzes: none(), events: selected([eventA]) });
    const sessionId = prefix + '-restricted-session'; await put(`sessions/${sessionId}`, { eventId: eventA, quizId: quizA });
    for (const name of ['revealAnswer', 'selectRecapQuestion']) await denied(() => transport.call(name, { sessionId, expectedRevision: 0, position: 2 }));
  });
  await test('referee bearer grants require current issuer score permission, scope and active identity', async () => {
    const issuerGrant = { role: 'manager', permissions: ['event.read', 'event.manage', 'event.score'], quizzes: none(), events: selected([eventB]) };
    const issuer = await account('referee-issuer', { ...issuerGrant, permissions: ['event.read', 'event.manage'] });
    const holder = await account('anonymous-referee', null); await signOut(holder.identity);
    const issue = { eventId: eventB, requestId: prefix + '-referee', label: 'Scoped referee', expiresAt: new Date(Date.now() + 86400000).toISOString() };
    await denied(() => issuer.call('issueRefereeAccess', issue));
    const initial = await owner.call('issueRefereeAccess', issue);
    const rotate = { eventId: eventB, accessId: initial.accessId, expectedVersion: 1, action: 'rotate', expiresAt: issue.expiresAt };
    await denied(() => issuer.call('changeRefereeAccess', rotate));
    assert.equal((await db.doc(`events/${eventB}/refereeAccess/${initial.accessId}`).get()).get('version'), 1);
    await issuer.call('changeRefereeAccess', { ...rotate, action: 'revoke' });
    const memberRef = db.doc(`memberships/${issuer.uid}`); await memberRef.update({ permissions: issuerGrant.permissions, version: 2 });
    const baseline = (await memberRef.get()).data(), issued = await issuer.call('issueRefereeAccess', { ...issue, requestId: prefix + '-issuer' });
    const credential = { eventId: eventB, accessId: issued.accessId, key: issued.key };
    const score = { eventId: eventB, snapshotId: eventB + '-snapshot', teamId: 'team', roundId: 'round', expectedRevision: 0, requestId: prefix + '-bearer-score', halfPoints: 4, reason: '' };
    await holder.call('readRefereeEvent', credential);
    const legacyGrantRef = db.doc(`events/${eventB}/refereeAccess/${issued.accessId}`), legacyGrant = (await legacyGrantRef.get()).data();
    delete legacyGrant.issuedBy; await legacyGrantRef.set(legacyGrant);
    await holder.call('readRefereeEvent', credential);
    for (const patch of [{ permissions: ['event.read', 'event.manage'] }, { events: selected([eventA]) }, { status: 'suspended' }]) {
      await memberRef.set({ ...baseline, ...patch });
      await denied(() => holder.call('readRefereeEvent', credential));
      await denied(() => holder.call('readRefereeHistory', { ...credential, teamId: 'team', roundId: 'round' }));
      await denied(() => holder.call('saveRefereeScore', { credential, score }));
      await memberRef.set(baseline);
    }
    await auth.updateUser(issuer.uid, { disabled: true }); await denied(() => holder.call('readRefereeEvent', credential)); await auth.updateUser(issuer.uid, { disabled: false });
    await auth.updateUser(issuer.uid, { emailVerified: false }); await denied(() => holder.call('readRefereeEvent', credential)); await auth.updateUser(issuer.uid, { emailVerified: true });
    const race = await Promise.allSettled([holder.call('saveRefereeScore', { credential, score }), owner.call('updateAccessMembership', { uid: issuer.uid, expectedVersion: 2, status: 'suspended', grant: issuerGrant })]);
    assert.equal(race[1].status, 'fulfilled');
    if (race[0].status === 'rejected') assert.equal(race[0].reason.code, 'functions/permission-denied');
    await denied(() => holder.call('saveRefereeScore', { credential, score }));
    const transferred = await owner.call('changeRefereeAccess', { ...rotate, accessId: issued.accessId });
    await denied(() => holder.call('readRefereeEvent', credential));
    await holder.call('readRefereeEvent', { ...credential, key: transferred.key });
    assert.equal((await db.doc(`events/${eventB}/refereeAccess/${issued.accessId}`).get()).get('issuedBy'), owner.uid);
  });
  await test('self escalation and delegation outside manager scope are rejected', async () => {
    const own = await manager.call('getMyAccess');
    await denied(() => manager.call('updateAccessMembership', { uid: manager.uid, expectedVersion: 1, status: 'active', grant: { role: 'manager', permissions, quizzes: all(), events: all() } }));
    await denied(() => manager.call('createAccessInvitation', { email: `${prefix}-outside@example.test`, grant: { role: 'creator', permissions: rolePresets.creator, quizzes: selected([quizB]), events: none() } }));
    await denied(() => manager.call('createAccessInvitation', { email: `${prefix}-owner@example.test`, grant: { role: 'owner', permissions: own.member.permissions, quizzes: none(), events: none() } }));
    await denied(() => creator.call('deleteQuizSlide', { quizId: quizA, slideId: 'question', expectedRevision: 2 }));
    await denied(() => creator.call('deleteQuizSlide', { quizId: quizA, slideId: 'question', expectedRevision: 2, mode: 'move' }));
    await denied(() => creator.call('removeQuizRound', { quizId: quizA, roundId: 'round', expectedRevision: 2, mode: 'move', targetRoundId: 'other' }));
    await denied(() => manager.call('createAccessInvitation', { email: `${prefix}-manager@example.test`, grant: { role: 'manager', permissions: ['users.manage'], quizzes: none(), events: none() } }));
    await denied(() => manager.call('createAccessInvitation', { email: `${prefix}-hidden-manager@example.test`, grant: { role: 'creator', permissions: ['users.manage'], quizzes: none(), events: none() } }));
  });
  await test('own-scope manager delegates only resources with authoritative matching ownership', async () => {
    const ownManager = await account('own-manager', { role: 'manager', permissions, quizzes: { mode: 'own', ids: [] }, events: none() });
    const resourceId = prefix + '-owned'; await put(`quizzes/${resourceId}`, { createdBy: ownManager.uid });
    const recipient = await account('owned-recipient', null);
    const ownGrant = { role: 'viewer', permissions: ['quiz.read'], quizzes: selected([resourceId]), events: none() };
    const invite = await ownManager.call('createAccessInvitation', { email: recipient.email, grant: ownGrant }); documents.push(`accessInvites/${invite.inviteId}`);
    await denied(() => ownManager.call('createAccessInvitation', { email: `${prefix}-foreign-own@example.test`, grant: { ...ownGrant, quizzes: selected([quizA]) } }));
    await db.doc(`quizzes/${resourceId}`).update({ createdBy: owner.uid });
    await denied(() => recipient.call('acceptAccessInvitation', { inviteId: invite.inviteId, token: invite.token }));
    await db.doc(`quizzes/${resourceId}`).update({ createdBy: ownManager.uid });
    await recipient.call('acceptAccessInvitation', { inviteId: invite.inviteId, token: invite.token }); documents.push(`memberships/${recipient.uid}`);
    assert.deepEqual((await db.doc(`memberships/${recipient.uid}`).get()).get('quizzes'), selected([resourceId]));
  });
  const invited = await account('invited', null), wrong = await account('wrong-email', null), unverified = await account('unverified', null, false);
  const grant = { role: 'creator', permissions: rolePresets.creator, quizzes: selected([quizA]), events: none() };
  let invitation;
  await test('invitation stores hash only and leaves the issuing administrator session unchanged', async () => {
    const uid = owner.identity.currentUser.uid;
    invitation = await owner.call('createAccessInvitation', { email: invited.email, grant });
    documents.push(`accessInvites/${invitation.inviteId}`);
    const stored = (await db.doc(`accessInvites/${invitation.inviteId}`).get()).data();
    assert.ok(stored.tokenHash); assert.equal(JSON.stringify(stored).includes(invitation.token), false);
    assert.equal(owner.identity.currentUser.uid, uid);
    assert.ok(stored.expiresAt > Date.now() + 6 * 86400000);
    await denied(() => wrong.call('acceptAccessInvitation', { inviteId: invitation.inviteId, token: invitation.token }));
    await denied(() => unverified.call('acceptAccessInvitation', { inviteId: invitation.inviteId, token: invitation.token }));
  });
  await test('reissue invalidates old token; concurrent acceptance succeeds once for an existing Auth identity', async () => {
    const renewed = await owner.call('changeAccessInvitation', { inviteId: invitation.inviteId, expectedVersion: 1, action: 'reissue' });
    await denied(() => invited.call('acceptAccessInvitation', { inviteId: invitation.inviteId, token: invitation.token }));
    const results = await Promise.allSettled([1, 2].map(() => invited.call('acceptAccessInvitation', { inviteId: invitation.inviteId, token: renewed.token, grant: { role: 'owner' } })));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    documents.push(`memberships/${invited.uid}`);
    const actual = (await db.doc(`memberships/${invited.uid}`).get()).data(); assert.equal(actual.role, 'creator'); assert.deepEqual(actual.quizzes, selected([quizA])); assert.equal(actual.permissions.includes('quiz.delete'), false);
    assert.equal((await invited.call('getMyAccess')).member.uid, invited.uid);
    assert.equal((await invited.call('readAccessData', { operation: 'editor', quizId: quizA })).id, quizA);
    assert.equal((await owner.call('listAccessUsers')).users.filter(user => user.uid === invited.uid).length, 1);
    await owner.call('updateAccessMembership', { uid: invited.uid, expectedVersion: 1, status: 'active', grant: { role: 'viewer', permissions: rolePresets.viewer, quizzes: selected([quizA]), events: none() } });
    assert.equal((await invited.call('getMyAccess')).member.version, 2);
    await denied(() => invited.call('updateQuizMetadata', { quizId: quizA }));
  });
  await test('revoked and expired invitations fail closed', async () => {
    const invite = await owner.call('createAccessInvitation', { email: wrong.email, grant }); documents.push(`accessInvites/${invite.inviteId}`);
    await owner.call('changeAccessInvitation', { inviteId: invite.inviteId, expectedVersion: 1, action: 'revoke' });
    await denied(() => wrong.call('acceptAccessInvitation', { inviteId: invite.inviteId, token: invite.token }));
    const next = await owner.call('changeAccessInvitation', { inviteId: invite.inviteId, expectedVersion: 2, action: 'reissue' });
    await db.doc(`accessInvites/${invite.inviteId}`).update({ expiresAt: Date.now() - 1 });
    await denied(() => wrong.call('acceptAccessInvitation', { inviteId: invite.inviteId, token: next.token }));
  });
  for (const state of ['disabled', 'deleted', 'unverified']) {
    await test(`invitation acceptance rejects a ${state} issuer Auth identity despite active membership`, async () => {
      const issuer = await account(`invite-issuer-${state}`, { role: 'manager', permissions, quizzes: selected([quizA]), events: selected([eventA]) });
      const recipient = await account(`invite-recipient-${state}`, null);
      documents.push(`memberships/${recipient.uid}`);
      const invite = await issuer.call('createAccessInvitation', { email: recipient.email, grant });
      const inviteRef = db.doc(`accessInvites/${invite.inviteId}`), issuerRef = db.doc(`memberships/${issuer.uid}`);
      documents.push(inviteRef.path);
      const invitationBefore = (await inviteRef.get()).data(), issuerBefore = (await issuerRef.get()).data();
      if (state === 'deleted') await auth.deleteUser(issuer.uid);
      else await auth.updateUser(issuer.uid, state === 'disabled' ? { disabled: true } : { emailVerified: false });
      await denied(() => recipient.call('acceptAccessInvitation', { inviteId: invite.inviteId, token: invite.token }));
      assert.equal((await db.doc(`memberships/${recipient.uid}`).get()).exists, false);
      assert.deepEqual((await inviteRef.get()).data(), invitationBefore);
      assert.deepEqual((await issuerRef.get()).data(), issuerBefore);
      assert.equal(issuerBefore.status, 'active');
    });
  }
  await test('invitation activation gate and current issuer revocation are enforced transactionally', async () => {
    const recipient = await account('paused-invite', null);
    const invite = await manager.call('createAccessInvitation', { email: recipient.email, grant }); documents.push(`accessInvites/${invite.inviteId}`);
    await db.doc('accessControl/state').update({ collaborationEnabled: false });
    const overview = await owner.call('listAccessUsers');
    assert.equal(overview.collaborationEnabled, false);
    assert.ok(overview.users.some(user => user.uid === owner.uid));
    await owner.call('listAccessAudit');
    await denied(() => recipient.call('acceptAccessInvitation', { inviteId: invite.inviteId, token: invite.token }), 'functions/failed-precondition');
    await denied(() => owner.call('createAccessInvitation', { email: `${prefix}-paused@example.test`, grant }), 'functions/failed-precondition');
    await denied(() => owner.call('changeAccessInvitation', { inviteId: invite.inviteId, expectedVersion: 1, action: 'reissue' }), 'functions/failed-precondition');
    await db.doc('accessControl/state').update({ collaborationEnabled: true });
    const current = (await db.doc(`memberships/${manager.uid}`).get()).data();
    const managerGrant = { role: current.role, permissions: current.permissions, quizzes: current.quizzes, events: current.events };
    await owner.call('updateAccessMembership', { uid: manager.uid, expectedVersion: current.version, status: 'suspended', grant: managerGrant });
    await denied(() => recipient.call('acceptAccessInvitation', { inviteId: invite.inviteId, token: invite.token }));
    assert.equal((await db.doc(`memberships/${recipient.uid}`).get()).exists, false);
  });
  await test('suspension rejects an old token for read, save and upload', async () => {
    const oldToken = await creator.identity.currentUser.getIdToken();
    await owner.call('updateAccessMembership', { uid: creator.uid, expectedVersion: 1, status: 'suspended', grant });
    assert.equal(await creator.identity.currentUser.getIdToken() === oldToken, true);
    await denied(() => creator.call('readAccessData', { operation: 'editor', quizId: quizA }));
    await denied(() => creator.call('updateQuizMetadata', { quizId: quizA, expectedRevision: 2, quiz: { title: 'Late save', description: '' } }));
    await denied(() => creator.call('beginQuizMediaUpload', { quizId: quizA }));
    assert.equal((await creator.call('getMyAccess')).member, null);
  });
  await test('a new quiz is explicitly added to a creator scope that started empty', async () => {
    const fresh = await account('new-creator', { ...grant, quizzes: selected([]) });
    const created = await fresh.call('createQuiz', { title: 'New authorized quiz', requestId: prefix }); documents.push(`quizzes/${created.quizId}`);
    const read = await fresh.call('readAccessData', { operation: 'editor', quizId: created.quizId }); assert.equal(read.id, created.quizId);
  });
  await test('concurrent owner removal cannot leave zero active owners', async () => {
    const second = await account('second-owner', { role: 'owner', permissions, quizzes: all(), events: all() });
    const demotion = { role: 'manager', permissions, quizzes: all(), events: all() };
    const results = await Promise.allSettled([owner.call('updateAccessMembership', { uid: second.uid, expectedVersion: 1, status: 'suspended', grant: demotion }), second.call('updateAccessMembership', { uid: owner.uid, expectedVersion: 1, status: 'suspended', grant: demotion })]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    const owners = await db.collection('memberships').where('role', '==', 'owner').where('status', '==', 'active').get(); assert.equal(owners.size, 1);
  });
  console.log(`Personal access emulator contracts: ${passed} passed. No credentials or invitation tokens logged.`);
} finally {
  for (const account of accounts) { await deleteClient(account.app); await auth.deleteUser(account.uid).catch(() => {}); }
  for (const path of [...new Set(documents)].reverse()) await db.recursiveDelete(db.doc(path));
  const audit = await db.collection('accessAudit').get();
  for (const entry of audit.docs) if (String(entry.data().actorUid).startsWith(prefix)) await entry.ref.delete();
  await deleteApp(app);
}
