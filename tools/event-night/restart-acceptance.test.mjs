import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { assertLocalRequest, assertPlan, assertExport, records, ports, sanitizedEnvironment, portsFree, assertEmulatorRegistry } from './restart-acceptance.mjs';

const directory = mkdtempSync(path.join(tmpdir(), 'synthetic-restart-guards-'));
const plan = { directory, projectId: 'demo-restart-012345abcdef', ports };
const env = { GCLOUD_PROJECT: plan.projectId, GOOGLE_CLOUD_PROJECT: plan.projectId, FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9399', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8380', FUNCTIONS_EMULATOR_HOST: '127.0.0.1:5301', FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9398' };
test('recovery cannot clean another emulator temporary storage', () => {
  const isolated = sanitizedEnvironment(directory, plan.projectId, { TEMP: 'shared', TMP: 'shared', TMPDIR: 'shared' });
  for (const key of ['TEMP', 'TMP', 'TMPDIR']) assert.equal(isolated[key], path.join(directory, 'temp'));
  const other = sanitizedEnvironment(path.join(directory, 'other'), plan.projectId, isolated);
  assert.notEqual(other.TEMP, isolated.TEMP);
});
test('only explicit loopback network permitted', () => {
  for (const url of ['http://127.0.0.1:9399/test', 'http://localhost:5301/test', 'http://[::1]:8380/test']) assertLocalRequest(url);
  for (const url of ['https://storage.googleapis.com/b', 'https://localhost.example.test', 'file:///tmp/synthetic', 'http://169.254.169.254/metadata', 'http://localhost@evil.example.test/']) assert.throws(() => assertLocalRequest(url));
});
test('exact isolated plan and ports accepted', () => assertPlan(plan, directory, env));
test('cloud project rejected before SDK initialization', () => assert.throws(() => assertPlan({ ...plan, projectId: 'filmovy-kviz-v2-staging' }, directory, env)));
test('project/environment mismatch rejected', () => assert.throws(() => assertPlan(plan, directory, { ...env, GOOGLE_CLOUD_PROJECT: 'demo-foreign' })));
test('foreign or default local emulator endpoints rejected', () => {
  for (const key of ['FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST', 'FUNCTIONS_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST']) {
    assert.throws(() => assertPlan(plan, directory, { ...env, [key]: 'localhost:9099' }));
    assert.throws(() => assertPlan(plan, directory, { ...env, [key]: 'remote.example.test:9399' }));
  }
});
test('credential override rejected', () => {
  for (const key of ['GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_TOKEN', 'FIREBASE_CONFIG']) assert.throws(() => assertPlan(plan, directory, { ...env, [key]: 'synthetic-unapproved' }));
});
test('ADC and runtime config inheritance removed and overrides rejected', () => {
  const isolated = sanitizedEnvironment(directory, plan.projectId, { CLOUDSDK_CONFIG: 'synthetic-existing-ADC-directory', CLOUD_RUNTIME_CONFIG: 'synthetic-existing-runtime.json', HOME: 'synthetic-home', APPDATA: 'synthetic-appdata', GOOGLE_APPLICATION_CREDENTIALS: 'synthetic-key.json', FIREBASE_TOKEN: 'synthetic-token', NODE_OPTIONS: 'synthetic-hook' });
  assert.equal(isolated.CLOUDSDK_CONFIG, path.join(directory, 'cli-config'));
  assert.equal(isolated.APPDATA, path.join(directory, 'cli-config'));
  assert(!isolated.HOME && !isolated.CLOUD_RUNTIME_CONFIG && !isolated.GOOGLE_APPLICATION_CREDENTIALS && !isolated.FIREBASE_TOKEN);
  assertPlan(plan, directory, isolated);
  assert.throws(() => assertPlan(plan, directory, { ...env, CLOUDSDK_CONFIG: 'synthetic-foreign' }));
  assert.throws(() => assertPlan(plan, directory, { ...env, CLOUD_RUNTIME_CONFIG: 'synthetic-foreign' }));
});
test('pinned CLI demo configuration accepted, foreign fields refused', () => {
  const config = { projectId: plan.projectId, storageBucket: plan.projectId + '.appspot.com', databaseURL: `https://${plan.projectId}.firebaseio.com` };
  assertPlan(plan, directory, { ...env, FIREBASE_CONFIG: JSON.stringify(config) });
  for (const patch of [{ projectId: 'demo-foreign' }, { storageBucket: 'foreign.appspot.com' }, { databaseURL: 'https://foreign.firebaseio.com' }, { credential: 'synthetic' }]) assert.throws(() => assertPlan(plan, directory, { ...env, FIREBASE_CONFIG: JSON.stringify({ ...config, ...patch }) }));
});
test('plan cannot redirect allocated ports or directory', () => {
  assert.throws(() => assertPlan({ ...plan, ports: { ...ports, auth: 9099 } }, directory, env));
  assert.throws(() => assertPlan({ ...plan, directory: path.join(directory, 'other') }, directory, env));
});
function snapshot(label, metadata = { auth: { path: 'auth_export' }, firestore: { path: 'firestore_export' }, storage: { path: 'storage_export' } }) {
  const dir = path.join(directory, label); mkdirSync(dir);
  for (const name of ['auth_export', 'firestore_export', 'storage_export']) { mkdirSync(path.join(dir, name)); writeFileSync(path.join(dir, name, 'synthetic'), 'retained synthetic bytes'); }
  writeFileSync(path.join(dir, 'firebase-export-metadata.json'), JSON.stringify(metadata));
  return dir;
}
test('all three persistence exports required', () => {
  const valid = snapshot('complete'); assert.equal(assertExport(valid).length, 4);
  assert.throws(() => assertExport(snapshot('incomplete', { auth: { path: 'auth_export' }, firestore: { path: 'firestore_export' } })));
});
test('export metadata path escape rejected', () => assert.throws(() => assertExport(snapshot('escape', { auth: { path: '../complete/auth_export' }, firestore: { path: 'firestore_export' }, storage: { path: 'storage_export' } }))));
test('checkpoint hashes detect content mutation', () => {
  const dir = snapshot('mutated'), before = assertExport(dir); writeFileSync(path.join(dir, 'firestore_export/synthetic'), 'changed');
  assert.throws(() => assert.deepEqual(assertExport(dir), before));
});
test('junction or symbolic link snapshot cannot be imported as verified', () => {
  const dir = snapshot('linked'), target = path.join(directory, 'foreign'); mkdirSync(target); writeFileSync(path.join(target, 'content'), 'foreign');
  symlinkSync(target, path.join(dir, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => records(dir));
});

test('recovery owns auxiliary Firebase ports instead of implicit defaults', () => {
  for (const name of ['eventarc', 'tasks']) assert(Number.isInteger(ports[name]), 'Explicit auxiliary port: ' + name);
  const all = [...Object.values(ports), ports.firestore + 1];
  assert.equal(new Set(all).size, all.length);
});

test('busy owned auxiliary listener is rejected before any emulator start', async () => {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(ports.tasks, '127.0.0.1', resolve); });
  try { await assert.rejects(portsFree(), new RegExp('PORT_UNAVAILABLE:' + ports.tasks)); }
  finally { await new Promise(resolve => server.close(resolve)); }
  await portsFree();
});

