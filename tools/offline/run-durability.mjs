import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { records, sanitizedEnvironment } from '../event-night/restart-acceptance.mjs';
import { offlineValidationTools, validationHarnessIdentity } from './validation-toolchain.mjs';
import { inspectOfflineArchive } from '../../tests/browser/offline-archive-fixture.mjs';

// Use the completed core proof and closed, independently copied browser profiles.
const root = fs.realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
assert.equal(fs.realpathSync(process.cwd()), root, 'Use the explicit product workspace cwd.');
assert.equal(process.argv.length, 2, 'This runner accepts no mutation/build/deployment flags.');
assert(process.env.OFFLINE_DURABILITY_CORE_RUN_DIR, 'Set the exact completed core evidence directory.');
const core = fs.realpathSync(process.env.OFFLINE_DURABILITY_CORE_RUN_DIR);
assert.equal(path.dirname(core), path.join(root, '.local-data/offline-v1'));
assert(/^acceptance-[A-Za-z0-9-]+$/u.test(path.basename(core)));
const read = filename => JSON.parse(fs.readFileSync(filename, 'utf8'));
const save = (filename, value) => fs.writeFileSync(filename, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
const hash = value => createHash('sha256').update(value).digest('hex');
const acceptance = read(path.join(core, 'acceptance.json'));
assert.equal(acceptance.status, 'PASS', 'The core run must finish before any profile copy.');
assert.equal(acceptance.project, 'demo-filmovy-kviz-v2');
assert.equal(acceptance.phases.offline.allFiveBackendsStopped, true);
assert.equal(acceptance.nativeApplicationCleanup.status, 'PASS');
assert.deepEqual(acceptance.source, read(path.join(core, 'source-binding.json')));
const validatedTools = offlineValidationTools(root, acceptance.phases.prepare.browserVersion);
const toolchain = validatedTools.proof;
const profilePaths = read(path.join(core, 'profile-paths.json'));
assert.equal(profilePaths.runDirectory, core);
assert.equal(profilePaths.profiles.fork, 'fork');
const coreProfiles = fs.realpathSync(profilePaths.root);
assert(/^op-[a-f0-9]{8}$/u.test(path.relative(path.join(root, '.local-data'), coreProfiles)));
const sourceProfile = fs.realpathSync(path.join(coreProfiles, 'fork'));
assert.equal(path.dirname(sourceProfile), coreProfiles);
assert(!fs.readdirSync(sourceProfile).some(name => name.startsWith('Singleton')), 'A source profile has a browser singleton; do not copy an open profile.');
const notebookRecord = read(path.join(core, 'native-app-t.json'));
assert.equal(notebookRecord.profile, path.join(coreProfiles, 't'));
assert(notebookRecord.previouslyUnknown && notebookRecord.installed && notebookRecord.uninstalled);
assert(/^[a-f0-9]{64}$/u.test(notebookRecord.sentinelSha256));
assert.equal(notebookRecord.sentinelSha256, acceptance.phases.offline.notebookColdStorage.sentinelSha256);
const bundlePath = fs.realpathSync(path.join(core, 'prepared.justkvizoffline'));
assert.equal(path.dirname(bundlePath), core);
assert(fs.statSync(bundlePath).size <= 64 * 1024 * 1024, 'Use the small accepted core package, not the capacity archive.');
const prepare = read(path.join(core, 'prepare-proof.json'));
assert.equal(fs.statSync(bundlePath).size, prepare.packageBytes);
assert.equal(hash(fs.readFileSync(bundlePath)), prepare.packageSha256);

function sourceProof() {
  const inventory = [];
  for (const name of ['apps/web/dist', 'packages/quiz-domain/lib']) {
    const actual = records(path.join(root, name));
    const expected = acceptance.source.inventory.filter(item => item.root === name).map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }));
    assert.deepEqual(actual, expected, 'The artifact differs from the accepted core source: ' + name);
    inventory.push(...actual.map(item => ({ root: name, ...item })));
  }
  const helpers = ['tools/offline/run-durability.mjs', 'tools/offline/validation-toolchain.mjs',
    'tests/browser/offline-durability.config.mjs', 'tests/browser/offline-durability.spec.mjs', 'tests/browser/offline-archive-fixture.mjs',
    'tests/browser/offline-native-app-fixture.mjs', 'tools/event-night/restart-acceptance.mjs', 'pnpm-lock.yaml'];
  for (const filename of helpers) inventory.push({ path: filename, sha256: hash(fs.readFileSync(path.join(root, filename))) });
  const harness = validationHarnessIdentity(root, acceptance.source);
  return { ...harness, acceptedCoreCommit: acceptance.source.commit, acceptedCoreTree: acceptance.source.tree,
    coreEvidenceSha256: hash(fs.readFileSync(path.join(core, 'acceptance.json'))),
    coreNotebookInstallRecordSha256: hash(fs.readFileSync(path.join(core, 'native-app-t.json'))),
    copiedSourceProfileSha256: hash(JSON.stringify(records(sourceProfile))),
    bundleSha256: hash(fs.readFileSync(bundlePath)), inventory, artifactAndHarnessSha256: hash(JSON.stringify(inventory)) };
}

