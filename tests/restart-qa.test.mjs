import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { PROJECT, RELEASE_SHA, RECEIPT_SHA256, QA_RUN_ID, USERS, qaPlan, validateCredentials, executeQa, assertQaReadback } from '../tools/staging/restart-qa-core.mjs';
import { qaStore, connectQaStore } from '../tools/staging/restart-qa-store.mjs';

const approval = () => ({ projectId: PROJECT, releaseSha: RELEASE_SHA, artifactReceiptSha256: RECEIPT_SHA256, qaRunId: QA_RUN_ID,
  expectedRevision: 19, expectedUpdateTime: '2026-10-12T19:00:00.123456Z', operatorEmail: 'operator@example.test',
  approvedBy: 'explicit-reviewing-owner-uid', approvalReference: 'synthetic-explicit-QA-write-approval', qaLifecycleDecision: 'retention-approved',
  qaLifecycleApprovalReference: 'synthetic-whole-QA-retention-approval', credentialsSha256: 'a'.repeat(64) });
const credentials = () => ({ mode: 'PRIVATE_RESTART_QA_CREDENTIALS', projectId: PROJECT, releaseSha: RELEASE_SHA, qaRunId: QA_RUN_ID,
  users: Object.fromEntries(USERS.map(user => [user.slot, { uid: user.uid, email: user.email, password: `SyntheticPrivate${user.slot}PasswordMustNeverLeak_123456789!aA9` }])) });
const finalTime = '2026-10-12T19:01:00.123456Z';
function fixture() {
  const plan = qaPlan(approval()), docs = new Map(), auth = new Map(), writes = [], history = [];
  docs.set(plan.controlName, { name: plan.controlName, fields: { collaborationEnabled: { booleanValue: false }, revision: { integerValue: '19' } }, updateTime: approval().expectedUpdateTime });
  const record = value => { history.push({ projectId: PROJECT, releaseSha: RELEASE_SHA, planSha256: plan.planSha256, ...structuredClone(value) }); };
  const store = {
    async read(name) { return structuredClone(docs.get(name) ?? null); },
    async identitiesAbsent() { return auth.size === 0; },
    async readAuth(uid) { return structuredClone(auth.get(uid) ?? null); },
    async createAuth(uid) {
      writes.push({ type: 'auth', uid });
      const user = USERS.find(user => user.uid === uid);
      auth.set(uid, { localId: uid, email: user.email, emailVerified: true, createdAt: '1791831600000' });
      return { localId: uid };
    },
    async commit(actual) {
      assert.deepEqual(actual, plan.writes); writes.push({ type: 'commit' });
      assert.equal(docs.get(plan.controlName).updateTime, plan.approval.expectedUpdateTime);
      for (const write of actual) {
        assert.equal(write.currentDocument.exists === false ? docs.has(write.update.name) : false, false);
        const fields = { ...structuredClone(write.update.fields) };
        for (const transform of write.updateTransforms) fields[transform.fieldPath] = { timestampValue: finalTime };
        docs.set(write.update.name, { name: write.update.name, fields, updateTime: finalTime });
      }
    },
  };
  const run = (options = {}) => executeQa({ plan, credentials: credentials(), store, history, record,
    ...(options.apply ? { confirmPlanSha256: plan.planSha256 } : {}), ...options });
  return { plan, docs, auth, writes, history, store, record, run };
}

