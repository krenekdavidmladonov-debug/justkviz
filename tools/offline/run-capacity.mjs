import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { records, sanitizedEnvironment, prepareIsolatedFunctionsRuntime } from '../event-night/restart-acceptance.mjs';
import { offlineValidationTools, validationHarnessIdentity } from './validation-toolchain.mjs';

// Run serially after the accepted core, with exclusive local emulator ports.
const self = fileURLToPath(import.meta.url);
const root = fs.realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
assert.equal(fs.realpathSync(process.cwd()), root, 'Run with the explicit product workspace as cwd.');
const node = process.execPath, project = 'demo-filmovy-kviz-v2';
const ports = { auth: 9099, firestore: 8080, functions: 5001, hosting: 5000, storage: 9199,
  hub: 4449, logging: 4559, eventarc: 9449, tasks: 9559 };
const config = path.join(root, 'tests/browser/offline-capacity.config.mjs');
const cli = path.join(root, 'node_modules/firebase-tools/lib/bin/firebase.js');
const playwright = path.join(root, 'node_modules/@playwright/test/cli.js');
const hash = value => createHash('sha256').update(value).digest('hex');
const read = filename => JSON.parse(fs.readFileSync(filename, 'utf8'));
const save = (filename, value) => fs.writeFileSync(filename, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
const ruleFiles = ['firestore.rules', 'firestore.indexes.json', 'storage.rules'];
const acceptedArtifacts = ['functions/lib', 'packages/quiz-domain/lib', 'apps/web/dist'];

assert(process.env.OFFLINE_CAPACITY_CORE_RUN_DIR, 'Set the exact completed core evidence directory.');
const core = fs.realpathSync(process.env.OFFLINE_CAPACITY_CORE_RUN_DIR);
assert.equal(path.dirname(core), path.join(root, '.local-data/offline-v1'));
assert(/^acceptance-[A-Za-z0-9-]+$/u.test(path.basename(core)));
const accepted = read(path.join(core, 'acceptance.json'));
assert.equal(accepted.status, 'PASS');
assert.equal(accepted.project, project);
assert.equal(accepted.phases.offline.allFiveBackendsStopped, true);
assert.equal(accepted.nativeApplicationCleanup.status, 'PASS');

assert.deepEqual(accepted.source, read(path.join(core, 'source-binding.json')));
const validatedTools = offlineValidationTools(root, accepted.phases.prepare.browserVersion, true);

function sourceProof() {
  const directories = [...acceptedArtifacts, 'apps/web/src/features/offline'];
  const inventory = directories.flatMap(directory => records(path.join(root, directory)).map(item => ({ ...item, root: directory })));
  for (const name of acceptedArtifacts) {
    assert.deepEqual(inventory.filter(item => item.root === name), accepted.source.inventory.filter(item => item.root === name),
      'Capacity needs the exact accepted core artifact: ' + name);
  }
  for (const name of ruleFiles) {
    const bytes = fs.readFileSync(path.join(root, name));
    assert(bytes.equals(fs.readFileSync(path.join(core, name))), 'Core rules differ: ' + name);
    inventory.push({ path: name, sha256: hash(bytes) });
  }
  const visited = new Set();
  const bindHelper = relative => {
    const filename = fs.realpathSync(path.resolve(root, relative));
    assert(filename.startsWith(root + path.sep), 'Imported helper escaped the owned workspace.');
    const key = path.relative(root, filename).replaceAll('\\', '/');
    if (visited.has(key)) return;
    visited.add(key);
    const bytes = fs.readFileSync(filename);
    inventory.push({ path: key, sha256: hash(bytes) });
    if (!/\.[cm]?js$/u.test(filename)) return;
    for (const match of bytes.toString('utf8').matchAll(/(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+)['"]/gu)) {
      bindHelper(path.relative(root, path.resolve(path.dirname(filename), match[1])));
    }
  };
  for (const helper of ['tools/offline/run-capacity.mjs', 'tools/offline/validation-toolchain.mjs',
    'tests/browser/offline-capacity.config.mjs', 'tests/browser/offline-capacity.spec.mjs', 'tests/browser/offline-media-fixture.mjs', 'tests/browser/offline-event-fixture.mjs',
    'tests/browser/offline-native-app-fixture.mjs',
    'tests/e2e/editor-identity.mjs', 'tests/e2e/media-fixture.mjs', 'tools/local-emulator-environment.mjs',
    'tools/event-night/restart-acceptance.mjs', 'package.json', 'pnpm-lock.yaml', 'functions/package.json']) bindHelper(helper);
  const harness = validationHarnessIdentity(root, accepted.source);
  return { ...harness, acceptedCoreCommit: accepted.source.commit, acceptedCoreTree: accepted.source.tree,
    acceptedCoreSha256: hash(fs.readFileSync(path.join(core, 'acceptance.json'))),
    artifactAndHarnessSha256: hash(JSON.stringify(inventory)), inventory };
}

function environment(directory) {
  const env = sanitizedEnvironment(directory, project);
  const profiles = read(path.join(directory, 'profile-paths.json'));
  assert.equal(profiles.runDirectory, directory);
  const profileRoot = fs.realpathSync(profiles.root);
  assert(/^cp-[a-f0-9]{8}$/u.test(path.relative(path.join(root, '.local-data'), profileRoot)));
  Object.assign(env, { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:' + ports.auth,
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:' + ports.firestore, FUNCTIONS_EMULATOR_HOST: '127.0.0.1:' + ports.functions,
    FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:' + ports.storage, STORAGE_EMULATOR_HOST: 'http://127.0.0.1:' + ports.storage,
    OFFLINE_CAPACITY_RUN_DIR: directory, OFFLINE_CAPACITY_PROFILE_ROOT: profileRoot,
    OFFLINE_CAPACITY_CORE_RUN_DIR: core, OFFLINE_CAPACITY_BROWSER_VERSION: accepted.phases.prepare.browserVersion,
    OFFLINE_CAPACITY_OVERFLOW: process.env.OFFLINE_CAPACITY_OVERFLOW === '1' ? '1' : '0',
    PLAYWRIGHT_EXECUTABLE_PATH: validatedTools.chrome, OFFLINE_QA_FFMPEG_PATH: validatedTools.ffmpeg,
    FIREBASE_CLI_DISABLE_USAGE: '1', NODE_OPTIONS: '--import=' + pathToFileURL(path.join(root, 'tools/event-night/restart-acceptance.mjs')).href });
  if (validatedTools.javaHome) env.JAVA_HOME = validatedTools.javaHome;
  env.PATH = [path.dirname(node), path.dirname(validatedTools.java), env.PATH ?? ''].join(path.delimiter);
  return env;
}

async function freePorts() {
  for (const port of [...Object.values(ports), 9159]) await new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once('error', () => reject(new Error('CAPACITY_QA_PORT_BUSY:' + port)));
    listener.listen(port, '127.0.0.1', () => listener.close(resolve));
  });
}

function run(args, filename, env) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(filename, { flags: 'wx' });
    const child = spawn(node, args, { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(output, { end: false }); child.stderr.pipe(output, { end: false });
    child.once('error', error => { output.end(); reject(error); });
    child.once('close', code => output.end(() => code === 0 ? resolve() : reject(new Error('CAPACITY_QA_CHILD_FAILED:' + path.basename(filename)))));
  });
}

