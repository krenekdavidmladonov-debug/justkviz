import assert from 'node:assert/strict';
import { offlineEventFixture, offlineJournal, hashOffline } from '../browser/offline-event-fixture.mjs';
import { requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';
requireFullEmulatorEnvironment(process.env, 'Offline cancelled-score regression');

const fixture = await offlineEventFixture();
try {
  const ref = fixture.identity.db.doc('events/' + fixture.eventId);
  const teams = await ref.collection('registrations').get();
  const rounds = await fixture.identity.db.collection(`quizSnapshots/${fixture.snapshotId}/rounds`).orderBy('position').get();
  const team = teams.docs.find(row => row.get('teamName') === 'QA01'), roundId = rounds.docs[0].id;
  await fixture.call('saveEventScore', { eventId: fixture.eventId, snapshotId: fixture.snapshotId, teamId: team.id, roundId,
    expectedRevision: 0, halfPoints: 4, reason: '', requestId: 'synthetic-before-cancellation' });
  const scoreRef = ref.collection('scores').doc(hashOffline([team.id, roundId]));
  const before = (await scoreRef.get()).data(), history = (await scoreRef.collection('history').get()).docs.map(row => ({ id: row.id, ...row.data() }));
  await fixture.call('adminCancelEventRegistration', { eventId: fixture.eventId, registrationId: team.id });
  const preflight = await fixture.call('readOfflineTrust', { eventId: fixture.eventId, preflight: true });
  assert.equal(preflight.teamCount, 9);
  const prepared = await fixture.prepare(); assert.equal(prepared.ok, true);
  assert(!prepared.manifest.teams.some(row => row.id === team.id));
  assert(!prepared.manifest.baseScores.some(row => row.teamId === team.id));
  const journal = offlineJournal(prepared.manifest);
  const input = { eventId: fixture.eventId, exportId: prepared.manifest.exportId, operations: journal.operations };
  const preview = await fixture.call('previewOfflineSync', input);
  assert.deepEqual(preview.conflicts, []);
  const receipt = await fixture.call('commitOfflineSync', { ...input, previewDigest: preview.previewDigest });
  assert.equal(receipt.rows.length, 9);
  assert.deepEqual((await scoreRef.get()).data(), before);
  assert.deepEqual((await scoreRef.collection('history').get()).docs.map(row => ({ id: row.id, ...row.data() })), history);
  console.log('PASS: cancelled scored team excluded from preflight/export/results and left untouched during sync');
} finally { await fixture.dispose(); }

const historical = await offlineEventFixture();
try {
  const ref = historical.identity.db.doc('events/' + historical.eventId);
  const rounds = await historical.identity.db.collection(`quizSnapshots/${historical.snapshotId}/rounds`).get(), roundId = rounds.docs[0].id;
  const batch = historical.identity.db.batch();
  for (let index = 0; index < 201; index++) {
    const teamId = 'synthetic-cancelled-' + index;
    batch.set(ref.collection('registrations').doc(teamId), { eventId: historical.eventId, status: 'cancelled', teamName: teamId, revision: 1 });
    batch.set(ref.collection('scores').doc(hashOffline([teamId, roundId])), { teamId, roundId, snapshotId: historical.snapshotId, halfPoints: 2, revision: 1 });
  }
  await batch.commit();
  const result = await historical.call('readOfflineTrust', { eventId: historical.eventId, preflight: true });
  assert.equal(result.teamCount, 10);
  const event = await historical.event();
  await historical.call('updateEvent', { eventId: historical.eventId, expectedRevision: event.revision, event: {
    title: event.title, startsAt: event.startsAt.toDate().toISOString(), timeZone: 'Europe/Prague', venue: event.venue,
    teamCapacity: 50, peopleCapacity: 200, teamSizeMin: 2, teamSizeMax: 4,
  } });
  for (let index = 0; index < 21; index++) await historical.call('adminAddEventTeam', { eventId: historical.eventId,
    requestId: 'synthetic-large-roster-' + index, teamName: 'Dodatečný tým ' + index, memberCount: 2 });
  assert.equal((await historical.call('readOfflineTrust', { eventId: historical.eventId, preflight: true })).teamCount, 31);
  const active = (await ref.collection('registrations').where('status', '==', 'accepted').get()).docs[0];
  const canonical = ref.collection('scores').doc(hashOffline([active.id, roundId]));
  await canonical.set({ teamId: 'synthetic-cancelled-0', roundId, snapshotId: historical.snapshotId, halfPoints: 2, revision: 1 });
  await assert.rejects(historical.call('readOfflineTrust', { eventId: historical.eventId, preflight: true }), error => error.code === 'functions/failed-precondition');
  const previousSnapshot = { teamId: active.id, roundId, snapshotId: 'synthetic-previous-snapshot', halfPoints: 7, revision: 3 };
  await canonical.set(previousSnapshot);
  await assert.rejects(historical.call('readOfflineTrust', { eventId: historical.eventId, preflight: true }), error => error.code === 'functions/failed-precondition');
  assert.deepEqual((await canonical.get()).data(), previousSnapshot);
  console.log('PASS: 201 cancelled scores excluded; 31 accepted teams span query groups; malformed canonical and previous-snapshot cells remain fail-closed');
} finally { await historical.dispose(); }
