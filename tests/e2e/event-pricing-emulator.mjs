import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { emailFixture } from './registration-email-fixture.mjs';
import { requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';

requireFullEmulatorEnvironment(process.env, 'Event pricing contracts');
assert.equal(process.env.REGISTRATION_EMAIL_MODE, 'off');
assert.equal(process.env.REGISTRATION_OWNER_NOTIFICATION_MODE, 'off');
const fixture = await emailFixture();
const { eventId, eventRef, db, adminCall, publicCall } = fixture;
const publicRef = db.doc('publicEvents/' + eventId);
const input = { title: 'Synthetic pricing contract', startsAt: '2031-11-20T18:00:00Z', timeZone: 'Europe/Prague', venue: { name: 'Synthetic venue', publicLocation: 'Synthetic location' }, teamCapacity: 30, peopleCapacity: 120, teamSizeMin: 2, teamSizeMax: 4 };
const revision = async () => (await eventRef.get()).data().revision;
const update = async pricing => adminCall('updateEvent', { eventId, expectedRevision: await revision(), event: { ...input, ...(pricing === undefined ? {} : { pricing }) } });
const expectPrice = async pricing => {
  assert.deepEqual((await eventRef.get()).data().pricing, pricing);
  const projection = (await publicRef.get()).data();
  assert.deepEqual(projection.pricing, pricing.hidden ? { mode: 'agreement', amountCzk: null, hidden: true } : pricing);
  if (pricing.hidden && pricing.amountCzk !== null) assert.notEqual(projection.pricing.amountCzk, pricing.amountCzk);
  const detail = await adminCall('readAccessData', { operation: 'event', eventId });
  assert.deepEqual(detail.data.pricing, pricing);
  const page = await adminCall('readAccessData', { operation: 'eventPage' });
  assert.deepEqual(page.items.find(item => item.id === eventId).data.pricing, pricing);
  assert(!JSON.stringify(projection).includes('example.test'));
  assert(!('quizAssignment' in projection));
};
const denied = code => error => error.code === 'functions/' + code;
try {
  await expectPrice({ mode: 'per-team', amountCzk: 350 });
  const visible = { mode: 'per-event', amountCzk: 7500 };
  const custom = { ...visible, hidden: true };
  await update(custom); await expectPrice(custom);
  await update(undefined); await expectPrice(custom);
  await update(visible); await expectPrice(custom); // Cached old editor preserves visibility.
  await update({ ...visible, hidden: false }); await expectPrice(visible);
  await update(custom); await expectPrice(custom);
  const stale = (await revision()) - 1;
  await assert.rejects(adminCall('updateEvent', { eventId, expectedRevision: stale, event: { ...input, pricing: { mode: 'per-team', amountCzk: 1 } } }), denied('aborted'));
  await expectPrice(custom);
  const moderatorCall = await fixture.roleCall('moderator');
  await assert.rejects(moderatorCall('updateEvent', { eventId, expectedRevision: await revision(), event: { ...input, pricing: custom } }), denied('permission-denied'));
  await assert.rejects(publicCall('updateEvent', { eventId, expectedRevision: await revision(), event: { ...input, pricing: custom } }), denied('unauthenticated'));
  for (const pricing of [{ mode: 'per-team', amountCzk: -1 }, { mode: 'per-event', amountCzk: 1.5 }, { mode: 'per-team', amountCzk: '350' }, { mode: 'per-team', amountCzk: 1000001 }, { mode: 'agreement', amountCzk: 350 }, { mode: 'unknown', amountCzk: null }, { mode: 'per-team', amountCzk: 350, privateNote: 'never-public' }, { mode: 'per-team', amountCzk: 350, hidden: 'true' }, { mode: 'per-team', amountCzk: 350, hidden: null }]) {
    await assert.rejects(update(pricing), denied('invalid-argument')); await expectPrice(custom);
  }
  for (const published of [false, true]) {
    await adminCall('configureEventRegistration', { eventId, expectedRevision: await revision(), published }); await expectPrice(custom);
  }
  const registration = await publicCall('createEventRegistration', { eventId, requestKey: randomBytes(32).toString('base64url'), teamName: 'Synthetic pricing team', memberCount: 2, contactEmail: 'pricing@example.test' });
  await expectPrice(custom);
  const credentials = { eventId, registrationId: registration.registrationId, token: registration.managementToken };
  await publicCall('updateEventRegistration', { ...credentials, teamName: 'Synthetic updated team', memberCount: 3, contactEmail: 'pricing@example.test' }); await expectPrice(custom);
  await publicCall('cancelEventRegistration', credentials); await expectPrice(custom);
  const manual = await adminCall('adminAddEventTeam', { eventId, requestId: randomUUID(), teamName: 'Synthetic manual team', memberCount: 2 }); await expectPrice(custom);
  const manualRef = eventRef.collection('registrations').doc(manual.registrationId);
  await adminCall('adminUpdateEventTeam', { eventId, registrationId: manual.registrationId, expectedRevision: (await manualRef.get()).data().revision, teamName: 'Synthetic manual edited', memberCount: 3 }); await expectPrice(custom);
  await adminCall('adminCancelEventRegistration', { eventId, registrationId: manual.registrationId }); await expectPrice(custom);
  await update({ mode: 'agreement', amountCzk: null, hidden: false }); await expectPrice({ mode: 'agreement', amountCzk: null });
  await update({ mode: 'per-team', amountCzk: 0, hidden: true }); await expectPrice({ mode: 'per-team', amountCzk: 0, hidden: true });
  await adminCall('cancelEvent', { eventId, expectedRevision: await revision(), requestId: randomUUID() }); await expectPrice({ mode: 'per-team', amountCzk: 0, hidden: true });
  // Existing emulator contracts retain local participant intents even with cloud
  // activation off. The worker cannot dispatch them; this fixture never delivers.
  const intents = (await eventRef.collection('emailIntents').get()).docs.map(doc => doc.data());
  assert.equal(intents.length, 3);
  assert.deepEqual(intents.map(intent => intent.type).sort(), ['registration-cancelled', 'registration-confirmed', 'registration-updated']);
  for (const intent of intents) {
    assert.equal(intent.status, 'pending'); assert.equal(intent.attempts, 0); assert.equal(intent.sentAt, null);
  }
  assert.equal(fixture.capture.messages.size, 0);
  console.log('PASS: default/custom/zero/agreement and hidden pricing; public amounts redacted, private amounts retained; old clients preserve visibility, explicit unhide works; invalid/stale/unauthorized denial; all registration writers retain price/visibility; no email sent.');
} finally { await fixture.dispose(); }
