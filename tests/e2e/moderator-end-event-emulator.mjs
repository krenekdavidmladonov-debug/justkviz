import assert from 'node:assert/strict';
import { finalFixture } from './final-reveal-fixture.mjs';
import { requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';

requireFullEmulatorEnvironment(process.env, 'Moderator full event ending regression');
// A live-only moderator may end the presentation without event management authority.
const liveOnly = await finalFixture(4);
try {
  const before = await liveOnly.session();
  const eventRef = liveOnly.db.doc('events/' + liveOnly.eventId);
  const eventBefore = (await eventRef.get()).data();
  const memberRef = liveOnly.db.doc('memberships/' + liveOnly.moderator.uid);
  const member = (await memberRef.get()).data();
  await memberRef.update({ permissions: ['event.live'], version: member.version + 1 });
  const request = { sessionId: liveOnly.sessionId, expectedRevision: before.revision };
  await assert.rejects(liveOnly.call('endLiveSession', { ...request, completeEvent: true }), error => error.code === 'functions/permission-denied');
  assert.deepEqual((await eventRef.get()).data(), eventBefore);
  assert.deepEqual(await liveOnly.session(), before);
  const ended = await liveOnly.call('endLiveSession', request);
  assert.equal(ended.status, 'ended');
  assert.equal((await liveOnly.session()).status, 'ended');
  assert.equal((await liveOnly.db.doc('publicSessions/' + liveOnly.sessionId).get()).get('status'), 'ended');
  assert.deepEqual((await eventRef.get()).data(), eventBefore);
  console.log('PASS: event.live-only moderator ends the quiz, cannot complete its event, and retains the event unchanged');
} finally { await liveOnly.close(); }

const f = await finalFixture(4);
try {
  await f.startFinal(await f.previewFinal());
  const session = await f.session();
  const eventRef = f.db.doc('events/' + f.eventId);
  const versionRef = f.db.doc(`sessions/${f.sessionId}/finalVersions/${session.finalReveal.versionId}`);
  const version = (await versionRef.get()).data();
  const scores = (await eventRef.collection('scores').get()).docs.map(doc => ({ id: doc.id, ...doc.data() }));
  const request = { sessionId: f.sessionId, expectedRevision: session.revision, completeEvent: true };
  const denied = (promise, code) => assert.rejects(promise, error => error.code === 'functions/' + code);
  const eventBefore = (await eventRef.get()).data();
  await denied(f.call('endLiveSession', request), 'permission-denied');
  await denied(f.admin.call('endLiveSession', { ...request, expectedRevision: session.revision - 1 }), 'aborted');
  assert.deepEqual((await eventRef.get()).data(), eventBefore);
  assert.equal((await f.session()).status, session.status);
  const memberRef = f.db.doc('memberships/' + f.admin.uid), member = (await memberRef.get()).data();
  try {
    await memberRef.update({ permissions: member.permissions.filter(permission => permission !== 'event.manage'), version: member.version + 1 });
    await denied(f.admin.call('endLiveSession', request), 'permission-denied');
    await memberRef.set({ ...member, events: { mode: 'selected', ids: [] }, version: member.version + 2 });
    await denied(f.admin.call('endLiveSession', request), 'permission-denied');
    assert.deepEqual((await eventRef.get()).data(), eventBefore);
  } finally { await memberRef.set(member); }
  const siblingId = 'synthetic-sibling-' + f.sessionId;
  await f.db.doc('sessions/' + siblingId).set({ ...session, sessionId: siblingId });
  const [ended, duplicate] = await Promise.all([f.admin.call('endLiveSession', request), f.admin.call('endLiveSession', request)]);
  assert.deepEqual(duplicate, ended);
  assert.equal((await f.db.doc('sessions/' + siblingId).get()).get('status'), 'ended');
  assert.equal((await f.db.doc('publicSessions/' + siblingId).get()).get('status'), 'ended');
  assert.equal(ended.status, 'ended');
  assert.equal((await eventRef.get()).get('lifecycleStatus'), 'completed');
  assert.equal((await eventRef.get()).get('registrationPublished'), false);
  assert.equal((await eventRef.get()).get('registrationStatus'), 'closed');
  assert.equal((await f.db.doc('publicEvents/' + f.eventId).get()).exists, false);
  assert.equal((await f.db.doc('publicSessions/' + f.sessionId).get()).get('status'), 'ended');
  assert.deepEqual((await versionRef.get()).data(), version);
  assert.deepEqual((await eventRef.collection('scores').get()).docs.map(doc => ({ id: doc.id, ...doc.data() })), scores);
  const completed = (await eventRef.get()).data();
  assert.deepEqual(await f.admin.call('endLiveSession', request), ended);
  assert.deepEqual((await eventRef.get()).data(), completed);
  await denied(f.admin.call('endLiveSession', { ...request, expectedRevision: session.revision - 1 }), 'aborted');
  try {
    await memberRef.update({ permissions: member.permissions.filter(permission => permission !== 'event.manage'), version: member.version + 1 });
    await denied(f.admin.call('endLiveSession', request), 'permission-denied');
    assert.deepEqual((await eventRef.get()).data(), completed);
  } finally { await memberRef.set(member); }
  try {
    await eventRef.update({ disposition: 'archived' });
    await denied(f.admin.call('endLiveSession', request), 'failed-precondition');
    await eventRef.set({ ...completed, liveSessionId: siblingId });
    await denied(f.admin.call('endLiveSession', request), 'failed-precondition');
  } finally { await eventRef.set(completed); }
  const publicState = (await f.db.doc('publicSessions/' + f.sessionId).get()).data();
  for (const field of ['finalReveal', 'interimResults', 'revealedAnswer', 'correctAnswer', 'moderatorNote']) assert.equal(publicState[field], undefined);
  assert.equal(completed.revision, eventBefore.revision + 1);
  assert.equal(completed.capabilityVersion, (eventBefore.capabilityVersion ?? 0) + 1);
  console.log('PASS: full quiz end atomically completes event, unpublishes registrations, preserves history and replays');
} finally { await f.close(); }
