import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { linuxProof, publishD2, LOCK, REGION_PATH } from './lock-release.mjs';
import { createPrivateReset, deployFunctionPlan, functionTargets, menuAction } from './nasadit.mjs';

const head = 'a'.repeat(40), bytes = Buffer.from('verified ZIP');
const record = { sha: head, size: bytes.length, digest: createHash('sha256').update(bytes).digest('hex') };
const job = { id: 71, name: 'D2 Linux packages', head_sha: head, status: 'completed', conclusion: 'success' };
const line = '2026-11-25T10:00:00.0000000Z D2_VERIFIED lockEventQuiz ' + head + ' ' + record.digest + ' ' + record.size;

test('release needs unique successful Linux job, selected SHA and unambiguous bounded evidence', () => {
  assert.deepEqual(linuxProof(head, [job], id => { assert.equal(id, 71); return line; }), record);
  for (const jobs of [[], [job, job], [{ ...job, head_sha: 'other' }], [{ ...job, conclusion: 'failure' }]])
    assert.throws(() => linuxProof(head, jobs, () => line));
  for (const log of ['', line + '\n' + line, line.replace(head, 'b'.repeat(40)), line.replace(/\d+$/u, '104857600')])
    assert.throws(() => linuxProof(head, [job], () => log));
});

test('only menu option 4 selects lockEventQuiz and it refuses Hosting parameters', () => {
  assert.equal(menuAction('4'), 'd2');
  for (const selection of ['1', '2', '3']) assert.equal(menuAction(selection), 'hosting');
  for (const mode of ['--previous', '--rollback']) assert.throws(() => menuAction('4', { mode }));
  assert.throws(() => menuAction(undefined));
  assert.throws(() => menuAction('lockEventQuiz'));
});

test('D1 stops before planning an ordinary deployment of a missing or changed D2 lock', async () => {
  for (const functions of [[], [{ name: LOCK, buildConfig: { environmentVariables: { GOOGLE_NODE_RUN_SCRIPTS: '' } } }]]) {
    await assert.rejects(functionTargets({ get: () => ({ body: { functions } }) }, ['lockEventQuiz']), /D2/u);
  }
});

const source = { bucket: 'bucket', object: 'build.zip', generation: '11' };
const original = { name: LOCK, state: 'ACTIVE', environment: 'GEN_2', updateTime: '2026-11-25T10:00:00Z',
  serviceConfig: { service: REGION_PATH + '/services/lockeventquiz', revision: 'lockeventquiz-001-test' },
  buildConfig: { runtime: 'nodejs22', entryPoint: 'lockEventQuiz', environmentVariables: { GOOGLE_NODE_RUN_SCRIPTS: 'gcp-build' },
    source: { storageSource: { ...source, generation: '10' } } } };
