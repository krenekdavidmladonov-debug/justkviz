import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, lstatSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { createRequire } from 'node:module';
import { assertLocalRequest, assertPlan, assertExport, records, ports, sanitizedEnvironment, portsFree, assertEmulatorRegistry, safeFailureDiagnostic, safeChildDiagnostics, run, prepareIsolatedFunctionsRuntime } from './restart-acceptance.mjs';

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

test('failure diagnostics allowlist codes and signatures without error text, paths or extra data', () => {
  const privateText = 'synthetic-private@example.test #registration=synthetic-capability';
  const cause = Object.assign(new Error('Cannot find module ' + privateText), { code: 'MODULE_NOT_FOUND' });
  cause.cause = cause; // A malformed cause chain must stay bounded.
  const error = Object.assign(new Error(privateText), { code: privateText, cause, childDiagnostics: [
    { stage: 'fresh:login', code: 'functions/unavailable', signature: 'UNCLASSIFIED', token: privateText, logFile: privateText },
  ], safeDiagnostic: { signature: 'UNCLASSIFIED', payload: privateText }, childExitCode: -7 });
  const diagnostic = safeFailureDiagnostic(error, privateText, privateText);
  assert.equal(diagnostic.stage, 'arguments');
  assert.equal(diagnostic.code, 'UNCLASSIFIED');
  assert.equal(diagnostic.causeCode, 'MODULE_NOT_FOUND');
  assert.equal(diagnostic.causeSignature, 'MODULE_NOT_FOUND');
  assert.equal(diagnostic.children[0].stage, 'fresh:login');
  assert(!JSON.stringify(diagnostic).includes(privateText));
  assert(!JSON.stringify(diagnostic).includes('logFile'));
  assert(!Object.hasOwn(diagnostic, 'exitCode'));
  assert.equal(safeFailureDiagnostic({ childExitCode: 0xffffffff }).exitCode, 0xffffffff);
  assert(!Object.hasOwn(safeFailureDiagnostic({ childExitCode: 0x100000000 }), 'exitCode'));
});

test('child output relays only bounded validated diagnostics and known failure signatures', () => {
  const privateText = 'synthetic-token-must-stay-in-local-log';
  const marker = 'RESTART_ACCEPTANCE_DIAGNOSTIC ';
  const valid = { stage: 'fresh:export', code: 'OWN_CHILD_FAILED', signature: 'OWN_CHILD_FAILED', logFile: 'fresh-export.log', exitCode: 1,
    children: [{ signature: 'MODULE_NOT_FOUND', raw: privateText }], raw: privateText };
  const output = [privateText, marker + JSON.stringify({ ...valid, stage: privateText }), marker + JSON.stringify(valid), 'Error: Cannot find module ' + privateText].join('\n');
  const diagnostics = safeChildDiagnostics(output);
  assert(diagnostics.some(item => item.stage === 'fresh:export' && item.logFile === 'fresh-export.log' && item.children[0].signature === 'MODULE_NOT_FOUND'));
  assert(diagnostics.some(item => item.signature === 'MODULE_NOT_FOUND'));
  assert(!JSON.stringify(diagnostics).includes(privateText));
  assert(safeChildDiagnostics(output.repeat(100)).length <= 8);
  assert.deepEqual(safeChildDiagnostics(marker + '{malformed'), []);
});

test('actual failed child drains final diagnostic before close and retains raw output locally only', async () => {
  const log = path.join(directory, 'fresh-suite.log'), privateText = 'synthetic-private-child-output';
  const childCode = `console.error(${JSON.stringify(privateText)}); console.error('RESTART_ACCEPTANCE_DIAGNOSTIC ' + JSON.stringify({stage:'fresh:login',code:'functions/unavailable',signature:'UNCLASSIFIED',payload:${JSON.stringify(privateText)}})); process.exitCode = 7;`;
  await assert.rejects(run(process.execPath, ['-e', childCode], { log }), error => {
    assert.equal(error.safeDiagnostic.exitCode, 7);
    assert.equal(error.safeDiagnostic.logFile, 'fresh-suite.log');
    assert(error.safeDiagnostic.children.some(item => item.stage === 'fresh:login' && item.code === 'functions/unavailable'));
    assert(!JSON.stringify(error.safeDiagnostic).includes(privateText));
    return true;
  });
  assert(readFileSync(log, 'utf8').includes(privateText), 'Owned raw failure log remains available for local inspection');
});