test('exact frozen target, 2 create-only grants, paused CAS and attributed audit', () => {
  const plan = qaPlan(approval());
  assert.equal(plan.writes.length, 4); assert.equal(plan.memberships.length, 2);
  for (const write of plan.writes.slice(0, 3)) assert.deepEqual(write.currentDocument, { exists: false });
  assert.deepEqual(plan.writes[3].currentDocument, { updateTime: approval().expectedUpdateTime });
  assert.equal(plan.writes[3].update.fields.collaborationEnabled.booleanValue, false);
  assert.equal(plan.writes[3].update.fields.revision.integerValue, '20');
  const operator = plan.memberships[0].fields, viewer = plan.memberships[1].fields;
  assert.equal(operator.role.stringValue, 'manager'); assert.equal(viewer.role.stringValue, 'viewer');
  assert.equal(operator.quizzes.mapValue.fields.mode.stringValue, 'own'); assert.equal(operator.events.mapValue.fields.mode.stringValue, 'own');
  assert.equal(viewer.quizzes.mapValue.fields.mode.stringValue, 'none'); assert.equal(viewer.events.mapValue.fields.mode.stringValue, 'none');
  const operatorPermissions = operator.permissions.arrayValue.values.map(value => value.stringValue);
  assert.deepEqual(operatorPermissions, ['quiz.read', 'quiz.create', 'quiz.edit', 'quiz.answers.read', 'quiz.answers.edit', 'quiz.notes.read', 'quiz.notes.edit',
    'quiz.media.upload', 'quiz.media.attach', 'quiz.export', 'event.read', 'event.create', 'event.manage', 'event.live', 'event.score', 'event.contacts',
    'event.answers.read', 'event.notes.read', 'event.export', 'event.answers.export']);
  assert.deepEqual(viewer.permissions.arrayValue.values.map(value => value.stringValue), ['quiz.read', 'event.read']);
  assert.equal(plan.auditFields.actorUid.stringValue, 'reviewed-operator');
  assert.equal(plan.auditFields.changes.mapValue.fields.operatorEmail.stringValue, approval().operatorEmail);
  assert.equal(plan.auditFields.changes.mapValue.fields.approvedBy.stringValue, approval().approvedBy);
});

test('approval rejects foreign scope, owner/grant extras, false retention and malformed CAS', () => {
  for (const change of [{ projectId: 'production' }, { releaseSha: 'b'.repeat(40) }, { artifactReceiptSha256: 'b'.repeat(64) }, { qaRunId: 'other' },
    { owner: true }, { permissions: ['users.manage'] }, { qaLifecycleDecision: 'cleanup-approved' }, { qaLifecycleApprovalReference: '' },
    { expectedRevision: -1 }, { expectedRevision: Number.MAX_SAFE_INTEGER }, { expectedUpdateTime: '2026-02-30T19:00:00Z' }, { operatorEmail: '' }]) {
    assert.throws(() => qaPlan({ ...approval(), ...change }));
  }
});

test('private credentials must be exactly two synthetic identities with distinct strong passwords', () => {
  validateCredentials(credentials());
  for (const mutate of [c => { c.users.owner = c.users.operator; }, c => { c.users.operator.uid = 'real-user'; },
    c => { c.users.viewer.email = 'person@example.org'; }, c => { c.users.viewer.password = c.users.operator.password; },
    c => { c.users.viewer.password = 'weak'; }, c => { c.users.operator.token = 'sensitive-token'; }]) {
    const c = credentials(); mutate(c); assert.throws(() => validateCredentials(c));
  }
});

test('dry run performs no writes, reveals neither password nor credential attachment', async () => {
  const f = fixture(), result = await f.run();
  assert.equal(result.mode, 'DRY_RUN_NOT_AUTHORITY'); assert.deepEqual(f.writes, []);
  for (const c of Object.values(credentials().users)) assert(!JSON.stringify(result).includes(c.password));
  assert(!JSON.stringify(result).includes('"password"'));
});

test('password accidentally placed in approval is rejected before metadata reads or reporting', async () => {
  const f = fixture(), badPlan = qaPlan({ ...approval(), approvedBy: credentials().users.operator.password });
  await assert.rejects(f.run({ plan: badPlan }), /PRIVATE_PASSWORD_IN_PUBLIC_APPROVAL/); assert.deepEqual(f.writes, []);
});

test('apply requires exact confirmation and a durable recorder before any Auth write', async () => {
  const f = fixture();
  await assert.rejects(f.run({ apply: true, confirmPlanSha256: 'b'.repeat(64) })); assert.deepEqual(f.writes, []);
  await assert.rejects(f.run({ apply: true, record: undefined })); assert.deepEqual(f.writes, []);
  await assert.rejects(f.run({ apply: true, record() { throw new Error('disk full'); } })); assert.deepEqual(f.writes, []);
});