async function browserPhase(phase, directory, env) {
  await run([playwright, 'test', '--config', config, '--workers=1', '--retries=0', '--output', path.join(directory, phase + '-browser-results')],
    path.join(directory, phase + '-browser.log'), { ...env, OFFLINE_CAPACITY_PHASE: phase });
  const filename = phase === 'prepare' && env.OFFLINE_CAPACITY_OVERFLOW === '1' ? 'overflow-proof.json' : phase + '-proof.json';
  assert.equal(read(path.join(directory, filename)).status, 'PASS');
}

async function hostingPreflight(directory) {
  const dist = path.join(root, 'apps/web/dist');
  const origin = 'http://127.0.0.1:5000';
  const check = async (route, artifact = route.slice(1)) => {
    const filename = path.resolve(dist, artifact);
    assert(filename.startsWith(dist + path.sep) && fs.statSync(filename).isFile(), 'Capacity Hosting artifact missing: ' + route);
    const response = await fetch(origin + route, { cache: 'no-store', redirect: 'error' });
    assert.equal(response.status, 200);
    const actual = hash(Buffer.from(await response.arrayBuffer()));
    assert.equal(actual, hash(fs.readFileSync(filename)), 'Capacity Hosting artifact differs: ' + route);
    return { route, artifact, sha256: actual };
  };
  const results = [await check('/admin/login', 'index.html'), await check('/offline.html'), await check('/offline-sw.js')];
  const inventory = /const FILES=(\[[^\n]*?\]);/u.exec(fs.readFileSync(path.join(dist, 'offline-sw.js'), 'utf8'));
  assert(inventory, 'Capacity precache inventory is missing.');
  const routes = JSON.parse(inventory[1]);
  assert(Array.isArray(routes) && routes.length > 0 && new Set(routes).size === routes.length);
  for (const route of routes) {
    assert(typeof route === 'string' && route.startsWith('/') && new URL(route, origin).pathname === route);
    results.push(await check(route));
  }
  save(path.join(directory, 'hosting-preflight.json'), { status: 'PASS', results });
}