function scenario() {
  const before = structuredClone(original);
  const after = structuredClone(original);
  after.updateTime = '2026-11-25T10:01:00Z'; after.serviceConfig.revision = 'lockeventquiz-002-test';
  after.buildConfig.source.storageSource = source;
  const calls = [];
  const options = { name: 'lockEventQuiz', savePrevious() {}, head, bytes, log() {}, verifyCI: () => record, confirm: phrase => phrase,
    client: {
      get(name) { assert.equal(name, LOCK); return { body: calls.includes('patch') ? after : before }; },
      patch(name, body, query) {
        assert.equal(name, LOCK); assert.deepEqual(query, { queryParams: { updateMask: 'buildConfig.source.storageSource' } });
        assert.deepEqual(body, { name: LOCK, buildConfig: { source: { storageSource: source } } });
        calls.push('patch'); return { body: { name: 'op' } };
      },
    },
    upload(api, archive) { assert.equal(api, options.client); assert.equal(archive, bytes); calls.push('upload'); return source; },
    wait(op) { assert.deepEqual(op, { name: 'op' }); calls.push('wait'); return after; },
  };
  return { options, before, after, calls };
}
test('D2 updates exactly one existing resource, then verifies its actual revision', async () => {
  const { options, calls } = scenario();
  await publishD2(options);
  assert.deepEqual(calls, ['upload', 'patch', 'wait']);
});
test('no upload or PATCH on wrong confirmation, different ZIP, wrong service or build configuration', async () => {
  const variants = [
    s => { s.options.confirm = () => 'ANO'; }, s => { s.options.bytes = Buffer.from('another ZIP'); },
    s => { s.before.name = s.before.name.replace('lockEventQuiz', 'readQuizMedia'); },
    s => { s.before.serviceConfig.service += '2'; }, s => { s.before.buildConfig.runtime = 'nodejs20'; },
    s => { s.before.buildConfig.environmentVariables.GOOGLE_NODE_RUN_SCRIPTS = ''; },
    s => { s.before.buildConfig.source.storageSource.generation = ''; },
    s => { s.options.confirm = phrase => { s.before.updateTime = '2026-11-25T10:01:01Z'; return phrase; }; },
  ];
  for (const change of variants) {
    const s = scenario(); change(s); await assert.rejects(publishD2(s.options)); assert.deepEqual(s.calls, []);
  }
});
test('drift during upload prevents patch, unverifiable completion fails', async () => {
  const s = scenario();
  s.options.upload = () => { s.before.serviceConfig.revision += 'x'; return source; };
  await assert.rejects(publishD2(s.options)); assert.deepEqual(s.calls, []);
  const t = scenario(); t.options.wait = () => t.before;
  await assert.rejects(publishD2(t.options)); assert.deepEqual(t.calls, ['upload', 'patch']);
});
test('D1 updates the protected writers before creating the new reset without IAM', async () => {
  const existing = ['saveEventScore','saveRefereeScore','commitOfflineSync','authorizeOfflineEvent','prepareOfflineEvent','previewOfflineSync'].map(entryPoint => ({ entryPoint }));
  const plan = { existing, missing: ['resetEventScores'] };
  const calls = [];
  const actions = { update: () => calls.push('guards'), createReset: () => calls.push('create'), verifyCreated: () => calls.push('verify') };
  await deployFunctionPlan(plan, { zip: 'bundle' }, actions);
  assert.deepEqual(calls, ['guards','create','verify']);
  for (const bad of [{ ...plan, missing: [...plan.missing, 'unexpected'] }, { ...plan, existing: existing.slice(1) }]) {
    calls.length = 0; await assert.rejects(deployFunctionPlan(bad, {}, actions)); assert.deepEqual(calls, []);
  }
  calls.length = 0; await assert.rejects(deployFunctionPlan(plan, {}, { ...actions, update() { throw Error('partial'); } }));
  assert.deepEqual(calls, []);
});
test('new reset uses a single Function CREATE with the scoring identity and no IAM call', async () => {
  const name = REGION_PATH + '/functions/resetEventScores', serviceAccountEmail = 'scoring@example.iam.gserviceaccount.com';
  const calls = [];
  await createPrivateReset({
    get(resource) { assert.equal(resource, REGION_PATH + '/functions/saveEventScore');
      return { body: { name: resource, state: 'ACTIVE', serviceConfig: { serviceAccountEmail } } }; },
    post(resource, body, options) {
      calls.push(resource); assert.equal(resource, REGION_PATH + '/functions');
      assert.deepEqual(options, { queryParams: { functionId: 'resetEventScores' } });
      assert.equal(body.name, name); assert.deepEqual(body.serviceConfig, { serviceAccountEmail, timeoutSeconds: 120 });
      assert.equal(body.buildConfig.entryPoint, 'resetEventScores'); assert.deepEqual(body.buildConfig.source, { storageSource: source });
      return { body: { name: 'op' } };
    },
  }, source, () => ({ name, state: 'ACTIVE', serviceConfig: { serviceAccountEmail } }));
  assert.equal(calls.length, 1);
});