test('collisions and stale/unpaused state fail before any write', async () => {
  for (const mutate of [f => { f.auth.set(USERS[0].uid, {}); }, f => { f.docs.set(f.plan.memberships[1].name, {}); },
    f => { f.docs.set(f.plan.auditName, {}); }, f => { f.docs.get(f.plan.controlName).fields.collaborationEnabled.booleanValue = true; },
    f => { f.docs.get(f.plan.controlName).fields.revision.integerValue = '20'; }, f => { f.docs.get(f.plan.controlName).updateTime = finalTime; },
    f => { f.docs.delete(f.plan.controlName); }]) {
    const f = fixture(); mutate(f); await assert.rejects(f.run({ apply: true })); assert.deepEqual(f.writes, []);
  }
});

test('successful apply creates exactly two Auth users then single four-write CAS commit', async () => {
  const f = fixture(), result = await f.run({ apply: true });
  assert.equal(result.mode, 'APPLIED'); assert.equal(result.authCreates, 2); assert.equal(result.firestoreWrites, 4);
  assert.deepEqual(f.writes, [{ type: 'auth', uid: USERS[0].uid }, { type: 'auth', uid: USERS[1].uid }, { type: 'commit' }]);
  assert.deepEqual(f.history.map(row => row.mode), ['AUTH_CREATE_PENDING', 'AUTH_CREATED', 'AUTH_CREATE_PENDING', 'AUTH_CREATED', 'FIRESTORE_COMMIT_PENDING']);
  assert(!JSON.stringify([result, f.history]).includes('password'));
  await assert.rejects(f.run({ apply: true }), /PRIOR_WRITE_INTENT/); assert.equal(f.writes.length, 3);
  const reconciled = await f.run({ reconcile: true }); assert.equal(reconciled.mode, 'READ_RECONCILED_APPLIED'); assert.equal(f.writes.length, 3);
});

test('lost Auth response leaves pending ownership unconfirmed; reconciliation never resumes', async () => {
  const f = fixture(), create = f.store.createAuth;
  f.store.createAuth = async uid => { await create(uid); throw new Error('lost response SECRET_PASSWORD'); };
  await assert.rejects(f.run({ apply: true })); assert.equal(f.writes.length, 1);
  await assert.rejects(f.run({ apply: true }), /PRIOR_WRITE_INTENT/);
  const result = await f.run({ reconcile: true });
  assert.equal(result.mode, 'READ_RECONCILED_INCOMPLETE_NO_RETRY'); assert.deepEqual(result.confirmedOwnedAuthUids, []); assert.equal(f.writes.length, 1);
});

test('lost Firestore commit response reconciles exact audit and confirmed Auth without retry', async () => {
  const f = fixture(), commit = f.store.commit;
  f.store.commit = async writes => { await commit(writes); throw new Error('lost response'); };
  await assert.rejects(f.run({ apply: true })); assert.equal(f.writes.length, 3);
  assert.equal((await f.run({ reconcile: true })).mode, 'READ_RECONCILED_APPLIED'); assert.equal(f.writes.length, 3);
});

// Actual REST readback shape: protobuf omits values on empty arrays, including
// the doubly encoded grant inside the audit. Never drop the typed value itself.
function omitEmptyContainerMembers(value) {
  if (Array.isArray(value)) return value.map(omitEmptyContainerMembers);
  if (value === null || typeof value !== 'object') return value;
  if (Object.keys(value).length === 1 && Array.isArray(value.values) && value.values.length === 0) return {};
  if (Object.keys(value).length === 1 && value.fields && Object.keys(value.fields).length === 0) return {};
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, omitEmptyContainerMembers(item)]));
}