function quote(value) {
  assert(!/[\r\n"]/u.test(value));
  if (process.platform === 'win32') { assert(!/[%!]/u.test(value)); return '"' + value + '"'; }
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

async function worker(directory) {
  const env = environment(directory);
  assert.equal(process.env.GCLOUD_PROJECT, project);
  for (const key of ['FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST', 'FUNCTIONS_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST']) assert.equal(process.env[key], env[key]);
  assert.deepEqual(sourceProof(), read(path.join(directory, 'source-binding.json')));
  await hostingPreflight(directory);
  await browserPhase('prepare', directory, env);
  assert.deepEqual(sourceProof(), read(path.join(directory, 'source-binding.json')));
}

async function main() {
  assert.equal(process.versions.node.split('.')[0], '22', 'Use the same owned Node22 runtime as the accepted core runner.');
  assert.equal(process.argv.length, 2, 'No deployment/build/source mutation flags are accepted.');
  const tools = validatedTools.proof;
  const free = fs.statfsSync(root);
  assert(free.bavail * free.bsize >= 6 * 1024 ** 3, 'Capacity needs at least 6 GiB of available space on the workspace drive.');
  const binding = sourceProof();
  await freePorts();
  const base = path.join(root, '.local-data/offline-v1');
  const directory = path.join(base, 'capacity-' + new Date().toISOString().replaceAll(/[:.]/gu, '-') + '-' + randomUUID().slice(0, 8));
  fs.mkdirSync(directory);
  const profileRoot = path.join(root, '.local-data', 'cp-' + randomUUID().slice(0, 8));
  fs.mkdirSync(profileRoot);
  save(path.join(directory, 'profile-paths.json'), { runDirectory: directory, root: fs.realpathSync(profileRoot) });
  for (const name of ['temp', 'cli-config']) fs.mkdirSync(path.join(directory, name));
  const env = environment(directory);
  save(path.join(directory, 'source-binding.json'), binding);
  save(path.join(directory, 'toolchain.json'), tools);
  for (const filename of ruleFiles) fs.copyFileSync(path.join(root, filename), path.join(directory, filename), fs.constants.COPYFILE_EXCL);
  prepareIsolatedFunctionsRuntime(root, directory, env);
  const configPath = path.join(directory, 'firebase.json');
  save(configPath, { functions: { source: 'functions-runtime' },
    hosting: { public: path.relative(directory, path.join(root, 'apps/web/dist')).replaceAll('\\', '/'), rewrites: [{ source: '**', destination: '/index.html' }] },
    firestore: { rules: 'firestore.rules', indexes: 'firestore.indexes.json' }, storage: { rules: 'storage.rules' },
    emulators: { ...Object.fromEntries(Object.entries(ports).map(([key, port]) => [key, { host: '127.0.0.1', port }])),
      firestore: { host: '127.0.0.1', port: ports.firestore, websocketPort: 9159 }, ui: { enabled: false }, singleProjectMode: true } });
  console.log('Capacity evidence: ' + path.relative(root, directory));
  let cleanupAttempted = false;
  const cleanup = async () => {
    cleanupAttempted = true;
    await freePorts();
    await browserPhase('cleanup', directory, env);
  };
  try {
    const command = [node, self, '--worker', directory].map(quote).join(' ');
    await run([cli, 'emulators:exec', '--only', 'auth,firestore,functions,storage,hosting', '--project', project,
      '--config', configPath, '--non-interactive', command], path.join(directory, 'prepare-emulator-suite.log'), env);
    await freePorts();
    assert.deepEqual(sourceProof(), binding);
    if (env.OFFLINE_CAPACITY_OVERFLOW !== '1') await browserPhase('offline', directory, env);
    await freePorts();
    assert.deepEqual(sourceProof(), binding);
    await cleanup();
    await freePorts();
    assert.deepEqual(sourceProof(), binding);
    save(path.join(directory, 'capacity-proof.json'), { status: 'PASS', source: binding,
      toolchain: tools,
      mode: env.OFFLINE_CAPACITY_OVERFLOW === '1' ? 'Actual 512MiB+1 byte inventory denied before READY' : 'Actual 512MiB prepare/download/STOP-ALL/cold-offline-import/21-native-videos/restart/recovery',
      prepare: read(path.join(directory, env.OFFLINE_CAPACITY_OVERFLOW === '1' ? 'overflow-proof.json' : 'prepare-proof.json')),
      ...(env.OFFLINE_CAPACITY_OVERFLOW === '1' ? {} : { offline: read(path.join(directory, 'offline-proof.json')) }),
      cleanup: read(path.join(directory, 'cleanup-proof.json')),
      limitations: ['No physical OS restart/projector/audio or native OS save-dialog evidence.',
        'Padded valid MP4 containers prove real byte processing, not complex 4K decode or universal RAM headroom.'],
      cost: 'Only isolated local demo emulators, locally generated synthetic media, existing Chrome/ffmpeg. No cloud/deployment/paid service.' });
    console.log('OFFLINE_CAPACITY_PASS');
  } catch (error) {
    if (!cleanupAttempted) {
      try { await cleanup(); }
      catch (cleanupError) { save(path.join(directory, 'cleanup-failure.json'), { status: 'FAIL', message: cleanupError.message }); }
    }
    save(path.join(directory, 'failure.json'), { status: 'FAIL', message: error.message, source: binding });
    throw error;
  }
}

if (process.argv[2] === '--worker') {
  assert.equal(process.argv.length, 4);
  const directory = fs.realpathSync(process.argv[3]);
  assert(directory.startsWith(path.join(root, '.local-data/offline-v1') + path.sep));
  await worker(directory);
} else {
  await main();
}