async function stoppedBackends() {
  for (const port of [5000, 5001, 8080, 9099, 9199]) await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); reject(new Error('DURABILITY_BACKEND_STILL_RUNNING:' + port)); });
    socket.once('error', error => error.code === 'ECONNREFUSED' ? resolve() : reject(error));
    socket.setTimeout(1000, () => { socket.destroy(); reject(new Error('DURABILITY_BACKEND_STOP_UNPROVEN:' + port)); });
  });
}

await stoppedBackends();
const inspected = await inspectOfflineArchive(bundlePath, 'synthetic-complete-offline-password');
assert(inspected.metadata.manifest.expiresAtMs > Date.now(), 'The core grant expired; run a fresh authorized core fixture, never backdate the clock.');
const directory = path.join(root, '.local-data/offline-v1', 'durability-' + new Date().toISOString().replaceAll(/[:.]/gu, '-') + '-' + randomUUID().slice(0, 8));
fs.mkdirSync(directory);
for (const name of ['temp', 'cli-config']) fs.mkdirSync(path.join(directory, name));
const profileRoot = path.join(root, '.local-data', 'dp-' + randomUUID().slice(0, 8));
fs.mkdirSync(profileRoot);
save(path.join(directory, 'profile-paths.json'), { runDirectory: directory, root: fs.realpathSync(profileRoot),
  source: sourceProfile, sourceAcceptedCore: core, sourceProfileMustBeClosed: true });
const binding = sourceProof();
save(path.join(directory, 'source-binding.json'), binding);
for (const name of ['q', 'a', 'c', 'e', 'm']) {
  const destination = path.join(profileRoot, name);
  assert(destination.startsWith(profileRoot + path.sep));
  fs.cpSync(sourceProfile, destination, { recursive: true, force: false, errorOnExist: true,
    filter(filename) { assert(!fs.lstatSync(filename).isSymbolicLink(), 'Source profile links are not copied.'); return true; } });
}
save(path.join(directory, 'input.json'), { bundlePath, bundleSha256: binding.bundleSha256,
  sessionId: inspected.metadata.manifest.sessionId, firstRoundId: inspected.metadata.manifest.rounds[0].id,
  expiresAtMs: inspected.metadata.manifest.expiresAtMs, notebookSentinelSha256: notebookRecord.sentinelSha256 });
const env = sanitizedEnvironment(directory, 'demo-filmovy-kviz-v2');
Object.assign(env, { OFFLINE_DURABILITY_RUN_DIR: directory, OFFLINE_DURABILITY_PROFILE_ROOT: fs.realpathSync(profileRoot),
  OFFLINE_DURABILITY_BROWSER_VERSION: toolchain.acceptedChromium, PLAYWRIGHT_EXECUTABLE_PATH: validatedTools.chrome,
  NODE_OPTIONS: '--import=' + pathToFileURL(path.join(root, 'tools/event-night/restart-acceptance.mjs')).href });
console.log('Durability evidence: ' + path.relative(root, directory));
try {
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(path.join(directory, 'browser.log'), { flags: 'wx' });
    const child = spawn(process.execPath, [path.join(root, 'node_modules/@playwright/test/cli.js'), 'test',
      '--config', path.join(root, 'tests/browser/offline-durability.config.mjs'), '--workers=1', '--retries=0', '--output', path.join(directory, 'browser-results')],
    { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(output, { end: false }); child.stderr.pipe(output, { end: false });
    child.once('error', error => { output.end(); reject(error); });
    child.once('close', code => output.end(() => code === 0 ? resolve() : reject(new Error('DURABILITY_BROWSER_FAILED'))));
  });
  await stoppedBackends();
  assert.deepEqual(sourceProof(), binding, 'The accepted source profile, package or product artifact changed.');
  const scenarios = Object.fromEntries(['quota', 'abort', 'corruption', 'expiry', 'missing-media'].map(name => [name, read(path.join(directory, name + '-proof.json'))]));
  assert(Object.values(scenarios).every(value => value.status === 'PASS'));
  save(path.join(directory, 'durability-proof.json'), { status: 'PASS', source: binding, toolchain, scenarios,
    limitations: ['The product capacity guard was exercised with an explicitly injected StorageManager estimate; native quota exhaustion and a full physical disk were not reproduced.',
      'Native transaction.abort and committed ciphertext bit flip are explicit faults, not physical power-loss or OS failure.',
      'Only closed synthetic core-profile copies were mutated; the accepted core source profile and artifact were unchanged.'] });
  console.log('OFFLINE_DURABILITY_PASS');
} catch (error) {
  save(path.join(directory, 'failure.json'), { status: 'FAIL', message: error.message, source: binding });
  throw error;
}
