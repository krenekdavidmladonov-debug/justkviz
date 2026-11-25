import assert from 'node:assert/strict';
import { test } from 'node:test';
import { functionIdentity, updatedFunctionIdentity, inventoryIdentity, readFunctionOrigin, recordFunctionOrigin } from './function-origin.mjs';

const head = 'b'.repeat(40);
const fn = {
  name: 'projects/example/locations/europe-west1/functions/one', state: 'ACTIVE', environment: 'GEN_2', updateTime: '2026-11-25T10:00:00Z',
  serviceConfig: { revision: 'one-00001' },
  buildConfig: { entryPoint: 'one', runtime: 'nodejs22', source: { storageSource: { bucket: 'sources', object: 'one.zip', generation: '2345' } } },
};
const targets = [{ entryPoint: 'one', identity: functionIdentity(fn) }, { entryPoint: 'two', identity: 'second-stamp' }];

function github() {
  let record, status;
  return (endpoint, body) => {
    if (endpoint === 'deployments') {
      assert.equal(body.auto_merge, false);
      assert.deepEqual(body.required_contexts, []);
      record = { ...body, sha: body.ref, id: 42 };
      return record;
    }
    if (endpoint === 'deployments/42/statuses') {
      status = body;
      assert.equal(status.auto_inactive, false);
      return status;
    }
    if (endpoint === 'deployments/42/statuses?per_page=1') return [status];
    assert.equal(endpoint, 'deployments?environment=justkviz-d1-functions-europe-west1&task=justkviz_d1_functions&per_page=1');
    return record ? [record] : [];
  };
}

test('the whole inventory must match the latest successful Functions release', () => {
  const api = github();
  assert.ok(readFunctionOrigin(api, targets).reason);
  recordFunctionOrigin(api, head, targets, ['one']);
  assert.deepEqual(readFunctionOrigin(api, [...targets].reverse()), { commit: head });
  for (const changed of [targets.slice(1), [...targets, { entryPoint: 'three', identity: 'stamp' }],
    [{ ...targets[0], identity: 'manual-change' }, targets[1]]]) assert.ok(readFunctionOrigin(api, changed).reason);
  api('deployments/42/statuses', { state: 'failure', auto_inactive: false });
  assert.ok(readFunctionOrigin(api, targets).reason);
});

test('receipt creation, status or lookup failures cannot certify the backend', () => {
  const api = github();
  const fail = () => { throw new Error('access denied'); };
  assert.throws(() => recordFunctionOrigin((endpoint, body) => endpoint.endsWith('/statuses') ? fail() : api(endpoint, body), head, targets, ['one']));
  assert.ok(readFunctionOrigin(api, targets).reason);
  assert.ok(readFunctionOrigin(fail, targets).reason);
  assert.throws(() => recordFunctionOrigin(fail, 'main', targets, []), /identita/u);
  assert.equal(inventoryIdentity([{ entryPoint: 'one' }]), undefined);
});

test('the fingerprint binds active source generation and service revision independently of the CLI label', () => {
  const baseline = functionIdentity(fn);
  assert.match(baseline, /^[a-f0-9]{64}$/u);
  assert.equal(functionIdentity({ ...fn, labels: { 'firebase-functions-hash': 'old' } }), baseline);
  assert.notEqual(functionIdentity({ ...fn, serviceConfig: { revision: 'one-00002' } }), baseline);
  assert.notEqual(functionIdentity({ ...fn, buildConfig: { ...fn.buildConfig, sourceProvenance: {
    resolvedStorageSource: { ...fn.buildConfig.source.storageSource, generation: '2346' },
  } } }), baseline);
  for (const invalid of [{ ...fn, state: 'DEPLOYING' }, { ...fn, serviceConfig: {} },
    { ...fn, buildConfig: { ...fn.buildConfig, source: {} } }, { ...fn, serviceConfig: { ...fn.serviceConfig, allTrafficOnLatestRevision: false } }]) {
    assert.equal(functionIdentity(invalid), undefined);
  }
});

test('a new update timestamp alone cannot attest a new backend commit', () => {
  const after = { ...fn, updateTime: '2026-11-25T11:00:00Z', serviceConfig: { revision: 'one-00002' } };
  assert.throws(() => updatedFunctionIdentity(fn, after), /změnu zdroje/u);
  const built = { ...after, buildConfig: { ...after.buildConfig, source: { storageSource: { bucket: 'sources', object: 'one.zip', generation: '2346' } } } };
  assert.equal(updatedFunctionIdentity(fn, built), functionIdentity(built));
  assert.throws(() => updatedFunctionIdentity(fn, { ...built, serviceConfig: fn.serviceConfig }), /novou revizi/u);
  assert.equal(updatedFunctionIdentity({ ...fn, buildConfig: {} }, built), undefined);
});
