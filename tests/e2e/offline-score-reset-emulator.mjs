import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { offlineEventFixture, offlineJournal } from '../browser/offline-event-fixture.mjs';
import { localEmulatorEndpoint, requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';

const env = requireFullEmulatorEnvironment(process.env, 'N11 offline reset regression');
assert.equal(env.projectId, 'demo-filmovy-kviz-v2');
const storage = localEmulatorEndpoint(process.env.FIREBASE_STORAGE_EMULATOR_HOST, 'Storage emulator');
const hub = localEmulatorEndpoint(process.env.FIREBASE_EMULATOR_HUB, 'Emulator Hub');
const running = await (await fetch('http://' + hub.host + ':' + hub.port + '/emulators')).json();
assert.equal(running.storage?.host, storage.host); assert.equal(running.storage?.port, storage.port);
const f = await offlineEventFixture();
const denied = (promise, code) => assert.rejects(promise, error => error.code === 'functions/' + code);
try {
  const prepared = await f.prepare(); assert.equal(prepared.ok, true);
  const journal = offlineJournal(prepared.manifest);
  const input = { eventId: f.eventId, exportId: prepared.manifest.exportId, operations: journal.operations };
  const firstRound = prepared.manifest.rounds[0].id, firstTeam = prepared.manifest.teams[0].id;
  await f.call('saveEventScore', { eventId: f.eventId, snapshotId: f.snapshotId, roundId: firstRound, teamId: firstTeam, requestId: randomUUID(), expectedRevision: 0, halfPoints: 1, reason: '' });
  const resolutions = [{ teamId: firstTeam, roundId: firstRound, choice: 'offline', reason: 'Synthetic explicit reconciliation before reset' }];
  const preview = await f.call('previewOfflineSync', { ...input, resolutions });
  assert.equal(preview.resolutionAllowed, true); assert.deepEqual(preview.conflicts, []);
  const reset = await f.call('resetEventScores', { eventId: f.eventId, expectedRevision: (await f.event()).revision, requestId: randomUUID(), confirm: 'SMAZAT' });
  assert.equal(reset.scoringEpoch, 1);
  const scores = f.identity.db.collection('events/' + f.eventId + '/scores');
  assert.equal((await scores.get()).size, 0);
  await denied(f.call('previewOfflineSync', input), 'aborted');
  await denied(f.call('previewOfflineSync', { ...input, resolutions }), 'aborted');
  await denied(f.call('commitOfflineSync', { ...input, resolutions, previewDigest: preview.previewDigest }), 'aborted');
  assert.equal((await scores.get()).size, 0);
  console.log('PASS N11 offline: old export, old preview and explicit offline conflict resolution cannot resurrect reset scores');
  // A server-side legacy receipt must not bypass the epoch check either.
  const record = f.identity.db.doc('events/' + f.eventId + '/offlineExports/' + input.exportId);
  await record.update({ receipt: { exportId: input.exportId, sessionId: prepared.manifest.sessionId, receiptId: 'synthetic-old', headHash: journal.state.headHash,
    operationCount: journal.operations.length, rows: preview.local.rows, replayed: false } });
  await denied(f.call('commitOfflineSync', { ...input, resolutions, previewDigest: preview.previewDigest }), 'aborted');
  assert.equal((await scores.get()).size, 0);
  console.log('PASS N11 offline: old synchronized receipt is rejected before replay');
  const fresh = await f.prepare(); assert.equal(fresh.ok, true);
  const freshJournal = offlineJournal(fresh.manifest), freshInput = { eventId: f.eventId, exportId: fresh.manifest.exportId, operations: freshJournal.operations };
  const freshPreview = await f.call('previewOfflineSync', freshInput); assert.deepEqual(freshPreview.conflicts, []);
  const freshCommit = { ...freshInput, previewDigest: freshPreview.previewDigest };
  const receipt = await f.call('commitOfflineSync', freshCommit);
  assert.equal(receipt.replayed, false); assert.equal((await scores.get()).size, 20);
  assert.equal((await f.event()).scoring.epoch, 1); assert.equal((await f.event()).lifecycleStatus, 'completed');
  const replay = await f.call('commitOfflineSync', freshCommit); assert.equal(replay.replayed, true);
  assert.equal((await scores.get()).size, 20);
  console.log('PASS N11 offline: fresh export after reset synchronizes once and retains safe receipt replay');
} finally { await f.dispose(); }