test('actual registry must match every loopback endpoint and websocket without fallback', () => {
  const registry = Object.fromEntries(Object.entries(ports).map(([name, port]) => [name, { name, host: '127.0.0.1', port }]));
  Object.assign(registry.firestore, { webSocketHost: '127.0.0.1', webSocketPort: ports.firestore + 1, reservedPorts: [ports.firestore + 1] });
  assertEmulatorRegistry(registry);
  for (const mutate of [r => { r.tasks.port++; }, r => { r.eventarc.host='remote.example.test'; }, r => { delete r.functions; }, r => { r.firestore.webSocketPort++; }, r => { r.foreign={host:'127.0.0.1',port:9499}; }]) {
    const changed=structuredClone(registry); mutate(changed); assert.throws(() => assertEmulatorRegistry(changed));
  }
});

test('inherited auxiliary emulator overrides are removed before explicit child mapping', () => {
  const isolated = sanitizedEnvironment(directory, plan.projectId, { PUBSUB_EMULATOR_HOST: 'synthetic-foreign', CLOUD_TASKS_EMULATOR_HOST: 'synthetic-foreign', EVENTARC_EMULATOR: 'synthetic-foreign' });
  assert(!isolated.PUBSUB_EMULATOR_HOST && !isolated.CLOUD_TASKS_EMULATOR_HOST && !isolated.EVENTARC_EMULATOR);
});
