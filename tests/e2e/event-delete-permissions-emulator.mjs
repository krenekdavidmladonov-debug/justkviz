import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { editorIdentity } from './editor-identity.mjs';
import { permissions } from '../../packages/quiz-domain/lib/access.js';

const actor = await editorIdentity();
try {
  const db = actor.db;
  const member = (await db.collection('memberships').where('email', '==', actor.email).get()).docs[0].ref;
  const original = (await member.get()).data();
  const { eventId } = await actor.call('createEvent', { expectedRevision: 0, event: {
    title: 'Synthetic deletion permissions ' + randomUUID(), startsAt: '2031-01-01T18:00:00Z', timeZone: 'Europe/Prague',
    venue: { name: 'Synthetic', publicLocation: 'Synthetic' }, teamCapacity: 10, peopleCapacity: 40, teamSizeMin: 1, teamSizeMax: 4,
  } });
  const ref = db.doc('events/' + eventId);
  await actor.call('trashEvent', { eventId, expectedRevision: (await ref.get()).data().revision, requestId: randomUUID() });
  const event = (await ref.get()).data();
  const payload = { eventId, expectedRevision: event.revision, confirmTitle: event.title };
  const paths = ['events/', 'publicEvents/', 'eventDeletions/', 'eventTombstones/'].map(p => p + eventId);
  const fingerprint = async () => createHash('sha256').update(JSON.stringify(await Promise.all(paths.map(async p => {
    const d = await db.doc(p).get(); return [p, d.exists ? d.data() : null];
  })))).digest('hex');
  const denied = [];
  for (const [id, patch, foreignCreator] of [
    ['owner-missing-explicit-permission', { role: 'owner', permissions: permissions.filter(p => p !== 'event.delete') }],
    ['creator-and-organizer-have-no-implicit-permission', { role: 'manager', permissions: ['event.read', 'event.manage'], events: { mode: 'own', ids: [] } }],
    ['owner-grant-without-scope', { role: 'owner', events: { mode: 'none', ids: [] } }],
    ['owner-grant-foreign-selected-scope', { role: 'owner', events: { mode: 'selected', ids: ['synthetic-foreign-event'] } }],
    ['owner-grant-foreign-own-scope', { role: 'owner', events: { mode: 'own', ids: [] } }, true],
    ['suspended-owner-explicit-grant', { role: 'owner', status: 'suspended' }],
    ['delete-without-event-read', { role: 'owner', permissions: ['event.delete'] }],
  ]) {
    await member.set({ ...original, ...patch, version: original.version + denied.length + 1 });
    await ref.update({ createdBy: foreignCreator ? 'synthetic-foreign-creator' : original.uid });
    const before = await fingerprint();
    await assert.rejects(actor.call('deleteEvent', payload), error => error.code === 'functions/permission-denied', id);
    assert.equal(await fingerprint(), before, id + ' left deletion state unchanged');
    denied.push(id);
  }
  await member.set({ ...original, role: 'manager', permissions: ['event.read', 'event.delete'], events: { mode: 'selected', ids: [eventId] }, version: original.version + 20 });
  await actor.call('deleteEvent', payload);
  assert.equal((await ref.get()).exists, false);
  assert.equal((await db.doc('eventTombstones/' + eventId).get()).exists, true);
  console.log(JSON.stringify({ status: 'PASS', denied, explicitNonOwnerGrantAndScopeDeletes: true, deniedWritesUnchanged: true }));
  await member.set(original);
} finally { await actor.dispose(); }
