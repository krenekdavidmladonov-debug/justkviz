// Isolated synthetic persistence acceptance. Never operates the user's event-night directory.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, readdirSync, lstatSync, realpathSync, existsSync, appendFileSync, cpSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import net from 'node:net';

const self = fileURLToPath(import.meta.url), root = realpathSync(path.resolve(path.dirname(self), '../..'));
export const ports = Object.freeze({ auth: 9399, functions: 5301, firestore: 8380, storage: 9398, hub: 4503, logging: 4603, eventarc: 9477, tasks: 9478 });
const hash = value => createHash('sha256').update(value).digest('hex');
const save = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
const read = file => JSON.parse(readFileSync(file, 'utf8'));
const phases = ['fresh', 'restart', 'recovered'];
const workerSteps = ['plan', 'registry', 'seeds', 'sdk', 'load-state', 'login', 'create-event', 'create-team', 'lock-quiz', 'save-score', 'save-media', 'capture-state', 'replay-score', 'continue-score', 'stale-score', 'verify-history', 'export', 'save-result'];
const diagnosticStages = new Set(['arguments', 'preflight', 'setup', 'recovery', 'verify-result', ...phases.map(phase => `${phase}-suite`), ...phases.flatMap(phase => workerSteps.map(step => `${phase}:${step}`))]);
const diagnosticCodes = new Set(['ERR_ASSERTION', 'ENOENT', 'EPERM', 'EACCES', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EADDRINUSE', 'ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED', 'ERR_REQUIRE_ESM', 'ERR_REQUIRE_ASYNC_MODULE', 'ERR_INVALID_ARG_TYPE', 'ABORT_ERR', 'OWN_CHILD_FAILED', ...['internal', 'unavailable', 'deadline-exceeded', 'permission-denied', 'unauthenticated', 'aborted', 'not-found', 'failed-precondition', 'resource-exhausted', 'invalid-argument'].map(code => `functions/${code}`)]);
const diagnosticLogs = new Set(['fresh-suite.log', 'restart-suite.log', 'recovered-suite.log', 'seed-auth.log', 'seed-quizzes.log', 'fresh-export.log', 'restart-export.log', 'recovered-export.log', 'recovery.log']);
const failureSignatures = [
  ['NON_LOOPBACK_NETWORK_BLOCKED', /NON_LOOPBACK_NETWORK_BLOCKED/u],
  ['EMULATOR_DOWNLOAD_OBSERVED', /download.*(?:emulator|runtime)|(?:emulator|runtime).*download/iu],
  ['FUNCTIONS_LOAD_FAILED', /Failed to load function definition|Cannot determine backend specification/iu],
  ['MODULE_NOT_FOUND', /Cannot find (?:module|package)|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND/u],
  ['MISSING_FILE_OR_COMMAND', /not recognized as an internal|command not found|ENOENT/iu],
  ['JAVA_UNAVAILABLE', /java.*(?:not found|not installed|unsupported|requires)|Could not spawn.*java/iu],
  ['PORT_UNAVAILABLE', /PORT_UNAVAILABLE|EADDRINUSE|port.*already in use/iu],
  ['EMULATOR_ENDPOINT_REFUSED', /ECONNREFUSED/u],
  ['REGISTRY_MISMATCH', /FOREIGN_HUB|EMULATOR_REGISTRY|SHIFTED_EMULATOR|FOREIGN_EMULATOR|FIRESTORE_WEBSOCKET|FIRESTORE_RESERVED_PORTS/u],
  ['SOURCE_CHANGED', /HARNESS_SOURCE_CHANGED|SOURCE_CHANGED_DURING_RUN/u],
  ['IMPORTED_CONTENT_CHANGED', /IMPORTED_CONTENT_CHANGED|IMPORTED_RECEIPT_REPLAY_CHANGED|IMPORT_MUTATED_CHECKPOINT/u],
  ['OWN_CHILD_FAILED', /OWN_CHILD_FAILED/u],
];
const diagnosticSignatures = new Set(['UNCLASSIFIED', ...failureSignatures.map(([name]) => name)]);
const diagnosticMarker = 'RESTART_ACCEPTANCE_DIAGNOSTIC ';
let activeStage = 'arguments';
const diagnosticFile = 'tools/event-night/restart-acceptance.mjs';
const validSourcePosition = value => Number.isSafeInteger(value) && value > 0 && value <= 10_000_000;
const validExitCode = value => Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff;

function ownHarnessFrame(error) {
  if (typeof error?.stack !== 'string') return undefined;
  for (const line of error.stack.slice(0, 16384).split('\n')) {
    if (!line.includes(self) && !line.includes(pathToFileURL(self).href)) continue;
    const position = /:(\d+):(\d+)\)?\s*$/u.exec(line);
    if (position && validSourcePosition(Number(position[1])) && validSourcePosition(Number(position[2]))) {
      return { file: diagnosticFile, line: Number(position[1]), column: Number(position[2]) };
    }
  }
  return undefined;
}

/** Fixed identifiers only: no exception text, paths, environment or captured data. */
function sanitizedDiagnosticEntry(value, depth = 0) {
  if (!value || typeof value !== 'object' || !diagnosticSignatures.has(value.signature)) return undefined;
  const result = { signature: value.signature };
  if (diagnosticStages.has(value.stage)) result.stage = value.stage;
  if (diagnosticCodes.has(value.code) || value.code === 'UNCLASSIFIED') result.code = value.code;
  if (diagnosticLogs.has(value.logFile)) result.logFile = value.logFile;
  if (validExitCode(value.exitCode)) result.exitCode = value.exitCode;
  if (['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGABRT'].includes(value.signal)) result.signal = value.signal;
  if (diagnosticCodes.has(value.causeCode)) result.causeCode = value.causeCode;
  if (diagnosticSignatures.has(value.causeSignature)) result.causeSignature = value.causeSignature;
  if (value.frame?.file === diagnosticFile && validSourcePosition(value.frame.line) && validSourcePosition(value.frame.column)) result.frame = { file: diagnosticFile, line: value.frame.line, column: value.frame.column };
  if (depth < 2 && Array.isArray(value.children)) result.children = value.children.slice(-8).map(item => sanitizedDiagnosticEntry(item, depth + 1)).filter(Boolean);
  return result;
}
export function safeFailureDiagnostic(error, stage = activeStage, logFile, depth = 0) {
  const message = typeof error?.message === 'string' ? error.message.slice(0, 4096) : '';
  const result = {
    stage: diagnosticStages.has(stage) ? stage : 'arguments',
    code: diagnosticCodes.has(error?.code) ? error.code : 'UNCLASSIFIED',
    signature: failureSignatures.find(([, pattern]) => pattern.test(message))?.[0] ?? 'UNCLASSIFIED',
  };
  if (diagnosticLogs.has(logFile)) result.logFile = logFile;
  if (validExitCode(error?.childExitCode)) result.exitCode = error.childExitCode;
  if (['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGABRT'].includes(error?.childSignal)) result.signal = error.childSignal;
  if (error?.cause && depth < 2) {
    const cause = safeFailureDiagnostic(error.cause, stage, undefined, depth + 1);
    result.causeCode = cause.code; result.causeSignature = cause.signature;
  }
  if (Array.isArray(error?.childDiagnostics)) result.children = error.childDiagnostics.slice(-8).map(item => sanitizedDiagnosticEntry(item)).filter(Boolean);
  const frame = ownHarnessFrame(error);
  if (frame) result.frame = frame;
  return result;
}

/** Relay only validated markers and fixed signatures from the last 64 KiB. */
export function safeChildDiagnostics(output) {
  const tail = output.slice(-65536), diagnostics = [];
  for (const line of tail.split(/\r?\n/u)) {
    const marker = line.indexOf(diagnosticMarker);
    if (marker < 0) continue;
    try {
      const parsed = JSON.parse(line.slice(marker + diagnosticMarker.length));
      if (!diagnosticStages.has(parsed.stage) || !diagnosticCodes.has(parsed.code) && parsed.code !== 'UNCLASSIFIED'
        || !diagnosticSignatures.has(parsed.signature)) continue;
      diagnostics.push(sanitizedDiagnosticEntry(parsed));
    } catch { /* Raw child output is deliberately never echoed. */ }
  }
  for (const [signature, pattern] of failureSignatures) if (pattern.test(tail)) diagnostics.push({ signature });
  return diagnostics.slice(-8);
}
export function assertLocalRequest(input) {
  const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
  assert(['http:', 'https:'].includes(url.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'NON_LOOPBACK_NETWORK_BLOCKED');
}
// Also loaded by NODE_OPTIONS before the CLI and its Node children. No credentials or URLs in logs.
function installNetworkGuard() {
  const require = createRequire(import.meta.url);
  for (const name of ['node:http', 'node:https']) {
    const module = require(name);
    for (const method of ['request', 'get']) {
      const original = module[method];
      module[method] = function (...args) {
        const options = args[0];
        const host = typeof options === 'object' && !(options instanceof URL) ? options.hostname ?? options.host ?? 'localhost' : new URL(options).hostname;
        assert(['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host), 'NON_LOOPBACK_NETWORK_BLOCKED');
        return original.apply(this, args);
      };
    }
  }
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, options) => { assertLocalRequest(input); return originalFetch(input, { ...options, redirect: 'error' }); };
  syncBuiltinESMExports();
}
if (process.env.EVENT_NIGHT_RESTART_NETWORK_GUARD === '1') installNetworkGuard();

export function assertPlan(plan, directory, environment) {
  assert(/^demo-restart-[a-f0-9]{12}$/u.test(plan.projectId), 'DEMO_PROJECT_REQUIRED');
  assert.equal(realpathSync(directory), directory);
  assert.equal(plan.directory, directory);
  assert.deepEqual(plan.ports, ports);
  assert.equal(environment.GCLOUD_PROJECT, plan.projectId);
  assert.equal(environment.GOOGLE_CLOUD_PROJECT, plan.projectId);
  for (const [key, name] of Object.entries({ FIREBASE_AUTH_EMULATOR_HOST: 'auth', FIRESTORE_EMULATOR_HOST: 'firestore', FUNCTIONS_EMULATOR_HOST: 'functions', FIREBASE_STORAGE_EMULATOR_HOST: 'storage' })) assert.equal(environment[key], `127.0.0.1:${ports[name]}`);
  for (const key of ['GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_TOKEN']) assert(!environment[key], 'CREDENTIAL_OVERRIDE_REFUSED');
  assert(!environment.CLOUD_RUNTIME_CONFIG, 'RUNTIME_CONFIG_OVERRIDE_REFUSED');
  if (environment.CLOUDSDK_CONFIG) assert.equal(environment.CLOUDSDK_CONFIG, path.join(directory, 'cli-config'), 'ADC_LOOKUP_OVERRIDE_REFUSED');
  if (environment.FIREBASE_CONFIG) assert.deepEqual(JSON.parse(environment.FIREBASE_CONFIG), { projectId: plan.projectId, storageBucket: plan.projectId + '.appspot.com', databaseURL: `https://${plan.projectId}.firebaseio.com` }, 'FOREIGN_CLI_CONFIG_REFUSED');
}
export function records(directory) {
  const output = [];
  function visit(current) {
    assert(!lstatSync(current).isSymbolicLink(), 'SNAPSHOT_LINK_REFUSED');
    for (const name of readdirSync(current).sort()) {
      const file = path.join(current, name), stat = lstatSync(file);
      assert(!stat.isSymbolicLink(), 'SNAPSHOT_LINK_REFUSED');
      if (stat.isDirectory()) visit(file);
      else { assert(stat.isFile()); const bytes = readFileSync(file); output.push({ path: path.relative(directory, file).replaceAll('\\', '/'), bytes: bytes.length, sha256: hash(bytes) }); }
    }
  }
  visit(directory);
  assert(output.length > 0, 'EMPTY_SNAPSHOT');
  return output;
}
export function assertExport(directory) {
  const files = records(directory); // Reject links before reading export metadata.
  const metadata = read(path.join(directory, 'firebase-export-metadata.json'));
  for (const name of ['auth', 'firestore', 'storage']) {
    assert(metadata[name] && typeof metadata[name].path === 'string', `MISSING_${name.toUpperCase()}_EXPORT`);
    const target = path.resolve(directory, metadata[name].path);
    assert(target.startsWith(directory + path.sep), 'EXPORT_PATH_ESCAPE');
    assert(lstatSync(target).isDirectory(), 'MISSING_EXPORT_DIRECTORY');
  }
  return files;
}
export function sanitizedEnvironment(directory, projectId, inherited = process.env) {
  const env = { ...inherited };
  for (const key of Object.keys(env)) if (/^(GOOGLE_|GCLOUD_|CLOUDSDK_|CLOUD_RUNTIME_CONFIG$|FIREBASE_|FIRESTORE_|FUNCTIONS_|PUBSUB_|CLOUD_TASKS_|EVENTARC_|VITE_|GMAIL_|EMAIL_|NODE_OPTIONS$|NODE_EXTRA_CA_CERTS$)/u.test(key)) delete env[key];
  // google-auth-library checks APPDATA/gcloud on Windows and HOME/.config/gcloud on Unix.
  // Neither inherited credential location may be inspected by these demo children.
  delete env.HOME;
  if (process.platform === 'win32') {
    const windowsRoot = inherited.SystemRoot ?? inherited.SYSTEMROOT ?? inherited.WINDIR ?? process.env.SystemRoot ?? process.env.WINDIR;
    assert(windowsRoot && path.isAbsolute(windowsRoot), 'WINDOWS_SYSTEM_ROOT_REQUIRED');
    const pathKeys = Object.keys(env).filter(key => key.toUpperCase() === 'PATH');
    const toolPath = pathKeys.map(key => env[key]).filter(Boolean).join(path.delimiter);
    for (const key of pathKeys) delete env[key];
    // Playwright invokes taskkill by name. Native runtime PATH may contain only
    // bundled tools; missing System32 leaves its owned web server alive forever.
    env.PATH = path.join(windowsRoot, 'System32') + path.delimiter + toolPath;
  }
  return { ...env, GCLOUD_PROJECT: projectId, GOOGLE_CLOUD_PROJECT: projectId,
    FIREBASE_AUTH_EMULATOR_HOST: `127.0.0.1:${ports.auth}`, FIRESTORE_EMULATOR_HOST: `127.0.0.1:${ports.firestore}`,
    FUNCTIONS_EMULATOR_HOST: `127.0.0.1:${ports.functions}`, FIREBASE_STORAGE_EMULATOR_HOST: `127.0.0.1:${ports.storage}`,
    XDG_CONFIG_HOME: path.join(directory, 'cli-config'), APPDATA: path.join(directory, 'cli-config'), CLOUDSDK_CONFIG: path.join(directory, 'cli-config'),
    // Storage Emulator clears its fixed temp subtree on shutdown. Port isolation
    // alone cannot protect another suite sharing the inherited OS temp directory.
    TEMP: path.join(directory, 'temp'), TMP: path.join(directory, 'temp'), TMPDIR: path.join(directory, 'temp'),
    CI: 'true', FIREBASE_CLI_DISABLE_UPDATE_CHECK: 'true',
    EVENT_NIGHT_RESTART_NETWORK_GUARD: '1', NODE_OPTIONS: `--import=${pathToFileURL(self).href}` };
}
export function run(executable, args, options) {
  return new Promise((resolve, reject) => {
    const { log, processReceipt, ...childOptions } = options;
    const stage = activeStage;
    let tail = '';
    const child = spawn(executable, args, { ...childOptions, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    if (processReceipt) save(processReceipt, { pid: child.pid });
    const capture = data => { appendFileSync(log, data); tail = (tail + data.toString('utf8')).slice(-65536); };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    const failure = (code, signal, cause) => {
      const error = Object.assign(new Error(`OWN_CHILD_FAILED:${code ?? signal ?? 'spawn'}`), {
        code: 'OWN_CHILD_FAILED', childExitCode: code, childSignal: signal, cause,
        childDiagnostics: safeChildDiagnostics(tail),
      });
      error.safeDiagnostic = safeFailureDiagnostic(error, stage, path.basename(log));
      return error;
    };
    child.once('error', cause => reject(failure(undefined, undefined, cause)));
    // close follows stdio drain; exit can run before the final failure marker arrives.
    child.once('close', (code, signal) => code === 0 && !signal ? resolve() : reject(failure(code, signal)));
  });
}
export function assertEmulatorRegistry(registry) {
  assert(registry && typeof registry === 'object' && !Array.isArray(registry), 'INVALID_EMULATOR_REGISTRY');
  assert.deepEqual(Object.keys(registry).sort(), Object.keys(ports).sort(), 'UNEXPECTED_EMULATOR_REGISTRY');
  for (const [name, port] of Object.entries(ports)) {
    const actual = registry[name];
    assert(actual?.name === name && actual.host === '127.0.0.1' && actual.port === port, 'SHIFTED_EMULATOR_ENDPOINT:' + name);
    if (actual.listen !== undefined) assert(Array.isArray(actual.listen) && actual.listen.length > 0 && actual.listen.every(item => item.address === '127.0.0.1' && item.port === port), 'FOREIGN_EMULATOR_LISTENER:' + name);
  }
  assert.equal(registry.firestore.webSocketHost, '127.0.0.1', 'FOREIGN_FIRESTORE_WEBSOCKET');
  assert.equal(registry.firestore.webSocketPort, ports.firestore + 1, 'SHIFTED_FIRESTORE_WEBSOCKET');
  assert.deepEqual(registry.firestore.reservedPorts, [ports.firestore + 1], 'UNEXPECTED_FIRESTORE_RESERVED_PORTS');
}

export async function portsFree() {
  for (const port of [...Object.values(ports), ports.firestore + 1]) await new Promise((resolve, reject) => {
    const server = net.createServer(); server.once('error', () => reject(new Error(`PORT_UNAVAILABLE:${port}`)));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}
const quote = value => process.platform === 'win32' ? `"${value}"` : `'${value.replaceAll("'", "'\\''")}'`;
function powerShellScript() {
  // The common module sees a completely synthetic repository, not the actual operator path.
  return `param([string]$Common,[string]$Sandbox,[string]$Project)
$ErrorActionPreference='Stop'; Set-StrictMode -Version 2.0
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1')
function Throw-QaError { param([string]$Message,[string]$Hint) throw "$Message $Hint" }
. $Common
$script:EventNightProjectId=$Project
$p=Get-EventNightPaths $Sandbox
New-Item -ItemType Directory -Path (Split-Path -Parent $p.CandidateManifest) -Force | Out-Null
@{schemaVersion=1;projectId=$Project;candidate=@{quizId='preflight-ready-e2e'}} | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $p.CandidateManifest -Encoding UTF8
New-EventNightSnapshotManifest $p.SnapshotDirectory $p
New-EventNightSnapshotManifest $p.ExportStaging $p
$prior=@(Get-EventNightFileRecords $p.SnapshotDirectory @()) | ConvertTo-Json -Depth 5 -Compress
$script:Canonical=$p.SnapshotDirectory; $script:Interrupted=$false
$script:RealSnapshotMove = (Get-Command Move-EventNightSnapshotPath -CommandType Function).ScriptBlock
function Move-EventNightSnapshotPath { [CmdletBinding()]param([string]$RepoRoot,[string]$LiteralPath,[string]$Destination)
 & $script:RealSnapshotMove @PSBoundParameters
 if($LiteralPath -eq $script:Canonical -and -not $script:Interrupted){$script:Interrupted=$true;throw 'ACCEPTANCE_INTERRUPTION_BETWEEN_RENAMES'}
}
$failed=$false
try { Promote-EventNightSnapshot $Sandbox $p | Out-Null } catch { if($_.Exception.Message -ne 'ACCEPTANCE_INTERRUPTION_BETWEEN_RENAMES'){throw};$failed=$true }
if(-not $failed -or (Test-Path -LiteralPath $p.SnapshotDirectory)){throw 'Expected actual missing canonical after first rename'}
$journal=Get-EventNightPromotionJournal $Sandbox $p
$backup=Join-Path $p.BackupDirectory $journal.previousBackup
$before=@(Get-EventNightFileRecords $backup @()) | ConvertTo-Json -Depth 5 -Compress
Restore-EventNightSnapshot $Sandbox $p | Out-Null
Restore-EventNightSnapshot $Sandbox $p | Out-Null
$after=@(Get-EventNightFileRecords $backup @()) | ConvertTo-Json -Depth 5 -Compress
$restored=@(Get-EventNightFileRecords $p.SnapshotDirectory @()) | ConvertTo-Json -Depth 5 -Compress
if($before -ne $after -or $prior -ne $restored -or (Test-Path -LiteralPath $p.PromotionJournal)){throw 'Recovery/retained backup identity failed'}
@{mode='REAL_RENAME_RECOVERY_PASS';projectId=$Project;backupPreserved=$true;idempotent=$true} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Sandbox 'recovery-result.json') -Encoding UTF8
`;
}
async function controller(powerShell) {
  activeStage = 'preflight';
  assert.equal(process.versions.node.split('.')[0], '22', 'NODE_22_REQUIRED');
  assert(path.isAbsolute(powerShell) && existsSync(powerShell), 'EXPLICIT_POWERSHELL_REQUIRED');
  await portsFree();
  activeStage = 'setup';
  // Keep real Firestore backup paths below Windows PowerShell 5's legacy path limit.
  const parent = path.join(root, '.local-data/en-restart'); mkdirSync(parent, { recursive: true }); assert.equal(realpathSync(parent), parent);
  const directory = mkdtempSync(path.join(parent, 'run-')), projectId = 'demo-restart-' + randomUUID().replaceAll('-', '').slice(0, 12);
  mkdirSync(path.join(directory, 'temp'));
  const env = sanitizedEnvironment(directory, projectId), sandbox = path.join(directory, 'sandbox');
  const plan = { directory, projectId, ports, sourceSha256: hash(readFileSync(self)), sources: [self, ...['tools/event-night/EventNight.Common.ps1', 'functions/lib/dev/seed-auth.js', 'functions/lib/dev/seed-quizzes.js', 'functions/package.json', 'firestore.rules', 'firestore.indexes.json', 'storage.rules'].map(file => path.join(root, file))].map(file => ({ path: path.relative(root, file), sha256: hash(readFileSync(file)) })), functionBuild: records(path.join(root, 'functions/lib')), domainBuild: records(path.join(root, 'packages/quiz-domain/lib')) };
  save(path.join(directory, 'plan.json'), plan); assertPlan(plan, directory, env);
  // The CLI reads dotenv in functions.source. Copy only build/package, never root .env files.
  const runtime = path.join(directory, 'functions-runtime'); mkdirSync(runtime);
  cpSync(path.join(root, 'functions/lib'), path.join(runtime, 'lib'), { recursive: true, errorOnExist: true, force: false });
  writeFileSync(path.join(runtime, 'package.json'), readFileSync(path.join(root, 'functions/package.json')), { flag: 'wx' });
  symlinkSync(realpathSync(path.join(root, 'functions/node_modules')), path.join(runtime, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  // pnpm's Windows .bin shims resolve relative to the invoking run directory.
  // Preserve that workspace dependency root as well as the Functions packages.
  symlinkSync(realpathSync(path.join(root, 'node_modules')), path.join(directory, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.deepEqual(records(path.join(runtime, 'lib')), plan.functionBuild);
  for (const name of ['firestore.rules', 'firestore.indexes.json', 'storage.rules']) writeFileSync(path.join(directory, name), readFileSync(path.join(root, name)), { flag: 'wx' });
  const config = { functions: { source: 'functions-runtime' }, firestore: { rules: 'firestore.rules', indexes: 'firestore.indexes.json' }, storage: { rules: 'storage.rules' }, emulators: { ...Object.fromEntries(Object.entries(ports).map(([name, port]) => [name, { host: '127.0.0.1', port }])), firestore: { host: '127.0.0.1', port: ports.firestore, websocketPort: ports.firestore + 1 }, ui: { enabled: false }, singleProjectMode: true } };
  save(path.join(directory, 'firebase.json'), config);
  const cli = path.join(root, 'node_modules/firebase-tools/lib/bin/firebase.js');
  assert.equal(createRequire(import.meta.url)('firebase-tools/package.json').version, '15.34.2');
  const cycle = async (phase, snapshot) => {
    activeStage = `${phase}-suite`;
    await portsFree();
    const command = [process.execPath, self, '--worker', phase, '--run-dir', directory].map(quote).join(' ');
    await run(process.execPath, [cli, 'emulators:exec', '--only', 'auth,functions,firestore,storage', '--project', projectId, '--config', path.join(directory, 'firebase.json'), '--non-interactive', ...(snapshot ? ['--import', snapshot] : []), command], { cwd: directory, env, log: path.join(directory, phase + '-suite.log'), processReceipt: path.join(directory, phase + '-suite-process.json') });
    await portsFree(); // Actual graceful CLI exit must release all assigned ports before the next start.
  };
  await cycle('fresh');
  const export1 = path.join(directory, 'checkpoint-1'), initialRecords = assertExport(export1);
  save(path.join(directory, 'checkpoint-1-checksums.json'), initialRecords);
  await cycle('restart', export1);
  assert.deepEqual(assertExport(export1), initialRecords, 'IMPORT_MUTATED_CHECKPOINT');
  const export2 = path.join(directory, 'checkpoint-2'); assertExport(export2);
  // Copy only our own exports; the real recovery helper owns no paths outside this synthetic sandbox.
  const data = path.join(sandbox, '.local-data/event-night'); mkdirSync(data, { recursive: true });
  cpSync(export1, path.join(data, 'emulator-data'), { recursive: true, errorOnExist: true, force: false });
  cpSync(export2, path.join(data, 'export-staging'), { recursive: true, errorOnExist: true, force: false });
  const script = path.join(directory, 'recover.ps1'); writeFileSync(script, '\ufeff' + powerShellScript(), { flag: 'wx' });
  activeStage = 'recovery';
  await run(powerShell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Common', path.join(root, 'tools/event-night/EventNight.Common.ps1'), '-Sandbox', sandbox, '-Project', projectId], { cwd: directory, env, log: path.join(directory, 'recovery.log') });
  const recovery = JSON.parse(readFileSync(path.join(sandbox, 'recovery-result.json'), 'utf8').replace(/^\uFEFF/u, '')); assert.equal(recovery.mode, 'REAL_RENAME_RECOVERY_PASS'); assert.equal(recovery.backupPreserved, true); assert.equal(recovery.idempotent, true);
  await cycle('recovered', path.join(data, 'emulator-data'));
  activeStage = 'verify-result';
  assert.deepEqual(assertExport(export1), initialRecords);
  for (const item of plan.sources) assert.equal(hash(readFileSync(path.join(root, item.path))), item.sha256, 'SOURCE_CHANGED_DURING_RUN');
  assert.deepEqual(records(path.join(root, 'functions/lib')), plan.functionBuild); assert.deepEqual(records(path.join(root, 'packages/quiz-domain/lib')), plan.domainBuild);
  assert.deepEqual(records(path.join(runtime, 'lib')), plan.functionBuild);
  const phases = ['fresh', 'restart', 'recovered'].map(phase => read(path.join(directory, phase + '-result.json'))); assert(phases.every(p => p.mode === 'PHASE_PASS' && p.projectId === projectId));
  const receipt = { mode: 'SYNTHETIC_EVENT_NIGHT_RESTART_RECOVERY_PASS', projectId, at: new Date().toISOString(), ports, planSha256: hash(readFileSync(path.join(directory, 'plan.json'))), checkpointSha256: hash(JSON.stringify(initialRecords)), phases, recovery, sources: plan.sources, limitations: ['Synthetic local Auth/Firestore/Storage persistence and callable scoring continuation only.', 'Process interruption between real directory renames; no power-loss or storage-hardware durability claim.', 'Not the fixed-port launcher, browser, migrated V1 quiz or an actual venue rehearsal.'] };
  save(path.join(directory, 'acceptance-result.json'), receipt);
  console.log(JSON.stringify({ mode: receipt.mode, directory, projectId }));
}
async function worker(phase, directory) {
  assert(['fresh', 'restart', 'recovered'].includes(phase));
  activeStage = `${phase}:plan`;
  const parent = path.join(root, '.local-data/en-restart'); assert(directory.startsWith(parent + path.sep));
  const plan = read(path.join(directory, 'plan.json')); assertPlan(plan, directory, process.env);
  assert.equal(plan.sourceSha256, hash(readFileSync(self)), 'HARNESS_SOURCE_CHANGED');
  activeStage = `${phase}:registry`;
  const status = await fetch(`http://127.0.0.1:${ports.hub}/`); assert.equal(status.status, 200); assert.equal((await status.json()).pid, read(path.join(directory, phase + '-suite-process.json')).pid, 'FOREIGN_HUB');
  const registry = await fetch(`http://127.0.0.1:${ports.hub}/emulators`); assert.equal(registry.status, 200); assertEmulatorRegistry(await registry.json());
  if (phase === 'fresh') {
    activeStage = `${phase}:seeds`;
    for (const name of ['seed-auth', 'seed-quizzes']) await run(process.execPath, [path.join(root, `functions/lib/dev/${name}.js`)], { cwd: directory, env: process.env, log: path.join(directory, name + '.log') });
  }
  activeStage = `${phase}:sdk`;
  const require = createRequire(path.join(root, 'functions/package.json'));
  const admin = require('firebase-admin/app'), app = admin.initializeApp({ projectId: plan.projectId, storageBucket: plan.projectId + '.appspot.com' }, 'restart-inspector');
  const db = require('firebase-admin/firestore').getFirestore(app), auth = require('firebase-admin/auth').getAuth(app), bucket = require('firebase-admin/storage').getStorage(app).bucket();
  const { initializeApp, deleteApp } = await import('firebase/app'), client = initializeApp({ apiKey: 'demo-api-key', projectId: plan.projectId }, 'restart-client');
  const authSdk = await import('firebase/auth'), functionsSdk = await import('firebase/functions');
  const clientAuth = authSdk.getAuth(client); authSdk.connectAuthEmulator(clientAuth, `http://127.0.0.1:${ports.auth}`, { disableWarnings: true });
  const functions = functionsSdk.getFunctions(client, 'europe-west1'); functionsSdk.connectFunctionsEmulator(functions, '127.0.0.1', ports.functions);
  const call = async (name, value) => (await functionsSdk.httpsCallable(functions, name)(value)).data;
  const objectName = 'synthetic-restart/retained.bin', payload = Buffer.from('Synthetic event-night restart bytes\n');
  try {
    const capture = async () => {
      const docs = [];
      const collections = async owner => { for (const collection of (await owner.listCollections()).sort((a, b) => a.id.localeCompare(b.id))) { const list = await collection.get(); for (const document of list.docs.sort((a, b) => a.id.localeCompare(b.id))) { docs.push({ path: document.ref.path, data: document.data() }); await collections(document.ref); } } };
      await collections(db);
      const users = (await auth.listUsers()).users.map(u => ({ uid: u.uid, email: u.email, emailVerified: u.emailVerified, disabled: u.disabled, displayName: u.displayName, customClaims: u.customClaims ?? {} })).sort((a, b) => a.uid.localeCompare(b.uid));
      const [bytes] = await bucket.file(objectName).download(), [metadata] = await bucket.file(objectName).getMetadata();
      return JSON.parse(JSON.stringify({ docs, users, object: { name: metadata.name, bucket: metadata.bucket, size: metadata.size, contentType: metadata.contentType, metadata: metadata.metadata ?? {}, sha256: hash(bytes) } }));
    };
    let owned;
    if (phase !== 'fresh') {
      activeStage = `${phase}:load-state`;
      owned = read(path.join(directory, 'owned.json'));
      assert.deepEqual(await capture(), read(path.join(directory, 'state-before.json')), 'IMPORTED_CONTENT_CHANGED');
    }
    activeStage = `${phase}:login`;
    await authSdk.signInWithEmailAndPassword(clientAuth, 'admin@example.test', 'LocalQuiz123!');
    if (phase === 'fresh') {
      activeStage = `${phase}:create-event`;
      const { eventId } = await call('createEvent', { expectedRevision: 0, event: { title: 'Synthetic restart acceptance', startsAt: '2031-01-01T18:00:00Z', timeZone: 'Europe/Prague', venue: { name: 'Synthetic', publicLocation: 'Synthetic' }, teamCapacity: 10, peopleCapacity: 40, teamSizeMin: 2, teamSizeMax: 4 } });
      activeStage = `${phase}:create-team`;
      const team = await call('adminAddEventTeam', { eventId, requestId: randomUUID(), teamName: 'Synthetic retained team', memberCount: 2 }); assert.equal(team.contactEmail, null);
      const event = (await db.doc(`events/${eventId}`).get()).data();
      activeStage = `${phase}:lock-quiz`;
      const { snapshotId } = await call('lockEventQuiz', { eventId, expectedRevision: event.revision, quizId: 'preflight-ready-e2e', expectedQuizRevision: 0, acknowledgeWarnings: false });
      const roundId = (await db.collection(`quizSnapshots/${snapshotId}/rounds`).get()).docs[0].id;
      const input = { eventId, snapshotId, roundId, teamId: team.registrationId, expectedRevision: 0, halfPoints: 0, reason: '', requestId: randomUUID() };
      activeStage = `${phase}:save-score`;
      const score = await call('saveEventScore', input); assert.equal(score.revision, 1);
      owned = { input, score }; save(path.join(directory, 'owned.json'), owned);
      activeStage = `${phase}:save-media`;
      await bucket.file(objectName).save(payload, { resumable: false, contentType: 'application/octet-stream', metadata: { metadata: { synthetic: 'true' } } });
      activeStage = `${phase}:capture-state`;
      save(path.join(directory, 'state-before.json'), await capture());
    } else {
      activeStage = `${phase}:replay-score`;
      assert.deepEqual(await call('saveEventScore', owned.input), owned.score, 'IMPORTED_RECEIPT_REPLAY_CHANGED');
      activeStage = `${phase}:continue-score`;
      const next = await call('saveEventScore', { ...owned.input, requestId: randomUUID(), expectedRevision: 1, halfPoints: 2, reason: 'Continued after verified restart' });
      assert.equal(next.revision, 2); assert.equal(next.halfPoints, 2);
      activeStage = `${phase}:stale-score`;
      await assert.rejects(call('saveEventScore', { ...owned.input, requestId: randomUUID(), expectedRevision: 1, halfPoints: 3, reason: 'Stale client' }), error => error.code === 'functions/aborted');
      activeStage = `${phase}:verify-history`;
      const scores = await db.collection(`events/${owned.input.eventId}/scores/${next.scoreId}/history`).orderBy('revision').get(); assert.deepEqual(scores.docs.map(d => d.data().revision), [1, 2]);
      const [bytes] = await bucket.file(objectName).download(); assert.deepEqual(bytes, payload);
    }
    activeStage = `${phase}:export`;
    const cli = path.join(root, 'node_modules/firebase-tools/lib/bin/firebase.js');
    await run(process.execPath, [cli, 'emulators:export', path.join(directory, phase === 'fresh' ? 'checkpoint-1' : phase === 'restart' ? 'checkpoint-2' : 'checkpoint-3'), '--project', plan.projectId, '--config', path.join(directory, 'firebase.json'), '--non-interactive'], { cwd: directory, env: process.env, log: path.join(directory, phase + '-export.log') });
    activeStage = `${phase}:save-result`;
    save(path.join(directory, phase + '-result.json'), { mode: 'PHASE_PASS', projectId: plan.projectId, phase, emulatorRegistryVerified: true, importedIdentityVerified: phase !== 'fresh', scoreRevision: phase === 'fresh' ? 1 : 2, storageBytesSha256: hash(payload), receiptReplayVerified: phase !== 'fresh', staleScoreRejected: phase !== 'fresh' });
  } finally { await deleteApp(client); await admin.deleteApp(app); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  const args = process.argv.slice(2);
  const task = args.length === 2 && args[0] === '--powershell' ? controller(args[1]) : args.length === 4 && args[0] === '--worker' && args[2] === '--run-dir' ? worker(args[1], path.resolve(args[3])) : Promise.reject(new Error('Use --powershell ABSOLUTE_EXECUTABLE'));
  task.catch(error => {
    const diagnostic = sanitizedDiagnosticEntry(error.safeDiagnostic) ?? safeFailureDiagnostic(error);
    console.error(diagnosticMarker + JSON.stringify(diagnostic));
    console.error('RESTART_ACCEPTANCE_STOP:', diagnostic.code, diagnostic.signature);
    process.exitCode = 1;
  });
}
