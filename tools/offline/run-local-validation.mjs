import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { sanitizedEnvironment } from '../event-night/restart-acceptance.mjs';

// Each child controller owns its processes, profiles and emulator lifecycle.
const root = realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
const project = 'demo-filmovy-kviz-v2';
const capacitySpec = { script: 'tools/offline/run-capacity.mjs', prefix: 'Capacity evidence: ', directory: 'capacity-',
  receipt: 'capacity-proof.json', pass: 'OFFLINE_CAPACITY_PASS' };
const childSpecs = {
  core: { script: 'tools/offline/run-acceptance.mjs', prefix: 'Offline acceptance evidence: ', directory: 'acceptance-',
    receipt: 'acceptance.json', pass: 'OFFLINE_V1_ACCEPTANCE_PASS' },
  durability: { script: 'tools/offline/run-durability.mjs', prefix: 'Durability evidence: ', directory: 'durability-',
    receipt: 'durability-proof.json', pass: 'OFFLINE_DURABILITY_PASS' },
  capacity: capacitySpec,
  overflow: capacitySpec,
};
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });

function prepareEvidenceRoot() {
  let parent = root;
  for (const name of ['.local-data', 'offline-v1']) {
    const directory = path.join(parent, name);
    try { mkdirSync(directory); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const metadata = lstatSync(directory);
    assert(metadata.isDirectory() && !metadata.isSymbolicLink(), 'Evidence root components must be real local directories.');
    assert.equal(realpathSync(directory), directory, 'Evidence root resolves outside the expected workspace path.');
    parent = directory;
  }
  return parent;
}

function ownEvidenceDirectory(value, prefix, evidenceRoot) {
  const lexical = path.resolve(root, value);
  assert.equal(path.dirname(lexical), evidenceRoot, 'Evidence must be a direct child of the local offline evidence root.');
  const folder = lstatSync(lexical);
  assert(folder.isDirectory() && !folder.isSymbolicLink(), 'Evidence directory must be a real local directory.');
  const actual = realpathSync(lexical);
  assert.equal(path.dirname(actual), evidenceRoot, 'Evidence must be a direct child of the local offline evidence root.');
  assert(path.basename(actual).startsWith(prefix) && /^[a-z]+-[A-Za-z0-9-]+$/u.test(path.basename(actual)), 'Unexpected evidence directory name.');
  return actual;
}

function readEvidenceFile(directory, filename) {
  const file = path.join(directory, filename);
  const stat = lstatSync(file);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 32 * 1024 * 1024, 'Evidence receipt must be a bounded local file.');
  return { file, bytes: readFileSync(file) };
}

function readReceipt(directory, filename) {
  const { file, bytes } = readEvidenceFile(directory, filename);
  const value = JSON.parse(bytes.toString('utf8'));
  assert.equal(value.status, 'PASS');
  return { directory, file, sha256: sha256(bytes), value };
}

function readCore(directory) {
  const core = readReceipt(directory, childSpecs.core.receipt);
  const { value } = core;
  assert.equal(value.project, project);
  assert.deepEqual(value.source, JSON.parse(readEvidenceFile(directory, 'source-binding.json').bytes.toString('utf8')));
  assert.equal(value.profilePaths.runDirectory, directory);
  for (const phase of ['prepare', 'offline', 'sync']) assert.equal(value.phases[phase].status, 'PASS');
  assert.equal(value.phases.offline.allFiveBackendsStopped, true);
  assert.equal(value.nativeApplicationCleanup.status, 'PASS');
  return core;
}

function pinReceipt(receipt) {
  return { directory: receipt.directory, file: receipt.file, sha256: receipt.sha256 };
}

