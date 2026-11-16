import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertExport, records, sanitizedEnvironment, prepareIsolatedFunctionsRuntime } from '../event-night/restart-acceptance.mjs';

const root = fs.realpathSync(process.cwd()), self = fileURLToPath(import.meta.url), node = process.execPath;
const project = 'demo-filmovy-kviz-v2';
const ports = { auth: 9099, firestore: 8080, functions: 5001, hosting: 5000, storage: 9199,
  hub: 4449, logging: 4559, eventarc: 9449, tasks: 9559 };
const read = filename => JSON.parse(fs.readFileSync(filename, 'utf8'));
const save = (filename, value) => fs.writeFileSync(filename, JSON.stringify(value, null, 2), { flag: 'wx' });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const cli = path.join(root, 'node_modules/firebase-tools/lib/bin/firebase.js');
const playwright = path.join(root, 'node_modules/@playwright/test/cli.js');
const configPath = directory => path.join(directory, 'firebase.json');

function sourceProof() {
  const directories = ['functions/lib', 'packages/quiz-domain/lib', 'apps/web/dist', 'apps/web/src/features/offline', 'tools/offline'];
  const inventory = directories.flatMap(directory => records(path.join(root, directory)).map(item => ({ ...item, root: directory })));
  for (const file of fs.readdirSync(path.join(root, 'tests/browser')).filter(file => file.startsWith('offline'))) {
    const filename = path.join(root, 'tests/browser', file); inventory.push({ path: 'tests/browser/' + file, sha256: hash(fs.readFileSync(filename)) });
  }
  for (const filename of ['tests/e2e/offline-emulator.mjs', 'tests/e2e/editor-identity.mjs', 'tests/e2e/media-fixture.mjs',
    'tests/e2e/media-event-fixture.mjs', 'tools/event-night/restart-acceptance.mjs', 'tools/local-emulator-environment.mjs', 'pnpm-lock.yaml']) {
    inventory.push({ path: filename, sha256: hash(fs.readFileSync(path.join(root, filename))) });
  }
  return { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim(),
    tree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim(),
    artifactAndHarnessSha256: hash(JSON.stringify(inventory)), inventory };
}

function runtimeEnvironment(directory) {
  const env = sanitizedEnvironment(directory, project);
  const profilePaths = read(path.join(directory, 'profile-paths.json'));
  assert.equal(profilePaths.runDirectory, directory);
  const profileRoot = fs.realpathSync(profilePaths.root);
  assert(/^op-[a-f0-9]{8}$/u.test(path.relative(path.join(root, '.local-data'), profileRoot)), 'RUN_OWNED_SHORT_PROFILE_REQUIRED');
  Object.assign(env, { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:' + ports.auth,
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:' + ports.firestore, FUNCTIONS_EMULATOR_HOST: '127.0.0.1:' + ports.functions,
    FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:' + ports.storage, STORAGE_EMULATOR_HOST: 'http://127.0.0.1:' + ports.storage,
    OFFLINE_QA_RUN_DIR: directory, OFFLINE_QA_PROFILE_ROOT: profileRoot, FIREBASE_CLI_DISABLE_USAGE: '1',
    NODE_OPTIONS: '--import=' + pathToFileURL(path.join(root, 'tools/event-night/restart-acceptance.mjs')).href });
  const javaHome = process.env.JAVA_HOME ?? (process.platform === 'win32' ? 'C:/Projects/filmovy-kviz-v2/.tools/jdk21/jdk-21.0.12.1+1' : undefined);
  if (javaHome) { env.JAVA_HOME = javaHome; env.PATH = path.dirname(node) + path.delimiter + path.join(javaHome, 'bin') + path.delimiter + (env.PATH ?? ''); }
  return env;
}

async function freePorts() {
  for (const port of [...Object.values(ports), 9159]) await new Promise((resolve, reject) => {
    const listener = net.createServer(); listener.once('error', () => reject(new Error('OFFLINE_QA_PORT_BUSY:' + port)));
    listener.listen(port, '127.0.0.1', () => listener.close(resolve));
  });
}

function run(args, log, env) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(log, { flags: 'wx' });
    const child = spawn(node, args, { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(output, { end: false }); child.stderr.pipe(output, { end: false });
    child.once('error', error => { output.end(); reject(error); });
    child.once('close', code => { output.end(() => code === 0 ? resolve() : reject(new Error('OFFLINE_QA_CHILD_FAILED:' + path.basename(log)))); });
  });
}

