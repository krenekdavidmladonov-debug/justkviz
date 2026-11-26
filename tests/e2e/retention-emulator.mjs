import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';
import { requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';
import { runRetention } from '../../functions/lib/retention/engine.js';
import { retentionConfiguration, runEventRetention } from '../../functions/lib/retention/scheduler.js';

const env = requireFullEmulatorEnvironment(process.env, 'Contact retention acceptance');
const require = createRequire(new URL('../../functions/package.json', import.meta.url));
const admin = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const inspector = admin.initializeApp({ projectId: env.projectId });
const db = getFirestore(inspector);
const app = initializeApp({ projectId: env.projectId, apiKey: 'demo-api-key' });
const functions = getFunctions(app, 'europe-west1');
connectFunctionsEmulator(functions, env.functionsEndpoint.host, env.functionsEndpoint.port);
const auth = getAuth(app);
connectAuthEmulator(auth, `http://${env.authEndpoint.host}:${env.authEndpoint.port}`, { disableWarnings: true });
const call = async (name, data) => (await httpsCallable(functions, name)(data)).data;
const now = new Date('2026-11-26T10:00:00Z');
const daysAgo = days => Timestamp.fromMillis(now.getTime() - days * 86_400_000);
const run = (mode, options = {}) => runRetention(db, { mode, now, ...options });
const token = randomBytes(32).toString('base64url');
const contact = 'retention-sentinel@example.test';
const registration = { teamName: 'Tým Alfa', memberCount: 3, status: 'accepted', createdAt: daysAgo(1),
  contactEmail: contact, contactPerson: 'Kontaktní osoba', phone: '+420000000000', notes: 'Citlivá poznámka',
  legacyExtension: { contact }, requestFingerprint: 'sensitive', emailDelivery: { intentId: 'mail' },
  managementTokenHash: createHash('sha256').update(token).digest('hex') };
const oldEvent = { startsAt: daysAgo(410), lifecycleStatus: 'completed', completion: { at: daysAgo(91) },
  teamCapacity: 10, peopleCapacity: 50, teamSizeMin: 1, teamSizeMax: 5, revision: 1 };
const event = name => db.doc('events/retention-' + name);
const team = ref => ref.collection('registrations').doc('team');
const artifacts = ['emailIntents', 'emailSecrets', 'emailCampaigns', 'registrationOperations', 'registrationAbuse'];
const eventRefs = [];
async function seed(name, fields) {
  const ref = event(name);
  await ref.create(fields);
  eventRefs.push(ref);
  await team(ref).create({ ...registration, eventId: ref.id });
  return ref;
}
async function state() {
  const refs = [db.collection('events'), db.collectionGroup('registrations'), ...artifacts.map(name => db.collectionGroup(name)),
    db.collection('retentionAudit'), db.collection('retentionState')];
  return Promise.all(refs.map(async query => (await query.get()).docs.map(doc => [doc.ref.path, doc.updateTime]).sort()));
}

try {
  const previous = await seed('old', { ...oldEvent, lifecycleStatus: 'scheduled' });
  const credentials = { eventId: previous.id, registrationId: 'team', token };
  assert.equal((await call('getEventRegistration', credentials)).contactEmail, contact);
  await previous.update({ lifecycleStatus: 'completed' });
  const preserved = await Promise.all([
    seed('young', { ...oldEvent, completion: { at: daysAgo(89) } }),
    seed('boundary', { ...oldEvent, completion: { at: daysAgo(90) } }),
    seed('future', { ...oldEvent, startsAt: daysAgo(-2) }),
    seed('missing', { ...oldEvent, completion: {} }),
    seed('live', { ...oldEvent, lifecycleStatus: 'live' }),
    seed('trash', { ...oldEvent, disposition: 'trash' }),
    seed('restoring', { ...oldEvent, restoreInProgress: true }),
    seed('delivery', oldEvent), seed('active-session', oldEvent),
    seed('missing-pointer', { ...oldEvent, liveSessionId: 'retention-missing' }),
    seed('foreign-pointer', { ...oldEvent, liveSessionId: 'retention-busy' }),
    seed('recent-cancellation', { ...oldEvent, lifecycleStatus: 'cancelled', cancellation: { at: daysAgo(2) } }),
  ]);
  await db.doc('sessions/retention-busy').create({ eventId: event('active-session').id, status: 'active' });
  await event('delivery').collection('emailIntents').doc('leased').create({ status: 'processing', leaseUntil: daysAgo(-1) });
  const cancelled = await seed('cancelled', { ...oldEvent, lifecycleStatus: 'cancelled', cancellation: { at: daysAgo(380) } });
  for (const collection of artifacts) await previous.collection(collection).doc('private').create({ payload: contact });
  const results = [previous.collection('scores').doc('pair'), previous.collection('scores').doc('pair').collection('history').doc('one'),
    db.doc('publicEventResults/' + previous.id), previous.collection('registrationNames').doc('unique')];
  const score = { teamName: registration.teamName, points: 17, rank: 2 };
  for (const ref of results) await ref.create(score);

  const before = await state();
  assert.deepEqual(retentionConfiguration({}), { mode: 'off', resultsMode: 'off' });
  assert.deepEqual(retentionConfiguration({ JUSTKVIZ_CONTACT_RETENTION_MODE: 'true', JUSTKVIZ_RESULTS_RETENTION_MODE: 'apply' }), { mode: 'off', resultsMode: 'off' });
  assert(runEventRetention.__endpoint.scheduleTrigger);
  assert(!runEventRetention.__endpoint.httpsTrigger && !runEventRetention.__endpoint.callableTrigger);
  assert.equal((await run('off')).scannedEvents, 0);
  const preview = await run('preview', { resultsMode: 'preview' });
  assert.equal(preview.anonymized, 2);
  assert.equal(preview.deleted, artifacts.length);
  assert.equal(preview.resultsCandidates, 1);
  assert.equal(preview.writtenDocuments, 0);
  assert.deepEqual(await state(), before, 'Off and preview must preserve every document and update time');

  const applied = await run('apply');
  assert.equal(applied.anonymized, 2);
  assert.equal(applied.deleted, artifacts.length);
  for (const ref of [previous, cancelled]) {
    const data = (await team(ref).get()).data();
    assert.deepEqual(Object.keys(data).sort(), ['teamName','memberCount','status','createdAt','eventId','contactsAnonymizedAt','contactRetentionVersion'].sort());
    assert.equal(data.teamName, registration.teamName);
    assert.equal((await ref.get()).get('contactRetention.state'), 'complete');
  }
  for (const ref of preserved) assert.deepEqual((await team(ref).get()).data(), { ...registration, eventId: ref.id });
  for (const ref of results) assert.deepEqual((await ref.get()).data(), score);
  for (const collection of artifacts) assert((await previous.collection(collection).get()).empty);
  for (const name of ['getEventRegistration', 'updateEventRegistration', 'cancelEventRegistration']) {
    await assert.rejects(call(name, { ...credentials, teamName: 'Nový tým', memberCount: 2, contactEmail: contact }),
      error => error.code === 'functions/not-found' && error.message.includes('Bezpečný odkaz není platný.'));
  }
  await signInWithEmailAndPassword(auth, 'admin@example.test', 'LocalQuiz123!');
  assert.deepEqual(await call('readAccessData', { operation: 'registrations', eventId: previous.id }), []);
  assert.deepEqual(await call('readAccessData', { operation: 'roster', eventId: previous.id }),
    [{ id: 'team', data: { teamName: registration.teamName, status: 'accepted' } }]);
  await assert.rejects(call('adminUpdateEventTeam', { ...credentials, action: 'reissueLink', expectedRevision: 0, requestId: 'retention-reissue' }));
  await assert.rejects(call('restoreEvent', { eventId: cancelled.id, action: 'prepare', expectedRevision: 1 }),
    error => error.code === 'functions/failed-precondition');
  const after = await state();
  const repeated = await run('apply');
  assert.equal(repeated.anonymized + repeated.deleted, 0);
  assert.deepEqual(await state(), after);

  const large = await seed('large', oldEvent);
  const batch = db.batch();
  for (let i = 0; i < 205; i++) batch.create(large.collection('registrations').doc('team-' + i), { ...registration, eventId: large.id });
  await batch.commit();
  await large.collection('emailSecrets').doc('last-envelope').create({ payload: contact });
  const beforePages = await state();
  let previewCursor, plannedTeams = 0, plannedMail = 0, pages = 0;
  do {
    const page = await run('preview', { previewCursor, maxDocuments: 60, eventLimit: 4 });
    assert(page.examinedDocuments <= 60 && page.writtenDocuments === 0);
    plannedTeams += page.anonymized;
    plannedMail += page.deleted;
    previewCursor = page.nextPreviewCursor;
    assert(++pages < 20, 'Preview must make progress within and between events');
  } while (previewCursor);
  assert.equal(plannedTeams, 206);
  assert.equal(plannedMail, 1);
  assert.deepEqual(await state(), beforePages);
  const first = await run('apply');
  assert(first.anonymized > 0 && first.anonymized < 206 && first.writtenDocuments <= 200);
  assert.equal((await large.get()).get('contactRetention.state'), 'processing');
  const next = await Promise.all([run('apply'), run('apply')]);
  assert(next.every(step => step.writtenDocuments <= 200));
  assert.equal(first.anonymized + next.reduce((sum, step) => sum + step.anonymized, 0), 206);
  assert.equal((await large.get()).get('contactRetention.state'), 'complete');
  const audit = (await db.collection('retentionAudit').get()).docs.map(doc => doc.data());
  assert.equal(audit.reduce((sum, row) => sum + row.documents, 0), 209 + artifacts.length);
  for (const row of audit) {
    assert.deepEqual(Object.keys(row).sort(), ['version','action','eventId','at','anonymized','deleted','documents'].sort());
    assert(eventRefs.some(ref => row.eventId === ref.id) && row.at instanceof Timestamp);
    assert.equal(row.action, 'contacts-anonymized');
  }
  console.log('PASS contact retention: default, preview, date boundaries, busy events, old links, roster, scoped data, bounded concurrency and audit.');
} finally {
  // Only this suite's named fixtures are removed before the other demo acceptance suites.
  for (const ref of eventRefs) await db.recursiveDelete(ref);
  await db.doc('sessions/retention-busy').delete();
  await db.doc('publicEventResults/' + event('old').id).delete();
  await Promise.all([deleteApp(app), admin.deleteApp(inspector)]);
}