test('actual empty-container REST representation passes final readback and read-only reconciliation without changing plan', async () => {
  const f = fixture(), originalPlan = structuredClone(f.plan), commit = f.store.commit;
  f.store.commit = async writes => {
    await commit(writes);
    for (const [name, doc] of f.docs) f.docs.set(name, omitEmptyContainerMembers(doc));
  };
  assert.equal((await f.run({ apply: true })).mode, 'APPLIED');
  assert.deepEqual(f.docs.get(f.plan.memberships[0].name).fields.quizzes.mapValue.fields.ids, { arrayValue: {} });
  assert.notDeepEqual(f.docs.get(f.plan.auditName).fields.changes, f.plan.auditFields.changes);
  assert.equal((await f.run({ reconcile: true })).mode, 'READ_RECONCILED_APPLIED');
  assert.deepEqual(f.plan, originalPlan); assert.equal(f.writes.length, 3);
});

test('empty-container normalization rejects wrong types, missing grants, additional data and changed revisions', async () => {
  const mutations = [
    f => { f.docs.get(f.plan.memberships[0].name).fields.quizzes.mapValue.fields.ids = { mapValue: {} }; },
    f => { f.docs.get(f.plan.memberships[0].name).fields.quizzes.mapValue.fields.ids = {}; },
    f => { f.docs.get(f.plan.memberships[0].name).fields.quizzes.mapValue.fields.ids = { arrayValue: { values: null } }; },
    f => { f.docs.get(f.plan.memberships[0].name).fields.quizzes.mapValue.fields.ids = { arrayValue: { values: [], extra: true } }; },
    f => { f.docs.get(f.plan.memberships[0].name).fields.quizzes.mapValue.fields.ids = { arrayValue: { values: [{ stringValue: 'foreign-quiz' }] } }; },
    f => { delete f.docs.get(f.plan.memberships[0].name).fields.permissions; },
    f => { f.docs.get(f.plan.memberships[0].name).fields.role.stringValue = 'owner'; },
    f => { f.docs.get(f.plan.auditName).fields.changes.mapValue.fields.revision.integerValue = '21'; },
    f => { f.docs.get(f.plan.controlName).fields.revision.integerValue = '21'; },
    f => { f.docs.get(f.plan.auditName).fields.changes.mapValue.fields.identities.arrayValue.values[0].mapValue.fields.grant = { mapValue: {} }; },
  ];
  for (const mutate of mutations) {
    const f = fixture(); await f.run({ apply: true });
    for (const [name, doc] of f.docs) f.docs.set(name, omitEmptyContainerMembers(doc));
    mutate(f); await assert.rejects(f.run({ reconcile: true })); assert.equal(f.writes.length, 3);
  }
});

test('pure readback assertion requires both exact membership documents', async () => {
  const f = fixture(); await f.run({ apply: true });
  const audit = f.docs.get(f.plan.auditName), control = f.docs.get(f.plan.controlName);
  const members = f.plan.memberships.map(member => f.docs.get(member.name));
  assertQaReadback(audit, control, members, f.plan);
  for (const incomplete of [undefined, [], members.slice(0, 1), [...members, members[0]]]) {
    assert.throws(() => assertQaReadback(audit, control, incomplete, f.plan), /EXACT_QA_MEMBERSHIP_READBACK_REQUIRED/);
  }
});

test('pause changes or deleted/recreated/disabled Auth before commit leave users without membership', async () => {
  for (const mutate of [f => { f.docs.get(f.plan.controlName).updateTime = finalTime; },
    f => { f.auth.get(USERS[0].uid).createdAt = '999'; }, f => { f.auth.get(USERS[1].uid).disabled = true; },
    f => { f.auth.delete(USERS[0].uid); }]) {
    const f = fixture(), record = f.record;
    await assert.rejects(f.run({ apply: true, record(value) { record(value); if (value.mode === 'AUTH_CREATED' && value.uid === USERS[1].uid) mutate(f); } }));
    assert.equal(f.writes.filter(write => write.type === 'commit').length, 0);
  }
});