async function browserPhase(phase, directory, env) {
  await run([playwright, 'test', '--config', 'tests/browser/offline-event.config.ts', '--workers=1', '--retries=0',
    '--output', path.join(directory, phase + '-browser-results')],
    path.join(directory, phase + '-browser.log'), { ...env, OFFLINE_QA_PHASE: phase });
  assert.equal(read(path.join(directory, phase + '-proof.json')).status, 'PASS');
}

async function hostingPreflight(directory, phase) {
  const results = [], cacheFiles = [];
  const checkFile = async (route, artifact) => {
    const diskFile = path.resolve(root, 'apps/web/dist', artifact);
    assert(diskFile.startsWith(path.join(root, 'apps/web/dist') + path.sep) && fs.existsSync(diskFile), 'BUILD_ASSET_MISSING:' + route);
    const response = await fetch('http://127.0.0.1:' + ports.hosting + route, { cache: 'no-store', redirect: 'error' });
    assert.equal(response.status, 200, 'HOSTING_ARTIFACT_UNAVAILABLE:' + route);
    const actual = hash(Buffer.from(await response.arrayBuffer()));
    assert.equal(actual, hash(fs.readFileSync(diskFile)), 'HOSTING_ARTIFACT_MISMATCH:' + route);
    return { route, status: response.status, sha256: actual, contentType: response.headers.get('content-type') };
  };
  for (const [route, artifact] of [['/index.html', 'index.html'], ['/admin/login', 'index.html'], ['/offline.html', 'offline.html'], ['/offline-sw.js', 'offline-sw.js']]) {
    results.push(await checkFile(route, artifact));
  }
  const filesMatch = /const FILES=(\[[^\n]*?\]);/u.exec(fs.readFileSync(path.join(root, 'apps/web/dist/offline-sw.js'), 'utf8'));
  assert(filesMatch, 'OFFLINE_PRECACHE_INVENTORY_REQUIRED');
  const files = JSON.parse(filesMatch[1]);
  assert(Array.isArray(files) && files.length > 0 && new Set(files).size === files.length);
  for (const route of files) {
    assert(typeof route === 'string' && route.startsWith('/') && new URL(route, 'http://127.0.0.1:' + ports.hosting).pathname === route);
    cacheFiles.push(await checkFile(route, route.slice(1)));
  }
  save(path.join(directory, 'hosting-preflight-' + phase + '.json'), { status: 'PASS', results, cacheFiles, precacheAssetCount: cacheFiles.length });
}

async function worker(phase, directory) {
  const env = runtimeEnvironment(directory), binding = read(path.join(directory, 'source-binding.json'));
  assert.deepEqual(sourceProof(), binding);
  assert.equal(process.env.GCLOUD_PROJECT, project);
  for (const key of ['FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST', 'FUNCTIONS_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST']) assert.equal(process.env[key], env[key]);
  await hostingPreflight(directory, phase);
  if (phase === 'fresh') {
    await run(['tests/e2e/offline-emulator.mjs'], path.join(directory, 'server-emulator.log'), env);
    await browserPhase('prepare', directory, env);
    assert(!fs.existsSync(path.join(directory, 'emulator-export')), 'Export must be create-only.');
    await run([cli, 'emulators:export', path.join(directory, 'emulator-export'), '--project', project, '--config', configPath(directory), '--non-interactive'],
      path.join(directory, 'export.log'), env);
    save(path.join(directory, 'export-proof.json'), assertExport(path.join(directory, 'emulator-export')));
  } else {
    assert.equal(phase, 'restored');
    assert.deepEqual(assertExport(path.join(directory, 'emulator-export')), read(path.join(directory, 'export-proof.json')));
    await browserPhase('sync', directory, env);
  }
  assert.deepEqual(sourceProof(), binding);
}

