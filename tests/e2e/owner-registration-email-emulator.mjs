import { strict as assert } from 'node:assert';
import { randomBytes, randomUUID } from 'node:crypto';
import { emailFixture } from './registration-email-fixture.mjs';
import { registrationOwnerNotificationActivation } from '../../functions/lib/email/runtime.js';
import { ownerNotificationIntentId } from '../../functions/lib/email/organizer.js';
import { deliverRegistrationEmail } from '../../functions/lib/email/delivery.js';
import { requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';

// Start Functions with REGISTRATION_OWNER_NOTIFICATION_MODE=emulator,
// REGISTRATION_OWNER_NOTIFICATION_RECIPIENT=owner-notifications@example.test,
// REGISTRATION_OWNER_NOTIFICATION_OWNER_UID=owner-notifications-synthetic,
// REGISTRATION_OWNER_NOTIFICATION_ACTIVATED_AT=2020-01-01T00:00:00.000Z.
// All delivery uses the local CaptureEmailTransport; no cloud Tasks or Gmail.
let fixture, ownerRef, phase = 'guarded setup', createdOwner = false;
const check = (value, label) => { phase = label; assert.ok(value, label); };
try {
  requireFullEmulatorEnvironment(process.env, 'Owner notification contracts');
  const activation = registrationOwnerNotificationActivation();
  check(process.env.REGISTRATION_OWNER_NOTIFICATION_MODE === 'emulator'
    && activation?.ownerUid === 'owner-notifications-synthetic'
    && activation.recipient === 'owner-notifications@example.test', 'explicit isolated synthetic owner configuration');
  fixture = await emailFixture();
  fixture.advance(60_000); // Owner provenance rejects future timestamps; callable creation uses the real emulator clock.
  const { eventRef, eventId, db, publicCall, adminCall, capture } = fixture;
  ownerRef = db.doc('memberships/' + activation.ownerUid);
  check(!(await ownerRef.get()).exists, 'synthetic owner must not replace an existing membership');
  const member = { uid: activation.ownerUid, email: 'historical-owner@example.test', role: 'owner', status: 'active', version: 1,
    sessionValidAfter: 0, permissions: ['event.read', 'event.contacts'], events: { mode: 'selected', ids: [eventId] }, quizzes: { mode: 'none', ids: [] } };
  await ownerRef.create(member); createdOwner = true;
  const input = (name, requestKey = randomBytes(32).toString('base64url')) => ({ eventId, teamName: name, memberCount: 2,
    contactEmail: 'participant@example.test', requestKey, recipient: 'attacker@example.test', ownerUid: 'attacker', source: 'manual',
    createdAt: '1900-01-01T00:00:00.000Z', registrationCreatedAt: '1900-01-01T00:00:00.000Z' });
  const create = data => publicCall('createEventRegistration', data);
  // These are independent provider scenarios, not a rate-limit bypass in the handler.
  // Stage a synthetic idle contact; the real callable performs its normal refill/debit.
  // The dedicated registration-abuse suite never mutates its budget fixture.
  const refillProviderScenario = async () => {
    requireFullEmulatorEnvironment(process.env, 'Independent synthetic provider scenario');
    const budgets = await eventRef.collection('registrationAbuse').get();
    await Promise.all(budgets.docs.map(item => item.ref.update({ updatedAtMillis: Math.max(0, Date.now() - 1_800_000) })));
  };

  const ownerIntent = async team => {
    const snapshot = await eventRef.collection('emailIntents').doc(ownerNotificationIntentId(team.registrationId)).get();
    check(snapshot.exists, 'public create writes the deterministic organizer intent'); return snapshot;
  };
  const recordRef = team => eventRef.collection('registrations').doc(team.registrationId);
  const summary = async team => (await recordRef(team).get()).data().emailDelivery;
  let vaultReads = 0, transportResolutions = 0;
  const deliver = (ref, transport = capture) => deliverRegistrationEmail(db, ref,
    () => { transportResolutions++; return transport; }, () => { vaultReads++; throw new Error('Organizer must never access participant secrets.'); },
    'http://127.0.0.1:5196', fixture.clock);
  phase = 'concurrent create and request replay';
  await refillProviderScenario();
  const request = input('Owner notification team');
  const [team, replay] = await Promise.all([create(request), create(request)]);
  check(team.registrationId === replay.registrationId && team.managementToken === replay.managementToken, 'concurrent create returns one registration');
  const initial = await fixture.intents(team.registrationId), organizer = await ownerIntent(team);
  check(initial.length === 2 && initial.filter(doc => doc.data().type === 'registration-organizer-notification').length === 1,
    'one participant intent and one organizer intent');
  check(organizer.data().recipient === activation.recipient && organizer.data().ownerUid === activation.ownerUid, 'browser cannot redirect owner notification');
  check(JSON.stringify(organizer.data()).includes('participant@example.test') === false
    && JSON.stringify(organizer.data()).includes(team.managementToken) === false, 'organizer intent contains no participant contact or capability');
  const participantSummary = await summary(team);
  check(participantSummary.type === 'registration-confirmed' && participantSummary.status === 'pending', 'participant summary stays on participant confirmation');
  await assert.rejects(create({ ...request, teamName: 'Conflicting replay' }), error => error.code === 'functions/already-exists');
  check((await fixture.intents(team.registrationId)).length === 2, 'failed create has no extra owner intent');
  await fixture.deliver(initial.find(doc => doc.data().type === 'registration-confirmed').ref);
  const participantSent = await summary(team);
  check(await deliver(organizer.ref) === 'sent', 'owner notification independently delivers');
  assert.deepEqual(await summary(team), participantSent);
  const ownerMessage = capture.messages.get(organizer.ref.path);
  check(ownerMessage.to === activation.recipient && ownerMessage.text.includes('/admin/events/' + eventId + '/registrations'), 'captured owner message uses authenticated roster URL');
  check(!JSON.stringify(ownerMessage).includes(team.managementToken) && !JSON.stringify(ownerMessage).includes('participant@example.test')
    && !JSON.stringify(ownerMessage).includes('registration/manage'), 'captured owner message has no contact or management capability');
  check(await deliver(organizer.ref) === 'unchanged' && vaultReads === 0, 'terminal replay performs no resend or vault access');
  await create(request);
  check((await fixture.intents(team.registrationId)).length === 2, 'lost create-response recovery never recreates owner intent');
  console.log('PASS: atomic deterministic owner intent, browser spoof resistance, independent participant delivery and no resend');

  phase = 'historical create receipt is never backfilled';
  await refillProviderScenario();
  // Reproduce a pre-activation persisted receipt by removing only this synthetic
  // notification. The original reservation, counters and participant email remain.
  const historicalInput = input('Historical replay team'), historical = await create(historicalInput);
  await (await ownerIntent(historical)).ref.delete();
  await create(historicalInput);
  check((await fixture.intents(historical.registrationId)).every(doc => doc.data().type !== 'registration-organizer-notification'), 'historical create replay never backfills missing organizer intent');

  phase = 'update cancellation and manual operations';
  await refillProviderScenario();
  const managed = { eventId, registrationId: team.registrationId, token: team.managementToken };
  await publicCall('updateEventRegistration', { ...managed, requestId: randomUUID(), teamName: 'Changed owner notification team', memberCount: 2, contactEmail: 'changed@example.test' });
  await publicCall('cancelEventRegistration', managed);
  check((await fixture.intents(team.registrationId)).filter(doc => doc.data().type === 'registration-organizer-notification').length === 1, 'edit and cancel create no organizer notification');
  const manual = await adminCall('adminAddEventTeam', { eventId, requestId: randomUUID(), teamName: 'Manual owner team', memberCount: 2, contactEmail: 'manual@example.test' });
  await adminCall('adminUpdateEventTeam', { eventId, registrationId: manual.registrationId, expectedRevision: 1, teamName: 'Edited manual owner team', memberCount: 2, contactEmail: 'manual@example.test' });
  await adminCall('adminCancelEventRegistration', { eventId, registrationId: manual.registrationId });
  check((await fixture.intents(manual.registrationId)).length === 0, 'manual add edit and cancel create no email intent');
  const cancelled = await create(input('Cancelled before owner delivery')), cancelledOwner = await ownerIntent(cancelled);
  await publicCall('cancelEventRegistration', { eventId, registrationId: cancelled.registrationId, token: cancelled.managementToken });
  const cancelledSummary = await summary(cancelled);
  check(await deliver(cancelledOwner.ref) === 'sent', 'successful create notification still delivers after participant cancellation');
  assert.deepEqual(await summary(cancelled), cancelledSummary);
  check((await fixture.intents(cancelled.registrationId)).filter(doc => doc.data().type === 'registration-organizer-notification').length === 1,
    'cancellation leaves exactly the original create notification');
  console.log('PASS: missing historical intent is not backfilled; update, cancellation and manual add emit no owner message');

  phase = 'recipient tampering and live authorization revocation';
  await refillProviderScenario();
  const tampered = await create(input('Recipient tamper team')), tamperedIntent = await ownerIntent(tampered);
  await tamperedIntent.ref.update({ recipient: 'attacker@example.test' });
  const beforeTampered = (await tamperedIntent.ref.get()).data(), beforeResolutions = transportResolutions;
  check(await deliver(tamperedIntent.ref) === 'unchanged', 'wrong recipient is denied before claiming');
  assert.deepEqual((await tamperedIntent.ref.get()).data(), beforeTampered);
  check(transportResolutions === beforeResolutions, 'wrong recipient resolves no provider');
  for (const [name, changes] of [['suspended', { status: 'suspended' }], ['permission', { permissions: ['event.read'] }], ['scope', { events: { mode: 'selected', ids: ['different-event'] } }]]) {
    await refillProviderScenario();
    const current = await create(input('Revoked ' + name)), currentIntent = await ownerIntent(current), before = await summary(current), count = capture.messages.size;
    await ownerRef.update(changes);
    check(await deliver(currentIntent.ref) === 'failed', 'current owner ' + name + ' blocks delivery');
    check(capture.messages.size === count, 'revoked owner receives no message');
    assert.deepEqual(await summary(current), before);
    await ownerRef.set(member);
    check(await deliver(currentIntent.ref) === 'unchanged', 'restoring authority never automatically resends skipped notification');
  }
  console.log('PASS: owner recipient tampering, suspension, permission loss and event scope revocation prevent physical send');

  phase = 'provider failures remain independent and uncertain acceptance never resends';
  await refillProviderScenario();
  const failed = await create(input('Failed owner delivery')), failedIntent = await ownerIntent(failed), beforeFailure = await summary(failed);
  capture.nextFailure = 'before-accept';
  check(await deliver(failedIntent.ref) === 'pending', 'known provider nonacceptance schedules bounded retry');
  assert.deepEqual(await summary(failed), beforeFailure);
  fixture.advance(); check(await deliver(failedIntent.ref) === 'sent', 'known nonacceptance retries successfully');
  const unknown = await create(input('Unknown owner outcome')), unknownIntent = await ownerIntent(unknown), beforeUnknown = await summary(unknown), count = capture.messages.size;
  // Fixture time was advanced for retries; keep delivery ahead of real create time.
  capture.nextFailure = 'after-accept';
  check(await deliver(unknownIntent.ref) === 'failed', 'uncertain provider acceptance is terminal');
  fixture.advance(); check(await deliver(unknownIntent.ref) === 'unchanged', 'uncertain owner delivery never automatically resends');
  check(capture.messages.size === count + 1 && (await unknownIntent.ref.get()).data().attempts === 1, 'unknown owner outcome has only one physical attempt');
  assert.deepEqual(await summary(unknown), beforeUnknown);
  check(vaultReads === 0, 'all organizer delivery avoids participant vault');
  console.log('PASS: owner provider outage and unknown acceptance preserve participant status; unknown acceptance never resends');
} catch {
  // Never print caught SDK assertions: they may contain captured bearer URLs.
  console.error('FAIL: owner registration notification contracts — ' + phase); process.exitCode = 1;
} finally {
  if (ownerRef && createdOwner) await ownerRef.delete();
  if (fixture) await fixture.dispose();
}