async function runChild(phase, directory, env, record, evidenceRoot) {
  const spec = childSpecs[phase];
  const script = path.join(root, spec.script);
  const stdoutFile = path.join(directory, phase + '-stdout.log');
  const stderrFile = path.join(directory, phase + '-stderr.log');
  const child = spawn(process.execPath, [script], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const pointers = [];
  let passes = 0;
  createInterface({ input: child.stdout, crlfDelay: Infinity }).on('line', line => {
    if (line.startsWith(spec.prefix)) pointers.push(line.slice(spec.prefix.length));
    if (line === spec.pass) passes++;
  });
  const exit = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  const results = await Promise.allSettled([exit,
    pipeline(child.stdout, createWriteStream(stdoutFile, { flags: 'wx' })),
    pipeline(child.stderr, createWriteStream(stderrFile, { flags: 'wx' }))]);
  const status = results[0].status === 'fulfilled' ? results[0].value : { code: null, signal: null };
  record[phase] = { ...status, stdoutFile, stderrFile, announcedDirectories: pointers };
  for (const result of results) if (result.status === 'rejected') throw result.reason;
  assert(status.code === 0 && status.signal === null, phase + ' child failed. See the run-owned logs.');
  assert.equal(pointers.length, 1, phase + ' must announce exactly one evidence directory.');
  assert.equal(passes, 1, phase + ' must print exactly one success marker.');
  return ownEvidenceDirectory(pointers[0], spec.directory, evidenceRoot);
}

async function run() {
  assert.equal(realpathSync(process.cwd()), root, 'Run in the explicit product workspace.');
  assert.equal(process.versions.node.split('.')[0], '22', 'Use Node 22.');
  assert.equal(process.platform, 'win32', 'Full capacity memory validation requires Windows; use pnpm check:offline:core for the portable core.');
  const args = process.argv.slice(2);
  assert(args.length === 0 || args.length === 2 && args[0] === '--core-run' && path.isAbsolute(args[1]),
    'Usage: node tools/offline/run-local-validation.mjs [--core-run ABSOLUTE_DIRECTORY]');
  const evidenceRoot = prepareEvidenceRoot();
  const chosen = args.length ? ownEvidenceDirectory(args[1], childSpecs.core.directory, evidenceRoot) : null;
  const directory = path.join(evidenceRoot, 'validation-' + new Date().toISOString().replaceAll(/[:.]/gu, '-') + '-' + randomUUID().slice(0, 8));
  mkdirSync(directory);
  for (const name of ['temp', 'cli-config']) mkdirSync(path.join(directory, name));
  const env = sanitizedEnvironment(directory, project);
  delete env.OFFLINE_DURABILITY_CORE_RUN_DIR;
  delete env.OFFLINE_CAPACITY_CORE_RUN_DIR;
  // The negative bound is a separate run after the full positive proof.
  env.OFFLINE_CAPACITY_OVERFLOW = '0';
  const children = {};
  const pinned = {};
  console.log('Local validation evidence: ' + path.relative(root, directory));
  try {
    const core = readCore(chosen ?? await runChild('core', directory, env, children, evidenceRoot));
    pinned.core = pinReceipt(core);
    save(path.join(directory, 'core-pointer.json'), { mode: chosen ? 'explicit-receipt' : 'spawned-core', ...pinned.core });

    const durabilityDirectory = await runChild('durability', directory, { ...env, OFFLINE_DURABILITY_CORE_RUN_DIR: core.directory }, children, evidenceRoot);
    const durability = readReceipt(durabilityDirectory, childSpecs.durability.receipt);
    assert.equal(durability.value.source.coreEvidenceSha256, core.sha256);
    assert.equal(durability.value.source.acceptedCoreCommit, core.value.source.commit);
    assert.equal(durability.value.source.acceptedCoreTree, core.value.source.tree);
    for (const name of ['quota', 'abort', 'corruption', 'expiry', 'missing-media']) assert.equal(durability.value.scenarios[name].status, 'PASS');
    pinned.durability = pinReceipt(durability);
    assert.equal(readCore(core.directory).sha256, core.sha256);

    const capacityDirectory = await runChild('capacity', directory, { ...env, OFFLINE_CAPACITY_CORE_RUN_DIR: core.directory }, children, evidenceRoot);
    const capacity = readReceipt(capacityDirectory, childSpecs.capacity.receipt);
    assert.equal(capacity.value.source.acceptedCoreSha256, core.sha256);
    assert.equal(capacity.value.source.acceptedCoreCommit, core.value.source.commit);
    assert.equal(capacity.value.source.acceptedCoreTree, core.value.source.tree);
    assert.equal(capacity.value.prepare.actualPayloadBytes, 512 * 1024 * 1024);
    assert.equal(capacity.value.offline.exactAssetCount, 256);
    assert.equal(capacity.value.offline.allFiveBackendsStopped, true);
    assert.equal(capacity.value.cleanup.status, 'PASS');
    pinned.capacity = pinReceipt(capacity);

    const overflowDirectory = await runChild('overflow', directory, {
      ...env, OFFLINE_CAPACITY_CORE_RUN_DIR: core.directory, OFFLINE_CAPACITY_OVERFLOW: '1',
    }, children, evidenceRoot);
    const overflow = readReceipt(overflowDirectory, childSpecs.overflow.receipt);
    assert.notEqual(overflowDirectory, capacityDirectory);
    assert.equal(overflow.value.source.acceptedCoreSha256, core.sha256);
    assert.equal(overflow.value.source.artifactAndHarnessSha256, capacity.value.source.artifactAndHarnessSha256);
    assert.equal(overflow.value.prepare.actualPayloadBytes, 512 * 1024 * 1024 + 1);
    assert.equal(overflow.value.prepare.actualOwnFiles, 256);
    assert.equal(overflow.value.prepare.allAssetsAtMost25MiB, true);
    assert.equal(overflow.value.prepare.noReady, true);
    assert.equal(overflow.value.prepare.noPrivateSession, true);
    assert.equal(overflow.value.offline, undefined);
    assert.equal(overflow.value.cleanup.status, 'PASS');
    assert.equal(existsSync(path.join(overflowDirectory, 'capacity.justkvizoffline')), false);
    pinned.overflow = pinReceipt(overflow);

    for (const [phase, receipt] of Object.entries(pinned)) {
      assert.equal(readReceipt(receipt.directory, childSpecs[phase].receipt).sha256, receipt.sha256, phase + ' receipt changed.');
    }
    save(path.join(directory, 'local-validation-proof.json'), { status: 'PASS', project, mode: chosen ? 'explicit-core-then-supplements' : 'serial-core-durability-capacity-overflow',
      node: process.versions.node, coreSource: { commit: core.value.source.commit, tree: core.value.source.tree },
      receipts: pinned, children, orchestratorSha256: sha256(readFileSync(fileURLToPath(import.meta.url))) });
    console.log('OFFLINE_LOCAL_VALIDATION_PASS');
  } catch (error) {
    save(path.join(directory, 'failure.json'), { status: 'FAIL', project, message: error.message, receipts: pinned, children });
    throw error;
  }
}

await run();