function quote(value) {
  assert(!/[\r\n"]/u.test(value));
  if (process.platform === 'win32') { assert(!/[%!]/u.test(value)); return '"' + value + '"'; }
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

async function acceptance() {
  assert.equal(process.versions.node.split('.')[0], '22', 'Run the offline acceptance harness with Node 22.');
  const base = path.join(root, '.local-data/offline-v1'); fs.mkdirSync(base, { recursive: true });
  const directory = path.join(base, 'acceptance-' + new Date().toISOString().replaceAll(/[:.]/gu, '-') + '-' + randomUUID().slice(0, 8));
  fs.mkdirSync(directory); const actualDirectory = fs.realpathSync(directory);
  for (const name of ['temp', 'cli-config']) fs.mkdirSync(path.join(actualDirectory, name));
  const profileRoot = path.join(root, '.local-data', 'op-' + randomUUID().slice(0, 8));
  fs.mkdirSync(profileRoot);
  save(path.join(actualDirectory, 'profile-paths.json'), { schemaVersion: 1, runDirectory: actualDirectory,
    root: fs.realpathSync(profileRoot), profiles: { producer: 'p', notebook: 't', checkpoint: 'checkpoint', fork: 'fork' } });
  const env = runtimeEnvironment(actualDirectory);
  const binding = sourceProof(); save(path.join(actualDirectory, 'source-binding.json'), binding);
  for (const filename of ['firestore.rules', 'firestore.indexes.json', 'storage.rules']) fs.copyFileSync(path.join(root, filename), path.join(actualDirectory, filename), fs.constants.COPYFILE_EXCL);
  prepareIsolatedFunctionsRuntime(root, actualDirectory, env);
  save(configPath(actualDirectory), { functions: { source: 'functions-runtime' },
    hosting: { public: path.relative(actualDirectory, path.join(root, 'apps/web/dist')).replaceAll('\\', '/'), rewrites: [{ source: '**', destination: '/index.html' }] },
    firestore: { rules: 'firestore.rules', indexes: 'firestore.indexes.json' }, storage: { rules: 'storage.rules' },
    emulators: { ...Object.fromEntries(Object.entries(ports).map(([key, port]) => [key, { host: '127.0.0.1', port }])),
      firestore: { host: '127.0.0.1', port: ports.firestore, websocketPort: 9159 }, ui: { enabled: false }, singleProjectMode: true } });
  console.log('Offline acceptance evidence: ' + path.relative(root, actualDirectory));
  console.log('Run-owned short browser profiles: ' + path.relative(root, profileRoot));
  let cleanupAttempted = false;
  try {
    for (const phase of ['fresh', 'restored']) {
      await freePorts(); assert.deepEqual(sourceProof(), binding);
      if (phase === 'restored') {
        // This worker starts while ALL emulators, including Hosting, are stopped.
        console.log('OFFLINE_PHASE_START: cold persistent Chromium with every backend stopped');
        await browserPhase('offline', actualDirectory, env); await freePorts();
      }
      console.log('OFFLINE_EMULATOR_PHASE_START: ' + phase);
      const command = [node, self, '--worker', phase, '--directory', actualDirectory].map(quote).join(' ');
      await run([cli, 'emulators:exec', '--only', 'auth,firestore,functions,storage,hosting', '--project', project,
        '--config', configPath(actualDirectory), '--non-interactive', ...(phase === 'restored' ? ['--import', path.join(actualDirectory, 'emulator-export')] : []), command],
        path.join(actualDirectory, phase + '-suite.log'), env);
      await freePorts();
    }
    assert.deepEqual(sourceProof(), binding);
    const phases = Object.fromEntries(['prepare', 'offline', 'sync'].map(phase => [phase, read(path.join(actualDirectory, phase + '-proof.json'))]));
    cleanupAttempted = true;
    await browserPhase('cleanup', actualDirectory, env);
    assert.deepEqual(sourceProof(), binding);
    save(path.join(actualDirectory, 'acceptance.json'), { status: 'PASS', schemaVersion: 1, source: binding,
      project, mode: 'Real demo prepare/export/stop-all/cold-persistent-Chromium-offline/import/UI-sync', phases,
      profilePaths: read(path.join(actualDirectory, 'profile-paths.json')),
      nativeApplicationCleanup: read(path.join(actualDirectory, 'cleanup-proof.json')),
      network: 'Node HTTP(S)/fetch non-loopback blocked; empty CLI credential home; browser non-loopback aborted; true browser offline during stopped-backend evening.',
      limitations: ['Physical projector, hardware audio and operating-system restart NOT TESTED.', 'Native OS save dialog NOT TESTED; standard browser download writes real portable/recovery files.'],
      cost: 'Local synthetic emulator and browser execution only; no deployment, cloud data or paid service.' });
    console.log('OFFLINE_V1_ACCEPTANCE_PASS');
  } catch (error) {
    let cleanupError;
    if (!cleanupAttempted) {
      try { await browserPhase('cleanup', actualDirectory, env); }
      catch (failure) { cleanupError = failure.message; }
    }
    save(path.join(actualDirectory, 'failure.json'), { status: 'FAIL', message: error.message, source: binding,
      ...(cleanupError ? { cleanupError } : {}),
      completedPhases: ['prepare', 'offline', 'sync'].filter(phase => fs.existsSync(path.join(actualDirectory, phase + '-proof.json'))) });
    throw error;
  }
}

if (process.argv[2] === '--worker') {
  const directory = fs.realpathSync(process.argv[5]);
  assert(directory.startsWith(path.join(root, '.local-data/offline-v1') + path.sep));
  await worker(process.argv[3], directory);
} else {
  assert.equal(process.argv.length, 2, 'This acceptance command takes no mutation or deployment flags.');
  await acceptance();
}
