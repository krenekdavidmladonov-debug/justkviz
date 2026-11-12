import assert from 'node:assert/strict';
import test from 'node:test';
import { executePause, pausePlan } from '../../tools/access/pause-collaboration-core.mjs';
import { connectPauseStore, pauseStore } from '../../tools/access/pause-collaboration-store.mjs';

const approval = { projectId: 'demo-pause-test', releaseSha: 'd'.repeat(40), expectedRevision: 18,
  expectedUpdateTime: '2026-09-16T06:11:29.023025Z', operatorEmail: 'operator@example.test', approvedBy: 'synthetic-reviewer', approvalReference: 'synthetic-local-approval' };
const timestamp = '2026-10-12T20:00:00.000000Z';
function fixture(input = approval) {
  const plan = pausePlan(input), documents = new Map();
  documents.set(plan.controlName, { name: plan.controlName, updateTime: input.expectedUpdateTime, fields: {
    revision: { integerValue: String(input.expectedRevision) }, collaborationEnabled: { booleanValue: true }, sentinel: { stringValue: 'preserve' },
  } });
  let commits = 0;
  const store = {
    read: async name => structuredClone(documents.get(name) ?? null),
    async commit(writes) {
      // Emulates atomic preconditions before any state mutation; real REST behavior
      // is independently exercised by pause-collaboration-emulator.mjs.
      assert.equal(documents.get(plan.controlName).updateTime, writes[0].currentDocument.updateTime);
      assert(!documents.has(writes[1].update.name));
      commits++;
      documents.set(plan.controlName, { ...documents.get(plan.controlName), updateTime: timestamp,
        fields: { ...documents.get(plan.controlName).fields, ...writes[0].update.fields, updatedAt: { timestampValue: timestamp } } });
      documents.set(plan.auditName, { ...writes[1].update, updateTime: timestamp, fields: { ...writes[1].update.fields, at: { timestampValue: timestamp } } });
    },
  };
  return { plan, documents, store, commits: () => commits };
}

test('dry-run validates exact state without committing and preserves nanosecond CAS', async () => {
  const f = fixture();
  const result = await executePause({ approval, store: f.store });
  assert.equal(result.mode, 'DRY_RUN'); assert.equal(f.commits(), 0);
  assert.equal(result.plan.writes[0].currentDocument.updateTime, approval.expectedUpdateTime);
  assert.deepEqual(result.plan.writes[0].updateMask.fieldPaths, ['collaborationEnabled', 'revision']);
  assert.deepEqual(result.plan.writes[1].currentDocument, { exists: false });
});

test('exact apply atomically changes only control fields and creates safe audit; replay does not commit', async () => {
  const f = fixture(); let journaled = false;
  const result = await executePause({ approval, store: f.store, apply: true, confirmPlanSha256: f.plan.planSha256,
    beforeCommit: async value => { assert.equal(f.commits(), 0); assert.equal(value.mode, 'COMMIT_OUTCOME_PENDING'); journaled = true; } });
  assert(journaled); assert.equal(result.mode, 'APPLIED'); assert.equal(f.commits(), 1);
  assert.equal(f.documents.size, 2);
  assert.equal(f.documents.get(f.plan.controlName).fields.sentinel.stringValue, 'preserve');
  const replay = await executePause({ approval, store: f.store, apply: true, confirmPlanSha256: f.plan.planSha256 });
  assert.equal(replay.mode, 'ALREADY_APPLIED'); assert.equal(f.commits(), 1);
});

test('reordered review JSON yields the same immutable operation', () => {
  const reordered = Object.fromEntries(Object.entries(approval).reverse());
  assert.deepEqual(pausePlan(reordered), pausePlan(approval));
});

test('foreign target, unknown fields, invalid revision/date or missing review are rejected', () => {
  for (const patch of [{ projectId: 'production' }, { resume: true }, { expectedRevision: -1 }, { expectedRevision: Number.MAX_SAFE_INTEGER },
    { expectedRevision: '18' }, { expectedUpdateTime: '2026-02-31T06:11:29Z' }, { expectedUpdateTime: '2026-10-12' },
    { releaseSha: 'main' }, { approvedBy: '' }, { approvalReference: 'line\nbreak' }]) assert.throws(() => pausePlan({ ...approval, ...patch }));
});

test('apply without exact plan confirmation never reads or writes', async () => {
  const store = { read: () => assert.fail('unexpected read'), commit: () => assert.fail('unexpected commit') };
  await assert.rejects(executePause({ approval, store, apply: true }), /hash required/u);
});