test('reconciliation denies modified grants, audit/control, Auth or foreign receipt', async () => {
  for (const mutate of [f => { f.docs.get(f.plan.memberships[0].name).fields.role.stringValue = 'owner'; },
    f => { f.docs.get(f.plan.auditName).fields.actorUid.stringValue = 'someone-else'; }, f => { f.docs.get(f.plan.controlName).updateTime = '2026-10-12T20:00:00Z'; },
    f => { f.auth.get(USERS[0].uid).createdAt = '777'; }, f => { f.history[0].releaseSha = 'b'.repeat(40); }]) {
    const f = fixture(); await f.run({ apply: true }); mutate(f); await assert.rejects(f.run({ reconcile: true })); assert.equal(f.writes.length, 3);
  }
  const f = fixture(); await assert.rejects(f.run({ reconcile: true })); assert.deepEqual(f.writes, []);
});

test('altered generated plan cannot widen writes', async () => {
  const f = fixture(); f.plan.writes[0].update.fields.role.stringValue = 'owner';
  await assert.rejects(f.run({ apply: true }), /ALTERED_QA_PLAN/); assert.deepEqual(f.writes, []);
});

function transports() {
  const calls = [];
  const client = label => ({
    async get(path, options) { calls.push({ label, method: 'GET', path, options }); return { body: null }; },
    async post(path, body, options) { calls.push({ label, method: 'POST', path, body, options }); return { body: path.endsWith('/accounts') ? { localId: body.localId } : {} }; },
  });
  return { calls, clients: { auth: client('auth'), firestore: client('firestore') } };
}

test('real store adapter permits only exact projected reads and reviewed creates/commit, with zero retries and no body logs', async () => {
  const plan = qaPlan(approval()), t = transports(), store = qaStore(plan, t.clients);
  await store.identitiesAbsent(); await store.readAuth(USERS[0].uid); await store.read(plan.controlName);
  await store.createAuth(USERS[0].uid, credentials().users.operator.password); await store.commit(plan.writes);
  assert.equal(t.calls.length, 6);
  assert(t.calls.every(call => call.options.retries === 0 && call.options.skipLog.body && call.options.skipLog.resBody && call.options.skipLog.queryParams));
  assert.deepEqual(t.calls[0].body, { localId: USERS.map(user => user.uid) }); assert.deepEqual(t.calls[1].body, { email: USERS.map(user => user.email) });
  assert.equal(t.calls[0].options.queryParams.fields, 'users(localId)');
  assert.equal(t.calls[2].options.queryParams.fields, 'users(localId,email,emailVerified,disabled,createdAt)');
  assert.equal(t.calls[4].path, `projects/${PROJECT}/accounts`); assert.equal(t.calls[4].body.emailVerified, true);
  assert(!t.calls.some(call => /delete|signIn|update|setAccount|batchCreate/u.test(call.path)));
  const count = t.calls.length;
  await assert.rejects(store.read(plan.controlName.replace(PROJECT, 'production')));
  await assert.rejects(store.readAuth('real-user')); await assert.rejects(store.createAuth('owner', credentials().users.operator.password));
  const bad = structuredClone(plan.writes); bad[3].update.fields.collaborationEnabled.booleanValue = true; await assert.rejects(store.commit(bad));
  assert.equal(t.calls.length, count);
});

test('transport errors never expose raw request/response credentials', async () => {
  const secret = credentials().users.operator.password, fail = async () => { throw Object.assign(new Error(secret), { context: { body: { password: secret } } }); };
  const store = qaStore(qaPlan(approval()), { auth: { post: fail }, firestore: { post: fail, get: fail } });
  for (const operation of [() => store.identitiesAbsent(), () => store.readAuth(USERS[0].uid), () => store.createAuth(USERS[0].uid, secret),
    () => store.commit(qaPlan(approval()).writes), () => store.read(qaPlan(approval()).controlName)]) {
    await assert.rejects(operation, error => !JSON.stringify(error).includes(secret) && !error.message.includes(secret));
  }
});

