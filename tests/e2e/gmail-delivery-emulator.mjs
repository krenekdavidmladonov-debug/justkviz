import { strict as assert } from 'node:assert';
import { randomBytes, randomUUID } from 'node:crypto';
import { emailFixture } from './registration-email-fixture.mjs';
import { requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';
import { processEmailTask } from '../../functions/lib/email/task.js';
import { EmailDeliveryError } from '../../functions/lib/email/errors.js';
import { MAX_EMAIL_ATTEMPTS } from '../../functions/lib/email/delivery.js';
import { GmailEmailTransport, GMAIL_SEND_SCOPE } from '../../functions/lib/email/gmail.js';

let fixture;
let phase = 'setup';
const check = (condition, label) => assert.ok(condition, label);
try {
  fixture = await emailFixture({ gmail: true });
  const { eventRef, eventId, capture, publicCall } = fixture;
  // These are independent provider scenarios, not a rate-limit bypass in the handler.
  // Stage a synthetic idle contact; the real callable performs its normal refill/debit.
  // The dedicated registration-abuse suite never mutates its budget fixture.
  const refillProviderScenario = async () => {
    requireFullEmulatorEnvironment(process.env, 'Independent synthetic provider scenario');
    const budgets = await eventRef.collection('registrationAbuse').get();
    await Promise.all(budgets.docs.map(item => item.ref.update({ updatedAtMillis: Math.max(0, Date.now() - 1_800_000) })));
  };

  const input = name => ({ teamName: name, memberCount: 3, contactEmail: 'gmail-team@example.test' });
  const create = async name => {
    const team = await publicCall('createEventRegistration', { eventId, requestKey: randomBytes(32).toString('base64url'), ...input(name) });
    const intent = (await fixture.intents(team.registrationId))[0];
    return { team, ref: intent.ref };
  };
  const task = ref => fixture.deliverTask(ref);
  const data = async ref => (await ref.get()).data();
  const retry = promise => assert.rejects(promise, error => error instanceof EmailDeliveryError && error.retryable);
  phase = 'registration, update and cancellation through Gmail task';
  await refillProviderScenario();
  const { team, ref } = await create('Gmail průchod');
  await task(ref); await task(ref);
  const managed = { eventId, registrationId: team.registrationId, token: team.managementToken };
  await publicCall('updateEventRegistration', { ...managed, requestId: randomUUID(), ...input('Gmail změna') });
  const update = (await fixture.intents(team.registrationId)).find(doc => doc.data().type === 'registration-updated');
  await task(update.ref);
  await publicCall('cancelEventRegistration', managed);
  const cancel = (await fixture.intents(team.registrationId)).find(doc => doc.data().type === 'registration-cancelled');
  await task(cancel.ref);
  check(capture.submissions.length === 3 && (await data(ref)).status === 'sent' && (await data(cancel.ref)).status === 'sent', phase);
  check(Buffer.from(capture.submissions[0], 'base64url').toString().includes('Content-Type: multipart/alternative'), 'Actual MIME path');
  const confirmationLink = /Spravovat registraci: (\S+)/u.exec(capture.messages.get(ref.path).text)?.[1];
  const updatedLink = /Spravovat registraci: (\S+)/u.exec(capture.messages.get(update.ref.path).text)?.[1];
  check(Boolean(confirmationLink) && updatedLink === confirmationLink, 'Create and update MIME contain the same protected management capability');
  console.log('PASS: registration/update/cancel through shared task and fake Gmail MIME, terminal task replay');

  phase = 'legacy update without envelope remains deliverable without a replacement capability';
  await refillProviderScenario();
  const legacy = await create('Gmail starší změna');
  await publicCall('updateEventRegistration', { eventId, registrationId: legacy.team.registrationId, token: legacy.team.managementToken,
    requestId: randomUUID(), ...input('Gmail starší změna upravená') });
  const legacyUpdate = (await fixture.intents(legacy.team.registrationId)).find(doc => doc.data().type === 'registration-updated');
  await eventRef.collection('emailSecrets').doc(legacyUpdate.id).delete(); // Reproduce the actual old persisted update shape.
  await task(legacyUpdate.ref);
  const legacyMessage = capture.messages.get(legacyUpdate.ref.path);
  check((await data(legacyUpdate.ref)).status === 'sent' && !legacyMessage.text.includes('Spravovat registraci:') && !legacyMessage.html.includes('href='), phase);
  check((await fixture.intents(legacy.team.registrationId)).length === 2, 'Legacy fallback creates no additional intent');
  console.log('PASS: old update without envelope sends once without a CTA or new intent');

  phase = 'malformed update envelope fails closed before provider submission';
  await refillProviderScenario();
  const corrupt = await create('Gmail porušená změna');
  await publicCall('updateEventRegistration', { eventId, registrationId: corrupt.team.registrationId, token: corrupt.team.managementToken,
    requestId: randomUUID(), ...input('Gmail porušená změna upravená') });
  const corruptUpdate = (await fixture.intents(corrupt.team.registrationId)).find(doc => doc.data().type === 'registration-updated');
  await eventRef.collection('emailSecrets').doc(corruptUpdate.id).set({ envelope: fixture.vault.seal(corrupt.team.managementToken, 'events/foreign/emailIntents/foreign') });
  const beforeCorrupt = capture.submissions.length;
  await task(corruptUpdate.ref); await task(corruptUpdate.ref);
  check((await data(corruptUpdate.ref)).status === 'failed' && capture.submissions.length === beforeCorrupt, phase);
  console.log('PASS: cross-intent ciphertext on update fails closed and terminal task replay sends nothing');

  phase = 'transient retry with backoff';
  await refillProviderScenario();
  const transient = await create('Gmail přechodná');
  capture.nextFailure = 'rate-limit';
  await retry(task(transient.ref));
  check((await data(transient.ref)).status === 'pending' && (await data(transient.ref)).attempts === 1, phase);
  await retry(task(transient.ref));
  check((await data(transient.ref)).attempts === 1, 'Early retry does not consume send attempt');
  fixture.advance(); await task(transient.ref);
  check((await data(transient.ref)).status === 'sent' && (await data(transient.ref)).attempts === 2, phase);
  console.log('PASS: transient failure, persisted backoff, early task retry and eventual acceptance');

  phase = 'permanent credentials failure';
  await refillProviderScenario();
  const permanent = await create('Gmail neplatné oprávnění');
  capture.nextFailure = 'invalid-grant';
  await task(permanent.ref); await task(permanent.ref);
  check((await data(permanent.ref)).status === 'failed' && (await data(permanent.ref)).attempts === 1 && (await data(permanent.ref)).lastError === 'credentials-invalid', phase);
  console.log('PASS: invalid_grant is terminal, queue replay cannot resend');

  phase = 'unknown send outcome is terminal and cannot produce an automatic duplicate';
  await refillProviderScenario();
  const unknown = await create('Gmail ztracená odpověď');
  const beforeUnknown = capture.submissions.length;
  capture.nextFailure = 'after-accept';
  await task(unknown.ref);
  fixture.advance(); await task(unknown.ref);
  check(capture.submissions.length === beforeUnknown + 1, 'A lost Gmail response is not automatically submitted twice');
  check((await data(unknown.ref)).status === 'failed' && (await data(unknown.ref)).lastError === 'outcome-unknown'
    && (await data(unknown.ref)).attempts === 1, 'Unknown outcome requires manual verification, not false sent status');
  console.log('PASS: accepted message with response loss remains review-required; terminal replay never resubmits');

  phase = 'legacy pending unknown outcome stops before another send or retry wait';
  await refillProviderScenario();
  const LegacyTimestamp = (await data(unknown.ref)).createdAt.constructor;
  await unknown.ref.update({ status: 'pending', lastError: 'outcome-unknown', nextAttemptAt: LegacyTimestamp.fromMillis(fixture.clock() + 60000) });
  await task(unknown.ref); await task(unknown.ref);
  check(capture.submissions.length === beforeUnknown + 1 && (await data(unknown.ref)).status === 'failed'
    && (await data(unknown.ref)).attempts === 1 && (await data(unknown.ref)).lastError === 'outcome-unknown', phase);
  console.log('PASS: legacy pending/outcome-unknown terminalizes immediately without a new submission');

  phase = 'Gmail send timeout performs one submission and no automatic replay';
  await refillProviderScenario();
  const timeout = await create('Gmail timeout'); let timeoutSends = 0;
  const timeoutTransport = new GmailEmailTransport({ projectId: process.env.GCLOUD_PROJECT, clientId: 'synthetic-client', clientSecret: 'synthetic-secret',
    refreshToken: 'synthetic-refresh', sender: 'sender@example.test' }, async url => {
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'synthetic', token_type: 'Bearer', scope: GMAIL_SEND_SCOPE });
    assert.equal(url, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send'); timeoutSends++;
    return new Promise(() => {});
  }, 5);
  const timeoutTask = () => processEmailTask({ eventId, intentId: timeout.ref.id }, { db: fixture.db, transport: timeoutTransport,
    vault: fixture.vault, origin: 'http://127.0.0.1:5196', clock: fixture.clock });
  await timeoutTask(); fixture.advance(); await timeoutTask();
  check(timeoutSends === 1 && (await data(timeout.ref)).status === 'failed' && (await data(timeout.ref)).lastError === 'outcome-unknown', phase);
  console.log('PASS: actual Gmail adapter timeout records review-required and task replay sends nothing');

  phase = 'crash after provider acceptance before sent finalization';
  await refillProviderScenario();
  const lostFinalization = await create('Gmail crash po přijetí'); let transactionCalls = 0;
  const crashDb = { collection: name => fixture.db.collection(name), runTransaction: callback => {
    if (++transactionCalls === 2) throw new Error('Synthetic finalization crash');
    return fixture.db.runTransaction(callback);
  } };
  const beforeFinalization = capture.submissions.length;
  await assert.rejects(processEmailTask({ eventId, intentId: lostFinalization.ref.id }, { db: crashDb, transport: capture,
    vault: fixture.vault, origin: 'http://127.0.0.1:5196', clock: fixture.clock }), /Synthetic finalization crash/u);
  check((await data(lostFinalization.ref)).status === 'processing' && capture.submissions.length === beforeFinalization + 1, 'Provider accepted before the failed finalization');
  fixture.advance(); await task(lostFinalization.ref); await task(lostFinalization.ref);
  check((await data(lostFinalization.ref)).status === 'failed' && (await data(lostFinalization.ref)).lastError === 'outcome-unknown'
    && (await data(lostFinalization.ref)).attempts === 1 && capture.submissions.length === beforeFinalization + 1, 'Expired processing lease never resubmits after acceptance');
  const summary = (await eventRef.collection('registrations').doc(lostFinalization.team.registrationId).get()).data().emailDelivery;
  check(summary.status === 'failed', 'Organizer is not shown a false sent or indefinitely processing status');
  console.log('PASS: crash between acceptance and sent commit ends in review-required with one physical submission');

  phase = 'concurrent workers and processing status';
  await refillProviderScenario();
  const concurrent = await create('Gmail souběh');
  let release, started;
  const entered = new Promise(resolve => { started = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  const slow = { send: async message => { started(); await blocked; await capture.send(message); } };
  const first = processEmailTask({ eventId, intentId: concurrent.ref.id }, { db: fixture.db, transport: slow, vault: fixture.vault, origin: 'http://127.0.0.1:5196', clock: fixture.clock });
  await entered;
  check((await data(concurrent.ref)).status === 'processing', phase);
  await retry(task(concurrent.ref));
  release(); await first;
  check((await data(concurrent.ref)).attempts === 1 && (await data(concurrent.ref)).status === 'sent', phase);
  const [differentA, differentB] = await Promise.all([create('Paralelní A'), create('Paralelní B')]);
  await Promise.all([task(differentA.ref), task(differentB.ref)]);
  check(capture.messages.get(differentA.ref.path).text.includes('Paralelní A') && capture.messages.get(differentB.ref.path).text.includes('Paralelní B'), 'Independent concurrent intents');
  console.log('PASS: active lease retries, processing status and concurrent distinct intents remain isolated');

  phase = 'maximum known-rejection attempts and crash terminalization';
  await refillProviderScenario();
  const exhausted = await create('Gmail maximum');
  for (let attempt = 1; attempt <= MAX_EMAIL_ATTEMPTS; attempt++) {
    capture.nextFailure = 'rate-limit';
    if (attempt < MAX_EMAIL_ATTEMPTS) await retry(task(exhausted.ref)); else await task(exhausted.ref);
    fixture.advance();
  }
  await task(exhausted.ref);
  check((await data(exhausted.ref)).attempts === MAX_EMAIL_ATTEMPTS && (await data(exhausted.ref)).status === 'failed', phase);
  const crashed = await create('Gmail poslední crash');
  const Timestamp = (await data(crashed.ref)).createdAt.constructor;
  await crashed.ref.update({ status: 'processing', attempts: MAX_EMAIL_ATTEMPTS, leaseId: 'synthetic-crash', leaseUntil: Timestamp.fromMillis(fixture.clock() - 1) });
  const beforeCrash = capture.submissions.length;
  await task(crashed.ref);
  check((await data(crashed.ref)).status === 'failed' && capture.submissions.length === beforeCrash, 'Crash exhausted attempt terminalizes without send');
  console.log('PASS: max attempts and last-attempt crash terminalization prevent unbounded sends');

  phase = 'missing vault and malformed binding fail closed';
  await refillProviderScenario();
  const missing = await create('Gmail bez klíče');
  const beforeMissing = capture.submissions.length;
  await processEmailTask({ eventId, intentId: missing.ref.id }, { db: fixture.db, transport: capture,
    vault: () => { throw new EmailDeliveryError('configuration-invalid', false); }, origin: 'http://127.0.0.1:5196', clock: fixture.clock });
  check((await data(missing.ref)).status === 'failed' && capture.submissions.length === beforeMissing, phase);
  const foreign = await create('Gmail cizí binding');
  await foreign.ref.update({ eventId: 'foreign-event' });
  await task(foreign.ref);
  check((await data(foreign.ref)).status === 'failed' && capture.submissions.length === beforeMissing, phase);
  const persisted = JSON.stringify((await eventRef.collection('emailIntents').get()).docs.map(doc => doc.data()));
  check(!persisted.includes(team.managementToken) && !persisted.includes('Bearer ') && !persisted.includes('#registration='), 'No plaintext/provider data in audit');
  console.log('PASS: missing vault, foreign intent binding and plaintext/provider audit exclusion');
} catch {
  console.error('FAIL: Gmail delivery contracts — ' + phase);
  process.exitCode = 1;
} finally { if (fixture) await fixture.dispose(); }