test('actual missing child executable exposes a safe spawn cause instead of hiding ENOENT', async () => {
  await assert.rejects(run(path.join(directory, 'missing-executable'), [], { log: path.join(directory, 'seed-auth.log') }), error => {
    assert.equal(error.safeDiagnostic.code, 'OWN_CHILD_FAILED');
    assert.equal(error.safeDiagnostic.causeCode, 'ENOENT');
    assert.equal(error.safeDiagnostic.logFile, 'seed-auth.log');
    assert(!JSON.stringify(error.safeDiagnostic).includes(directory));
    return true;
  });
});

test('own source positions relay without exposing absolute stack paths or arbitrary frames', () => {
  const harness = new URL('./restart-acceptance.mjs', import.meta.url).href;
  const diagnostic = safeFailureDiagnostic({ stack: `Error: private\n    at worker (${harness}:321:17)\n    at /private/foreign.mjs:9:2` });
  assert.deepEqual(diagnostic.frame, { file: 'tools/event-night/restart-acceptance.mjs', line: 321, column: 17 });
  assert(!JSON.stringify(diagnostic).includes(harness));
  assert(!Object.hasOwn(safeFailureDiagnostic({ stack: 'at /private/foreign.mjs:9:2' }), 'frame'));
  const child = safeChildDiagnostics('RESTART_ACCEPTANCE_DIAGNOSTIC ' + JSON.stringify({ stage: 'fresh:plan', code: 'ERR_ASSERTION', signature: 'UNCLASSIFIED', frame: { file: 'tools/event-night/restart-acceptance.mjs', line: 321, column: 17, absolute: '/private' } }));
  assert.deepEqual(child[0].frame, diagnostic.frame);
  assert(!JSON.stringify(child).includes('/private'));
});