test('CLI attribution is pinned and skipAutoAuth true denies ADC, wrong operator or version', async () => {
  const plan = qaPlan(approval()), calls = [], t = transports();
  const modules = { package: { version: '15.34.2' }, auth: { getGlobalDefaultAccount: () => ({ user: { email: approval().operatorEmail } }) },
    requireAuth: { async requireAuth(options, skipAutoAuth) { calls.push({ options, skipAutoAuth }); return approval().operatorEmail; } },
    apiv2: { Client: class { constructor(options) { calls.push(options); return options.urlPrefix.includes('firestore') ? t.clients.firestore : t.clients.auth; } } } };
  await connectQaStore(plan, name => modules[name]);
  assert.equal(calls[0].skipAutoAuth, true); assert.equal(calls[0].options.project, PROJECT); assert.equal(calls[0].options.nonInteractive, true);
  assert.deepEqual(calls.slice(1), [{ urlPrefix: 'https://firestore.googleapis.com', apiVersion: 'v1' }, { urlPrefix: 'https://identitytoolkit.googleapis.com', apiVersion: 'v1' }]);
  modules.requireAuth.requireAuth = async () => null; await assert.rejects(connectQaStore(plan, name => modules[name]), /ADC_OR_OTHER/);
  modules.package.version = '15.28.3'; await assert.rejects(connectQaStore(plan, name => modules[name]), /PINNED/);
});

test('pinned real CLI transport supports suppressed sensitive body logging and retries:0', () => {
  const require = createRequire(import.meta.url), apiv2 = require('firebase-tools/lib/apiv2');
  assert.equal(require('firebase-tools/package.json').version, '15.34.2');
  const logger = require('firebase-tools/lib/logger').logger, original = logger.debug, logs = [];
  logger.debug = message => { logs.push(message); };
  try {
    const client = new apiv2.Client({ urlPrefix: 'https://identitytoolkit.googleapis.com', apiVersion: 'v1' });
    const options = { method: 'POST', path: `projects/${PROJECT}/accounts`, body: credentials().users.operator,
      skipLog: { body: true, resBody: true, queryParams: true }, queryParams: { fields: 'localId' }, retries: 0 };
    client.logRequest(options); client.logResponse({ status: 400 }, { error: { message: credentials().users.operator.password } }, options);
    assert(!JSON.stringify(logs).includes(credentials().users.operator.password)); assert(!JSON.stringify(logs).includes('"password"'));
    const source = readFileSync(require.resolve('firebase-tools/lib/apiv2'), 'utf8');
    assert.match(source, /operationOptions\.retries = options\.retries/u);
  } finally { logger.debug = original; }
});

test('actual CLI client method construction retains pinned projections and quiet zero-retry options', async () => {
  const require = createRequire(import.meta.url), { Client } = require('firebase-tools/lib/apiv2'), calls = [];
  const clients = Object.fromEntries(['auth', 'firestore'].map(kind => {
    const client = new Client({ urlPrefix: kind === 'auth' ? 'https://identitytoolkit.googleapis.com' : 'https://firestore.googleapis.com', apiVersion: 'v1' });
    // Stop at the real Client.request boundary; no authentication or HTTP occurs.
    client.request = async options => { calls.push({ kind, ...options }); return { body: {} }; };
    return [kind, client];
  }));
  const plan = qaPlan(approval()), store = qaStore(plan, clients);
  await store.identitiesAbsent(); await store.createAuth(USERS[0].uid, credentials().users.operator.password); await store.commit(plan.writes);
  assert(calls.every(call => call.method === 'POST' && call.retries === 0 && call.skipLog.body && call.skipLog.resBody));
  assert.equal(calls[2].queryParams.fields, 'localId'); assert.deepEqual(calls[3].body, { writes: plan.writes });
  assert.deepEqual(calls.map(call => call.kind), ['auth', 'auth', 'auth', 'firestore']);
});

test('offline executable help states retention approval and recovery limits without auth or sensitive output', () => {
  const output = execFileSync(process.execPath, ['tools/staging/restart-qa.mjs', '--help'], { encoding: 'utf8', timeout: 5000 });
  assert.match(output, /retention-approved/u); assert.match(output, /Auth and Firestore are not atomic/u); assert.match(output, /never resumes writes/u);
  for (const value of Object.values(credentials().users)) assert(!output.includes(value.password));
});