test('changed enabled flag, revision, updateTime, absent or foreign state cannot commit', async () => {
  for (const mutation of [doc => { doc.fields.collaborationEnabled.booleanValue = false; }, doc => { doc.fields.revision.integerValue = '19'; },
    doc => { doc.updateTime = timestamp; }, doc => { doc.name = 'foreign'; }]) {
    const f = fixture(); mutation(f.documents.get(f.plan.controlName));
    await assert.rejects(executePause({ approval, store: f.store, apply: true, confirmPlanSha256: f.plan.planSha256 })); assert.equal(f.commits(), 0);
  }
  const f = fixture(); f.documents.clear();
  await assert.rejects(executePause({ approval, store: f.store })); assert.equal(f.commits(), 0);
});

test('concurrent change after review fails the commit CAS and creates no audit', async () => {
  const f = fixture();
  await assert.rejects(executePause({ approval, store: f.store, apply: true, confirmPlanSha256: f.plan.planSha256,
    beforeCommit: () => { f.documents.get(f.plan.controlName).updateTime = timestamp; } }));
  assert.equal(f.commits(), 0); assert(!f.documents.has(f.plan.auditName));
});

test('failed local intent persistence prevents remote commit', async () => {
  const f = fixture();
  await assert.rejects(executePause({ approval, store: f.store, apply: true, confirmPlanSha256: f.plan.planSha256,
    beforeCommit: () => { throw Error('disk unavailable'); } }), /disk unavailable/u);
  assert.equal(f.commits(), 0);
});

test('lost commit response can be reconciled without another write', async () => {
  const f = fixture(), commit = f.store.commit;
  f.store.commit = async writes => { await commit(writes); throw Error('lost response'); };
  await assert.rejects(executePause({ approval, store: f.store, apply: true, confirmPlanSha256: f.plan.planSha256 }), /lost response/u);
  assert.equal(f.commits(), 1);
  assert.equal((await executePause({ approval, store: f.store })).mode, 'ALREADY_APPLIED'); assert.equal(f.commits(), 1);
});

test('an existing different audit or drift after an applied pause is not accepted', async () => {
  const f = fixture(); f.documents.set(f.plan.auditName, { name: f.plan.auditName, fields: { at: { timestampValue: timestamp } } });
  await assert.rejects(executePause({ approval, store: f.store }), /Audit does not match/u); assert.equal(f.commits(), 0);
  f.documents.delete(f.plan.auditName);
  await executePause({ approval, store: f.store, apply: true, confirmPlanSha256: f.plan.planSha256 });
  f.documents.get(f.plan.controlName).fields.revision.integerValue = '20';
  await assert.rejects(executePause({ approval, store: f.store }), /revision changed/u); assert.equal(f.commits(), 1);
  f.documents.get(f.plan.controlName).fields.revision.integerValue = '19';
  f.documents.get(f.plan.controlName).updateTime = '2026-10-12T20:01:00Z';
  await assert.rejects(executePause({ approval, store: f.store }), /changed after audited pause/u); assert.equal(f.commits(), 1);
});

test('REST adapter fixes paths, disables mutation retry and handles only genuine not-found', async () => {
  const plan = pausePlan(approval), calls = [];
  const client = { post: async (...args) => { calls.push(args); }, get: async () => { throw { status: 404 }; } };
  const store = pauseStore(plan, client);
  await store.commit(plan.writes);
  assert.deepEqual(calls, [[`projects/${approval.projectId}/databases/(default)/documents:commit`, { writes: plan.writes }, { retries: 0 }]]);
  assert.equal(await store.read(plan.auditName), null);
  await assert.rejects(store.read('foreign'));
  await assert.rejects(store.commit([]));
  client.get = async () => { throw Error('not 404'); };
  await assert.rejects(store.read(plan.controlName), /not 404/u);
});

test('cloud connector binds authenticated CLI account, pins CLI and refuses fallback before client creation', async () => {
  const plan = pausePlan({ ...approval, projectId: 'filmovy-kviz-v2-staging' });
  let created = 0, accountEmail = approval.operatorEmail, returnEmail = approval.operatorEmail, version = '15.34.2';
  const cli = name => ({
    package: { version }, auth: { getGlobalDefaultAccount: () => ({ user: { email: accountEmail }, tokens: { synthetic: true } }) },
    requireAuth: { requireAuth: async (options, skipAutoAuth) => { assert.equal(skipAutoAuth, true); assert.equal(options.user.email, approval.operatorEmail); return returnEmail; } },
    apiv2: { Client: class { constructor(options) { assert.deepEqual(options, { urlPrefix: 'https://firestore.googleapis.com', apiVersion: 'v1' }); created++; } } },
  })[name];
  await connectPauseStore(plan, cli); assert.equal(created, 1);
  accountEmail = 'different@example.test'; await assert.rejects(connectPauseStore(plan, cli), /differs/u);
  accountEmail = approval.operatorEmail; returnEmail = null; await assert.rejects(connectPauseStore(plan, cli), /no ADC/u);
  returnEmail = approval.operatorEmail; version = 'future'; await assert.rejects(connectPauseStore(plan, cli), /version/u);
  assert.equal(created, 1);
});
