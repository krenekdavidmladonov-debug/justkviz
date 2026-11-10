import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { defaultShowPreferences } from '../../packages/quiz-domain/lib/index.js';
import { editorIdentity } from './editor-identity.mjs';
import { syntheticAudio, syntheticImage } from './media-fixture.mjs';
import {
  hashOffline, offlineEventFixture, offlineJournal, offlinePrivateAnswer, offlinePrivateNote,
  verifyServerOfflineGrant, withLostOfflineAcknowledgement,
} from '../browser/offline-event-fixture.mjs';
import { requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';
import { requireDemoEmulators } from '../../functions/lib/media/local-event-manifest.js';

requireFullEmulatorEnvironment(process.env, 'Offline emulator acceptance');
const scenarios = [];
const fixtures = [], identities = [];
const denied = (promise, code) => assert.rejects(promise, error => error.code === 'functions/' + code);
const fixture = async options => { const value = await offlineEventFixture(options); fixtures.push(value); return value; };
async function eventFingerprint(f) {
  const records = [];
  async function visit(ref) {
    const document = await ref.get(); if (document.exists) records.push([ref.path, document.data()]);
    for (const collection of await ref.listCollections()) for (const document of (await collection.get()).docs) await visit(document.ref);
  }
  await visit(f.identity.db.doc('events/' + f.eventId));
  for (const session of (await f.identity.db.collection('sessions').where('eventId', '==', f.eventId).get()).docs) {
    await visit(session.ref); await visit(f.identity.db.doc('publicSessions/' + session.id));
  }
  records.sort(([a], [b]) => a.localeCompare(b));
  return { records: records.length, sha256: hashOffline(records) };
}

try {
  const f = await fixture();
  const require = createRequire(new URL('../../functions/package.json', import.meta.url));
  const cueBytes = syntheticAudio(5), cueAssetId = hashOffline('synthetic-offline-cue-' + randomUUID());
  const cueReference = `quiz-asset:${f.quizId}/${cueAssetId}`;
  const cueFile = require('firebase-admin/storage').getStorage(f.adminApp).bucket(f.environment.projectId + '.appspot.com')
    .file(`quiz-assets/${f.quizId}/${cueAssetId}/source`);
  await cueFile.save(cueBytes, { resumable: false, metadata: { contentType: 'audio/wav' } });
  const [cueMetadata] = await cueFile.getMetadata();
  await f.identity.db.doc(`quizzes/${f.quizId}/mediaAssets/${cueAssetId}`).set({ quizId: f.quizId, assetId: cueAssetId,
    kind: 'audio', contentType: 'audio/wav', size: cueBytes.length, generation: cueMetadata.generation,
    status: 'ready', storageBackend: 'storage', createdBy: f.user.uid });
  const showPreferences = { ...defaultShowPreferences, audioEnabled: true, cues: { winner: cueReference } };
  await f.call('configureEventShow', { eventId: f.eventId, expectedRevision: (await f.event()).revision, preferences: showPreferences });
  const unsupportedMusic = await f.prepare();
  assert.equal(unsupportedMusic.ok, false);
  assert(unsupportedMusic.issues.some(issue => issue.field === 'showPreferences.winner'));
  await f.call('configureEventShow', { eventId: f.eventId, expectedRevision: (await f.event()).revision,
    preferences: { ...showPreferences, audioEnabled: false } });
  scenarios.push('OFF-READINESS-real-owned-online-show-cue-blocks-READY-until-explicitly-disabled');
  const preflightInput = { eventId: f.eventId, preflight: true };
  const beforePreflight = await eventFingerprint(f);
  const preflightResponse = await f.raw('readOfflineTrust', preflightInput);
  assert.equal(preflightResponse.status, 200);
  assert.match(preflightResponse.headers.get('cache-control') ?? '', /no-store/u);
  const preflight = (await preflightResponse.json()).result;
  assert.deepEqual(Object.keys(preflight).sort(), ['expiresAtMs', 'issues', 'mediaBytes', 'mediaCount', 'snapshotId', 'teamCount']);
  assert.equal(preflight.snapshotId, f.snapshotId);
  assert.equal(preflight.teamCount, 10);
  assert.equal(preflight.mediaCount, 0);
  assert.deepEqual(preflight.issues, []);
  assert.equal((await f.raw('readOfflineTrust', preflightInput, { anonymous: true })).status, 401);
  await denied(f.call('prepareOfflineEvent', { eventId: f.eventId, requestId: randomUUID(), expectedSnapshotId: 'wrong-snapshot' }), 'aborted');
  await denied(f.call('prepareOfflineEvent', { eventId: f.eventId, requestId: randomUUID(), expectedActorId: 'wrong-actor' }), 'unauthenticated');
  assert.deepEqual(await eventFingerprint(f), beforePreflight);
  scenarios.push('OFF-WIZARD-authorized-read-only-preflight-no-export-no-secrets-snapshot-and-actor-bound');
  const response = await f.raw('prepareOfflineEvent', { eventId: f.eventId, requestId: randomUUID() });
  assert.equal(response.status, 200); assert.match(response.headers.get('cache-control') ?? '', /no-store/u);
  const prepared = (await response.json()).result;
  assert.equal(prepared.ok, true, 'Actual server must prepare the complete two-round synthetic quiz.');
  const trust = await f.call('readOfflineTrust', { eventId: f.eventId });
  verifyServerOfflineGrant(prepared, trust);
  scenarios.push('OFF-WIRE-canonical-transmitted-manifest-hash-exactly-matches-server-signature');
  assert.deepEqual(Object.keys(trust).sort(), ['audience', 'environment', 'keyId', 'publicJwk', 'schemaVersion']);
  assert(!JSON.stringify(trust).includes('PRIVATE KEY'));
  assert.equal(prepared.manifest.teams.length, 10); assert.equal(prepared.manifest.rounds.length, 2);
  assert.equal(prepared.manifest.baseScores.length, 20);
  assert(prepared.manifest.baseScores.every(score => score.halfPoints === null));
  for (const team of prepared.manifest.teams) assert.deepEqual(Object.keys(team).sort(), ['id', 'name', 'revision']);
  const serialized = JSON.stringify(prepared);
  assert(serialized.includes(offlinePrivateAnswer)); assert(serialized.includes(offlinePrivateNote));
  for (const forbidden of ['contactEmail', 'managementTokenHash', 'refereeAccess', 'refreshToken', 'password', 'privatePem']) assert(!serialized.includes(forbidden), forbidden);
  scenarios.push('OFF01-real-private-prepare-P256-server-pin-safe-roster-no-store');

  const authorize = { eventId: f.eventId, exportId: prepared.manifest.exportId, manifestDigest: prepared.grant.payload.manifestDigest };
  const authorization = await f.call('authorizeOfflineEvent', authorize);
  assert.deepEqual(Object.keys(authorization).sort(), ['expiresAtMs', 'exportId', 'manifestDigest']);
  await denied(f.call('authorizeOfflineEvent', { ...authorize, manifestDigest: '0'.repeat(64) }), 'failed-precondition');
  const anonymous = await f.raw('readOfflineTrust', { eventId: f.eventId }, { anonymous: true });
  assert.equal(anonymous.status, 401);
  const member = (await f.memberRef.get()).data();
  try {
    for (const permission of ['event.export', 'event.answers.read', 'event.answers.export', 'event.notes.read', 'event.score']) {
      await f.memberRef.update({ permissions: member.permissions.filter(value => value !== permission) });
      await denied(f.prepare(), 'permission-denied');
      await denied(f.call('readOfflineTrust', preflightInput), 'permission-denied');
    }
    await f.memberRef.update({ permissions: member.permissions, version: member.version + 1 });
    await denied(f.call('authorizeOfflineEvent', authorize), 'failed-precondition');
  } finally { await f.memberRef.set(member); }
  scenarios.push('OFF02-final-online-authorize-current-membership-concrete-permissions-version-denial');

  const journal = offlineJournal(prepared.manifest);
  const sync = { eventId: f.eventId, exportId: prepared.manifest.exportId, operations: journal.operations };
  const other = await editorIdentity(); identities.push(other);
  await denied(other.call('previewOfflineSync', sync), 'permission-denied');
  await denied(f.call('previewOfflineSync', { ...sync, operations: journal.operations.map((op, i) => i === 0 ? { ...op, hash: '0'.repeat(64) } : op) }), 'invalid-argument');
  const incomplete = offlineJournal(prepared.manifest, { ended: false });
  const incompletePreview = await f.call('previewOfflineSync', { ...sync, operations: incomplete.operations });
  assert.equal(incompletePreview.local.complete, false);
  await denied(f.call('commitOfflineSync', { ...sync, operations: incomplete.operations, previewDigest: incompletePreview.previewDigest }), 'failed-precondition');
  const preview = await f.call('previewOfflineSync', sync);
  assert.deepEqual(preview.conflicts, []); assert.equal(preview.local.complete, true);
  assert.equal(preview.local.scoreChanges, 20); assert.equal(preview.local.rows.length, 10);
  assert(preview.local.rows.every(row => row.rank === 1 && row.halfPoints === 22));
  assert.equal((await f.identity.db.collection(`events/${f.eventId}/scores`).get()).size, 0);
  scenarios.push('OFF03-preview-is-read-only-actor-bound-hash-chain-validates-complete-ending');

  const commit = { ...sync, previewDigest: preview.previewDigest };
  await withLostOfflineAcknowledgement(f, async base => {
    await assert.rejects(f.raw('commitOfflineSync', commit, { base }), /fetch failed|socket|terminated/iu);
  });
  const exportRecord = await f.identity.db.doc(`events/${f.eventId}/offlineExports/${prepared.manifest.exportId}`).get();
  assert.equal(exportRecord.get('status'), 'synchronized');
  const beforeReplay = await eventFingerprint(f);
  const receipt = await f.call('commitOfflineSync', commit);
  assert.equal(receipt.replayed, true); assert.equal(receipt.rows.length, 10);
  assert(receipt.rows.every(row => row.rank === 1 && row.halfPoints === 22));
  assert.deepEqual(await eventFingerprint(f), beforeReplay);
  assert.deepEqual(await f.call('commitOfflineSync', commit), receipt);
  assert.deepEqual(await eventFingerprint(f), beforeReplay);
  const scores = await f.identity.db.collection(`events/${f.eventId}/scores`).get();
  assert.equal(scores.size, 20);
  for (const score of scores.docs) {
    assert.equal(score.get('revision'), 1);
    const history = await score.ref.collection('history').get(); assert.equal(history.size, 1);
    assert.equal(history.docs[0].get('offlineExportId'), prepared.manifest.exportId);
  }
  const session = (await f.identity.db.doc('sessions/' + receipt.sessionId).get()).data();
  assert.equal(session.status, 'ended'); assert.equal(session.finalReveal.visible, false);
  assert.equal((await f.event()).lifecycleStatus, 'completed');
  const versions = await f.identity.db.collection(`sessions/${receipt.sessionId}/finalVersions`).get(); assert.equal(versions.size, 1);
  assert.equal(versions.docs[0].get('rows').length, 10);
  const publicState = (await f.identity.db.doc('publicSessions/' + receipt.sessionId).get()).data();
  assert.equal(publicState.status, 'ended');
  for (const field of ['finalReveal', 'revealedAnswer', 'moderatorNote', 'snapshotId', 'eventId', 'answerImage', 'mediaSource']) assert.equal(publicState[field], undefined);
  scenarios.push('OFF04-real-TCP-lost-ACK-after-commit-idempotent-retry-exact20scores20history-one-final-version');

  const conflicting = await fixture(), second = await conflicting.prepare(); assert.equal(second.ok, true);
  const secondJournal = offlineJournal(second.manifest);
  const secondSync = { eventId: conflicting.eventId, exportId: second.manifest.exportId, operations: secondJournal.operations };
  const oldPreview = await conflicting.call('previewOfflineSync', secondSync);
  const team = second.manifest.teams[0], round = second.manifest.rounds[0];
  await conflicting.call('saveEventScore', { eventId: conflicting.eventId, snapshotId: conflicting.snapshotId,
    teamId: team.id, roundId: round.id, halfPoints: 77, expectedRevision: 0, reason: '', requestId: randomUUID() });
  const newer = await eventFingerprint(conflicting);
  const conflictPreview = await conflicting.call('previewOfflineSync', secondSync);
  assert(conflictPreview.conflicts.some(conflict => conflict.teamId === team.id && conflict.online.halfPoints === 77));
  await denied(conflicting.call('commitOfflineSync', { ...secondSync, previewDigest: oldPreview.previewDigest }), 'aborted');
  await denied(conflicting.call('commitOfflineSync', { ...secondSync, previewDigest: conflictPreview.previewDigest }), 'aborted');
  assert.deepEqual(await eventFingerprint(conflicting), newer);
  scenarios.push('OFF05-concurrent-online-score-conflict-preserves-newer-data-no-partial-sync');

  assert.equal(conflictPreview.resolutionAllowed, true);
  const scoreRef = conflicting.identity.db.doc(`events/${conflicting.eventId}/scores/${hashOffline([team.id, round.id])}`);
  const existingHistory = (await scoreRef.collection('history').get()).docs.map(row => [row.id, row.data()]);
  const onlineChoice = [{ teamId: team.id, roundId: round.id, choice: 'online', reason: '' }];
  const chosen = { ...secondSync, resolutions: onlineChoice };
  const chosenPreview = await conflicting.call('previewOfflineSync', chosen);
  assert.deepEqual(chosenPreview.conflicts, []); assert(chosenPreview.merged.complete);
  assert.notEqual(chosenPreview.previewDigest, conflictPreview.previewDigest);
  await denied(conflicting.call('commitOfflineSync', { ...chosen, previewDigest: conflictPreview.previewDigest }), 'aborted');
  assert.deepEqual(await eventFingerprint(conflicting), newer);
  const chosenCommit = { ...chosen, previewDigest: chosenPreview.previewDigest };
  await withLostOfflineAcknowledgement(conflicting, async base => {
    await assert.rejects(conflicting.raw('commitOfflineSync', chosenCommit, { base }), /fetch failed|socket|terminated/iu);
  });
  const onlineReceipt = await conflicting.call('commitOfflineSync', chosenCommit);
  assert.equal(onlineReceipt.replayed, true); assert.deepEqual(onlineReceipt.rows, chosenPreview.merged.rows);
  assert.equal((await scoreRef.get()).get('halfPoints'), 77); assert.equal((await scoreRef.get()).get('revision'), 1);
  assert.deepEqual((await scoreRef.collection('history').get()).docs.map(row => [row.id, row.data()]), existingHistory);
  const selectedFingerprint = await eventFingerprint(conflicting);
  const { resolutions: _choices, ...noChoices } = chosenCommit; void _choices;
  assert.equal((await conflicting.call('commitOfflineSync', noChoices)).replayed, true);
  await denied(conflicting.call('commitOfflineSync', { ...chosenCommit, resolutions: [{ ...onlineChoice[0], choice: 'offline', reason: 'Changed decision after receipt' }] }), 'already-exists');
  assert.deepEqual(await eventFingerprint(conflicting), selectedFingerprint);
  const selectedExport = (await conflicting.identity.db.doc(`events/${conflicting.eventId}/offlineExports/${second.manifest.exportId}`).get()).data();
  assert.deepEqual(selectedExport.journal, secondJournal.operations);
  scenarios.push('OFF07-explicit-keep-online-choice-preview-binding-lost-ACK-history-preserved-idempotent-choice-receipt');

  const correctionFixture = await fixture(), third = await correctionFixture.prepare(); assert.equal(third.ok, true);
  const thirdJournal = offlineJournal(third.manifest), thirdTeam = third.manifest.teams[0], thirdRound = third.manifest.rounds[0];
  await correctionFixture.call('saveEventScore', { eventId: correctionFixture.eventId, snapshotId: correctionFixture.snapshotId,
    teamId: thirdTeam.id, roundId: thirdRound.id, halfPoints: 77, expectedRevision: 0, reason: '', requestId: randomUUID() });
  const thirdScore = correctionFixture.identity.db.doc(`events/${correctionFixture.eventId}/scores/${hashOffline([thirdTeam.id, thirdRound.id])}`);
  const originalOnlineHistory = (await thirdScore.collection('history').doc('1').get()).data();
  const reason = 'Synthetic explicit reconciliation of offline results';
  const offlineChoice = { teamId: thirdTeam.id, roundId: thirdRound.id, choice: 'offline', reason };
  const thirdSync = { eventId: correctionFixture.eventId, exportId: third.manifest.exportId, operations: thirdJournal.operations, resolutions: [offlineChoice] };
  await denied(correctionFixture.call('previewOfflineSync', { ...thirdSync, resolutions: [{ ...offlineChoice, reason: '' }] }), 'invalid-argument');
  const thirdPreview = await correctionFixture.call('previewOfflineSync', thirdSync);
  assert.deepEqual(thirdPreview.conflicts, []); assert(thirdPreview.merged.rows.every(row => row.rank === 1 && row.halfPoints === 22));
  const thirdReceipt = await correctionFixture.call('commitOfflineSync', { ...thirdSync, previewDigest: thirdPreview.previewDigest });
  assert.equal(thirdReceipt.replayed, false);
  assert.equal((await thirdScore.get()).get('revision'), 2);
  assert.equal((await thirdScore.get()).get('halfPoints'), 2 * Number(thirdTeam.name.slice(2)));
  assert.equal((await thirdScore.collection('history').get()).size, 2);
  assert.deepEqual((await thirdScore.collection('history').doc('1').get()).data(), originalOnlineHistory);
  const corrected = (await thirdScore.collection('history').doc('2').get()).data();
  assert.equal(corrected.reason, reason); assert.equal(corrected.previousHalfPoints, 77); assert.equal(corrected.resolutionChoice, 'offline');
  assert.deepEqual((await correctionFixture.identity.db.doc(`events/${correctionFixture.eventId}/offlineExports/${third.manifest.exportId}`).get()).get('journal'), thirdJournal.operations);
  scenarios.push('OFF08-explicit-offline-resolution-appends-revision-and-reason-retains-online-history-and-original-journal');

  const recoveryFixture = await fixture(), fourth = await recoveryFixture.prepare(); assert.equal(fourth.ok, true);
  const activeJournal = offlineJournal(fourth.manifest, { ended: false });
  assert.equal(activeJournal.state.status, 'active'); assert(activeJournal.operations.every(operation => operation.type !== 'end'));
  const recoverySync = { eventId: recoveryFixture.eventId, exportId: fourth.manifest.exportId, operations: activeJournal.operations };
  const ordinary = await recoveryFixture.call('previewOfflineSync', recoverySync);
  assert.equal(ordinary.local.complete, false);
  await denied(recoveryFixture.call('commitOfflineSync', { ...recoverySync, previewDigest: ordinary.previewDigest }), 'failed-precondition');
  const partial = { ...recoverySync, completeRecovery: true, operations: activeJournal.operations.slice(0, 4) };
  const partialPreview = await recoveryFixture.call('previewOfflineSync', partial);
  assert.equal(partialPreview.local.complete, false);
  await denied(recoveryFixture.call('commitOfflineSync', { ...partial, previewDigest: partialPreview.previewDigest }), 'failed-precondition');
  const explicitRecovery = { ...recoverySync, completeRecovery: true };
  const recoveryPreview = await recoveryFixture.call('previewOfflineSync', explicitRecovery);
  assert.equal(recoveryPreview.local.complete, true); assert.deepEqual(recoveryPreview.conflicts, []);
  const recoveryReceipt = await recoveryFixture.call('commitOfflineSync', { ...explicitRecovery, previewDigest: recoveryPreview.previewDigest });
  assert.equal(recoveryReceipt.completedFromRecovery, true); assert.equal(recoveryReceipt.replayed, false);
  assert(recoveryReceipt.rows.every(row => row.rank === 1 && row.halfPoints === 22));
  const recoveredRecord = (await recoveryFixture.identity.db.doc(`events/${recoveryFixture.eventId}/offlineExports/${fourth.manifest.exportId}`).get()).data();
  assert.deepEqual(recoveredRecord.journal, activeJournal.operations);
  assert(recoveredRecord.journal.every(operation => operation.type !== 'end'));
  assert.equal((await recoveryFixture.identity.db.doc('sessions/' + recoveryReceipt.sessionId).get()).get('status'), 'ended');
  assert.equal((await recoveryFixture.identity.db.collection(`sessions/${recoveryReceipt.sessionId}/finalVersions`).get()).size, 1);
  const recoveredFingerprint = await eventFingerprint(recoveryFixture);
  assert.equal((await recoveryFixture.call('commitOfflineSync', { ...explicitRecovery, previewDigest: recoveryPreview.previewDigest })).replayed, true);
  assert.deepEqual(await eventFingerprint(recoveryFixture), recoveredFingerprint);
  scenarios.push('OFF09-explicit-current-auth-finish-fully-scored-active-recovery-no-backdated-end-idempotent');

  // A real PNG must survive prepare's Firestore write; empty media arrays cannot
  // detect nested-array encoding failures. Pin conflicts are independent of scores.
  const pngBytes = syntheticImage();
  const mediaFixture = await fixture({ assets: [{ kind: 'image', contentType: 'image/png', bytes: pngBytes, width: 8, height: 4 }], imageOnly: true });
  const mediaRequestId = randomUUID();
  const mediaResponse = await mediaFixture.raw('prepareOfflineEvent', { eventId: mediaFixture.eventId, requestId: mediaRequestId });
  assert.equal(mediaResponse.status, 200, 'A real nonempty media pin must be persistable by Firestore.');
  assert.match(mediaResponse.headers.get('cache-control') ?? '', /no-store/u);
  const mediaPrepared = (await mediaResponse.json()).result;
  assert.equal(mediaPrepared.ok, true);
  const mediaTrust = await mediaFixture.call('readOfflineTrust', { eventId: mediaFixture.eventId });
  verifyServerOfflineGrant(mediaPrepared, mediaTrust);
  assert.equal(mediaPrepared.manifest.assets.length, 1);
  const png = mediaFixture.media[0], descriptor = mediaPrepared.manifest.assets[0];
  assert.equal(descriptor.reference, png.reference); assert.equal(descriptor.generation, png.generation);
  assert.equal(descriptor.kind, 'image'); assert.equal(descriptor.contentType, 'image/png');
  assert.equal(descriptor.size, pngBytes.length); assert.equal(descriptor.width, 8); assert.equal(descriptor.height, 4);
  assert.equal(descriptor.sha256, createHash('sha256').update(pngBytes).digest('hex'));
  assert(!JSON.stringify(mediaPrepared).includes('"mediaPins"'), 'Internal pin storage is not a new wire field.');
  const mediaExportRef = mediaFixture.identity.db.doc(`events/${mediaFixture.eventId}/offlineExports/${mediaPrepared.manifest.exportId}`);
  const pngRef = mediaFixture.identity.db.doc(`quizzes/${mediaFixture.quizId}/mediaAssets/${png.assetId}`);
  const originalPng = (await pngRef.get()).data();
  const gateway = new URL(`http://${mediaFixture.environment.functionsEndpoint.host}:${mediaFixture.environment.functionsEndpoint.port}/${mediaFixture.environment.projectId}/europe-west1/readQuizMedia`);
  gateway.searchParams.set('eventId', mediaFixture.eventId);
  gateway.searchParams.set('offlineExportId', mediaPrepared.manifest.exportId);
  gateway.searchParams.set('reference', png.reference);
  const token = await mediaFixture.user.getIdToken();
  const mediaHeaders = { Authorization: 'Bearer ' + token, 'If-Match': descriptor.etag };
  const pinnedRead = await fetch(gateway, { headers: mediaHeaders });
  assert.equal(pinnedRead.status, 200);
  assert.equal(pinnedRead.headers.get('cache-control'), 'no-store');
  assert.equal(pinnedRead.headers.get('etag'), descriptor.etag);
  assert.deepEqual(Buffer.from(await pinnedRead.arrayBuffer()), pngBytes);
  const differentExport = new URL(gateway);
  differentExport.searchParams.set('offlineExportId', '0'.repeat(64));
  assert.equal((await fetch(differentExport, { headers: mediaHeaders })).status, 404);
  assert.equal((await fetch(gateway, { headers: { ...mediaHeaders, 'If-Match': `"${'0'.repeat(64)}"` } })).status, 404);
  assert.equal((await fetch(gateway, { headers: { 'If-Match': descriptor.etag } })).status, 403);
  assert.equal((await fetch(gateway, { headers: { ...mediaHeaders, Range: 'bytes=0-1' } })).status, 400);
  try {
    await pngRef.update({ storageBackend: 'drive', generation: 'drive:synthetic-replacement' });
    const deniedDrive = await fetch(gateway, { headers: mediaHeaders });
    assert.equal(deniedDrive.status, 404);
    assert.equal((await deniedDrive.arrayBuffer()).byteLength, 0);
    assert.equal(deniedDrive.headers.get('etag'), null);
  } finally { await pngRef.set(originalPng); }
  scenarios.push('OFF-MEDIA-real-gateway-accepts-exact-export-pin-and-denies-anonymous-unpinned-range-drive');
  const expectedPin = { reference: png.reference, pin: { quizId: originalPng.quizId, assetId: originalPng.assetId,
    kind: originalPng.kind, contentType: originalPng.contentType, size: originalPng.size, generation: originalPng.generation,
    status: originalPng.status, storageBackend: originalPng.storageBackend ?? 'storage', drive: originalPng.drive ?? null } };
  assert.deepEqual((await mediaExportRef.get()).get('mediaPins'), [expectedPin]);
  const mediaReprepared = await mediaFixture.prepare(mediaRequestId);
  verifyServerOfflineGrant(mediaReprepared, mediaTrust);
  assert.deepEqual(mediaReprepared.manifest, mediaPrepared.manifest, 'Same request id preserves the canonical manifest.');
  const { signature: originalSignature, ...originalGrantAuthority } = mediaPrepared.grant;
  const { signature: repeatedSignature, ...repeatedGrantAuthority } = mediaReprepared.grant;
  assert.equal(typeof originalSignature, 'string'); assert.equal(typeof repeatedSignature, 'string');
  assert.deepEqual(repeatedGrantAuthority, originalGrantAuthority, 'Same request id preserves authority; valid ECDSA signatures need not have identical bytes.');
  await mediaFixture.call('authorizeOfflineEvent', { eventId: mediaFixture.eventId, exportId: mediaPrepared.manifest.exportId,
    manifestDigest: mediaPrepared.grant.payload.manifestDigest });
  const mediaJournal = offlineJournal(mediaPrepared.manifest);
  const mediaSync = { eventId: mediaFixture.eventId, exportId: mediaPrepared.manifest.exportId, operations: mediaJournal.operations };
  const validMediaPreview = await mediaFixture.call('previewOfflineSync', mediaSync);
  assert.deepEqual(validMediaPreview.conflicts, []); assert.equal(validMediaPreview.local.complete, true);
  const beforeMediaConflict = await eventFingerprint(mediaFixture);
  try {
    // Change only the own synthetic asset document; neither score baseline nor
    // snapshot is modified. The pin check must independently notice generation.
    await pngRef.update({ generation: String(BigInt(png.generation) + 1n) });
    assert.equal((await fetch(gateway, { headers: mediaHeaders })).status, 404);
    await denied(mediaFixture.call('authorizeOfflineEvent', { eventId: mediaFixture.eventId, exportId: mediaPrepared.manifest.exportId,
      manifestDigest: mediaPrepared.grant.payload.manifestDigest }), 'failed-precondition');
    const deniedMediaPreview = await mediaFixture.call('previewOfflineSync', mediaSync);
    assert(deniedMediaPreview.conflicts.some(conflict => /médium.*generaci/u.test(conflict.reason)));
    assert.equal(deniedMediaPreview.resolutionAllowed, false);
    assert.notEqual(deniedMediaPreview.previewDigest, validMediaPreview.previewDigest);
    await denied(mediaFixture.call('commitOfflineSync', { ...mediaSync, previewDigest: validMediaPreview.previewDigest }), 'aborted');
    await denied(mediaFixture.call('commitOfflineSync', { ...mediaSync, previewDigest: deniedMediaPreview.previewDigest }), 'aborted');
    assert.deepEqual(await eventFingerprint(mediaFixture), beforeMediaConflict, 'A changed media pin cannot partially synchronize.');
    assert.deepEqual((await mediaExportRef.get()).get('mediaPins'), [expectedPin]);
  } finally { await pngRef.set(originalPng); }
  // Pins and manifest assets must be a bijection, not merely an optional list of
  // constraints. Removing the only pin cannot bypass final authorization or sync.
  try {
    await mediaExportRef.update({ mediaPins: [] });
    const tamperedPinFingerprint = await eventFingerprint(mediaFixture);
    await denied(mediaFixture.call('authorizeOfflineEvent', { eventId: mediaFixture.eventId, exportId: mediaPrepared.manifest.exportId,
      manifestDigest: mediaPrepared.grant.payload.manifestDigest }), 'failed-precondition');
    await denied(mediaFixture.call('previewOfflineSync', mediaSync), 'failed-precondition');
    await denied(mediaFixture.call('commitOfflineSync', { ...mediaSync, previewDigest: validMediaPreview.previewDigest }), 'failed-precondition');
    assert.deepEqual(await eventFingerprint(mediaFixture), tamperedPinFingerprint);
  } finally { await mediaExportRef.update({ mediaPins: [expectedPin] }); }
  const restoredMediaPreview = await mediaFixture.call('previewOfflineSync', mediaSync);
  assert.deepEqual(restoredMediaPreview.conflicts, []);
  const mediaCommit = { ...mediaSync, previewDigest: restoredMediaPreview.previewDigest };
  const mediaReceipt = await mediaFixture.call('commitOfflineSync', mediaCommit);
  assert.equal(mediaReceipt.replayed, false); assert.equal(mediaReceipt.rows.length, 10);
  assert(mediaReceipt.rows.every(row => row.rank === 1 && row.halfPoints === 22));
  const mediaScores = await mediaFixture.identity.db.collection(`events/${mediaFixture.eventId}/scores`).get();
  assert.equal(mediaScores.size, 20);
  for (const score of mediaScores.docs) { assert.equal(score.get('revision'), 1); assert.equal((await score.ref.collection('history').get()).size, 1); }
  assert.equal((await mediaFixture.identity.db.collection(`sessions/${mediaReceipt.sessionId}/finalVersions`).get()).size, 1);
  assert.equal((await mediaFixture.identity.db.doc('sessions/' + mediaReceipt.sessionId).get()).get('status'), 'ended');
  assert.deepEqual((await mediaExportRef.get()).get('journal'), mediaJournal.operations);
  const afterMediaCommit = await eventFingerprint(mediaFixture);
  assert.equal((await mediaFixture.call('commitOfflineSync', mediaCommit)).replayed, true);
  assert.deepEqual(await eventFingerprint(mediaFixture), afterMediaCommit);
  scenarios.push('OFF10-real-owned-PNG-stored-pin-wire-hash-fresh-authorize-generation-conflict-pin-bijection-restored-sync-idempotent');

  const variables = ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'FUNCTIONS_EMULATOR', 'FIREBASE_AUTH_EMULATOR_HOST',
    'FIRESTORE_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST', 'STORAGE_EMULATOR_HOST'];
  const savedEnvironment = Object.fromEntries(variables.map(name => [name, process.env[name]]));
  const sdk = require('firebase-admin/app');
  assert(!sdk.getApps().some(app => app.name === '[DEFAULT]'), 'Guard probe must own its default app.');
  let guardApp = sdk.initializeApp({ projectId: f.environment.projectId });
  try {
    process.env.GCLOUD_PROJECT = f.environment.projectId; process.env.GOOGLE_CLOUD_PROJECT = f.environment.projectId;
    process.env.FUNCTIONS_EMULATOR = 'true'; process.env.STORAGE_EMULATOR_HOST = 'http://' + process.env.FIREBASE_STORAGE_EMULATOR_HOST;
    assert.doesNotThrow(requireDemoEmulators, 'Valid exact demo/default-app/loopback baseline must be accepted.');
    for (const name of variables) {
      const previous = process.env[name];
      try {
        process.env[name] = name.includes('PROJECT') ? 'demo-wrong-offline-project' : name === 'FUNCTIONS_EMULATOR' ? 'false'
          : name === 'STORAGE_EMULATOR_HOST' ? 'https://' + process.env.FIREBASE_STORAGE_EMULATOR_HOST : 'not-loopback.invalid:1234';
        assert.throws(requireDemoEmulators, error => error.code === 'failed-precondition', 'Independent guard must reject ' + name);
      } finally { process.env[name] = previous; }
      assert.doesNotThrow(requireDemoEmulators, 'Restored valid baseline must be accepted after ' + name);
    }
    await sdk.deleteApp(guardApp);
    guardApp = sdk.initializeApp({ projectId: 'demo-wrong-offline-app' });
    assert.throws(requireDemoEmulators, error => error.code === 'failed-precondition', 'Default SDK app identity is independently bound.');
  } finally {
    if (sdk.getApps().includes(guardApp)) await sdk.deleteApp(guardApp);
    for (const [name, value] of Object.entries(savedEnvironment)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
  scenarios.push('OFF06-compiled-boundary-fails-closed-for-non-demo-or-non-loopback-without-network');
  console.log(JSON.stringify({ status: 'PASS', scenarios, scoreCells: 20, historyMutations: 20, teams: 10,
    rounds: 2, expectedPointsPerTeam: 11, expectedHalfPointsPerTeam: 22, expectedRank: 1,
    limitations: ['Server-emulator acceptance only; complete offline persistent-browser campaign is separate.', 'Physical projector and hardware audio NOT TESTED.'],
    cost: 'Local synthetic demo emulators only; no cloud/deploy/paid services.' }, null, 2));
} finally {
  for (const identity of identities.reverse()) await identity.dispose();
  for (const value of fixtures.reverse()) await value.dispose();
}