test('pinned CLI discovery loses parent isolation; owned launcher restores guard before SDK code', async () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'justkviz-sdk-discovery-'));
  const source = path.join(fixture, 'functions'), modules = path.join(source, 'node_modules');
  const sdk = path.join(modules, 'firebase-functions'), legacyBin = path.join(modules, '.bin');
  mkdirSync(path.join(source, 'lib'), { recursive: true }); mkdirSync(sdk, { recursive: true }); mkdirSync(legacyBin);
  writeFileSync(path.join(source, 'package.json'), JSON.stringify({ name: '@filmovy-kviz/functions', main: 'lib/index.js', dependencies: { 'firebase-functions': '6.6.0' } }));
  writeFileSync(path.join(source, 'lib/index.js'), 'module.exports = {};');
  writeFileSync(path.join(source, '.env'), 'SYNTHETIC_PRIVATE_VALUE=must-not-copy');
  writeFileSync(path.join(sdk, 'package.json'), JSON.stringify({ name: 'firebase-functions', version: '6.6.0', main: 'index.cjs', exports: { '.': './index.cjs' }, bin: { 'firebase-functions': 'bin.cjs' } }));
  writeFileSync(path.join(sdk, 'index.cjs'), 'module.exports = {};');
  writeFileSync(path.join(sdk, 'bin.cjs'), `const fs=require('node:fs');
(async()=>{
 const guarded=process.env.EVENT_NIGHT_RESTART_NETWORK_GUARD==='1'; let blocked=false;
 if(guarded){try{await fetch('https://example.invalid/never-requested');}catch(error){blocked=error.message==='NON_LOOPBACK_NETWORK_BLOCKED';}}
 fs.writeFileSync(process.env.FUNCTIONS_MANIFEST_OUTPUT_PATH,JSON.stringify({guarded,blocked,nodeImportGuard:!!process.env.NODE_OPTIONS,isolatedConfig:process.env.CLOUDSDK_CONFIG===process.env.EXPECTED_SYNTHETIC_CONFIG,homeAbsent:!process.env.HOME,emailOff:process.env.REGISTRATION_EMAIL_MODE==='off'&&process.env.REGISTRATION_OWNER_NOTIFICATION_MODE==='off'}));
})();`);
  const shellQuote = value => `'${value.replaceAll("'", "'\\''")}'`;
  writeFileSync(path.join(legacyBin, 'firebase-functions'), `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(path.join(sdk, 'bin.cjs'))} "$@"\n`, { mode: 0o700 });
  writeFileSync(path.join(legacyBin, 'firebase-functions.cmd'), `@echo off\r\n"${process.execPath.replaceAll('%', '%%')}" "${path.join(sdk, 'bin.cjs').replaceAll('%', '%%')}" %*\r\n`);
  const owned = path.join(fixture, 'owned'); mkdirSync(owned); mkdirSync(path.join(owned, 'temp'));
  const isolated = sanitizedEnvironment(owned, plan.projectId);
  const { Delegate } = createRequire(import.meta.url)('firebase-tools/lib/deploy/functions/runtimes/node/index.js');
  async function discovery(functionsDir, label) {
    const output = path.join(owned, label + '.json');
    const delegate = new Delegate(plan.projectId, fixture, functionsDir, 'nodejs22');
    // The real CLI passes emulator envs, not the parent NODE_OPTIONS/ADC homes.
    const child = delegate.execAdmin({}, { GCLOUD_PROJECT: plan.projectId, EXPECTED_SYNTHETIC_CONFIG: isolated.CLOUDSDK_CONFIG }, output);
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    assert.equal(code, 0);
    return JSON.parse(readFileSync(output, 'utf8'));
  }
  const legacy = await discovery(source, 'legacy');
  assert.equal(legacy.guarded, false, 'Actual pinned CLI drops the parent network guard before SDK discovery');
  assert.equal(legacy.nodeImportGuard, false);
  assert.equal(legacy.isolatedConfig, false);
  const runtime = prepareIsolatedFunctionsRuntime(fixture, owned, isolated);
  assert(!lstatSync(path.join(runtime, 'node_modules')).isSymbolicLink(), 'Owned shims must never modify installed dependencies through a junction');
  assert(!existsSync(path.join(runtime, '.env')));
  const restored = await discovery(runtime, 'guarded');
  assert.deepEqual(restored, { guarded: true, blocked: true, nodeImportGuard: true, isolatedConfig: true, homeAbsent: true, emailOff: true });
  assert.throws(() => prepareIsolatedFunctionsRuntime(fixture, owned, isolated), /EEXIST/u, 'Runtime preparation is create-only');
  assert.throws(() => prepareIsolatedFunctionsRuntime(fixture, owned, { ...isolated, GCLOUD_PROJECT: 'live-project' }), /DEMO_PROJECT_REQUIRED/u);
  assert.throws(() => prepareIsolatedFunctionsRuntime(fixture, owned, { ...isolated, FIRESTORE_EMULATOR_HOST: 'cloud.example.test:8080' }), /LOOPBACK_EMULATOR_REQUIRED/u);
});

test('missing-module diagnostics expose only known public package aliases, never paths', () => {
  const privatePath = 'C:\\private\\synthetic@example.test\\node_modules\\firebase-functions\\lib\\bin\\firebase-functions.js';
  const diagnostic = safeFailureDiagnostic(new Error(`Cannot find module '${privatePath}'`));
  assert.equal(diagnostic.moduleAlias, 'firebase-functions');
  assert(!JSON.stringify(diagnostic).includes('private'));
  assert(!JSON.stringify(diagnostic).includes('@example.test'));
  const child = safeChildDiagnostics(`Error: Cannot find module '${privatePath}'`);
  assert(child.some(item => item.moduleAlias === 'firebase-functions'));
  assert(!JSON.stringify(child).includes('private'));
  assert(!Object.hasOwn(safeFailureDiagnostic(new Error("Cannot find module 'synthetic-private-module'")), 'moduleAlias'));
});

test('inherited registration delivery activation is removed and both synthetic delivery modes are off', () => {
  const env = sanitizedEnvironment(directory, plan.projectId, { REGISTRATION_EMAIL_MODE: 'cloud', REGISTRATION_OWNER_NOTIFICATION_MODE: 'cloud', REGISTRATION_EMAIL_KEY: 'synthetic-private-key' });
  assert.equal(env.REGISTRATION_EMAIL_MODE, 'off');
  assert.equal(env.REGISTRATION_OWNER_NOTIFICATION_MODE, 'off');
  assert(!env.REGISTRATION_EMAIL_KEY);
});
