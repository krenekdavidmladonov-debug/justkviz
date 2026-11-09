import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertStagingEnvironment, STAGING_APP, STAGING_PROJECT } from '../staging/guard.mjs';
import { runtimeClosure } from '../staging/restart-build-core.mjs';
import { buildLiveHosting } from './live-hosting.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const json = file => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
const clean = () => assert.equal(git('status', '--porcelain', '--untracked-files=all'), '', 'Commit reviewed inputs before preparing a release.');
assert.equal(process.versions.node.split('.')[0], '22');
clean();
const [mode, type, baseline, metadata] = process.argv.slice(2);
const synthetic = type === '--synthetic';
assert(['disabled', 'enabled', 'recovery'].includes(mode) && ((synthetic && process.argv.length === 4)
  || (type === '--live' && process.argv.length === 6)),
  'Use: node tools/offline/prepare-release.mjs disabled|enabled|recovery (--synthetic | --live <verified-baseline> <live-metadata>)');
const commit = git('rev-parse', 'HEAD'), tree = git('rev-parse', 'HEAD^{tree}');
const inventory = json('tools/offline/deployment-manifest.json');
assert.equal(inventory.projectId, STAGING_PROJECT);
const env = { ...process.env, VITE_JUSTKVIZ_OFFLINE: { disabled: 'false', enabled: 'true', recovery: 'recovery' }[mode] };
if (synthetic) Object.assign(env, {
  VITE_FIREBASE_PROJECT_ID: STAGING_PROJECT, VITE_FIREBASE_APP_ID: STAGING_APP,
  VITE_FIREBASE_AUTH_DOMAIN: STAGING_PROJECT + '.firebaseapp.com', VITE_FIREBASE_STORAGE_BUCKET: STAGING_PROJECT + '.firebasestorage.app',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '177615774316', VITE_FIREBASE_API_KEY: 'synthetic-offline-release-only',
  VITE_FIREBASE_USE_EMULATORS: 'false', VITE_FIREBASE_ALLOW_NON_DEMO_PROJECT: 'true', VITE_APP_ENV: 'staging',
});
assertStagingEnvironment(env);
assert(synthetic || !env.VITE_FIREBASE_API_KEY.startsWith('synthetic-'), 'A release requires the separately approved public Web SDK configuration.');
const localData = path.join(root, '.local-data'), releaseRoot = path.join(localData, 'offline-release');
for (const directory of [localData, releaseRoot]) {
  mkdirSync(directory, { recursive: true });
  assert(lstatSync(directory).isDirectory() && !lstatSync(directory).isSymbolicLink());
}
const out = path.join(releaseRoot, commit + '-' + mode + (synthetic ? '-synthetic' : ''));
const scratch = out + '.work';
const config = json(inventory.hostingConfig);
assert.deepEqual(Object.keys(config), ['hosting']);
assert.equal(config.hosting.site, inventory.hostingSite);
config.hosting.public = 'hosting';
let live;
if (!synthetic) {
  live = JSON.parse(readFileSync(metadata, 'utf8'));
  const web = { apiKey: env.VITE_FIREBASE_API_KEY, appId: env.VITE_FIREBASE_APP_ID, authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID, projectId: env.VITE_FIREBASE_PROJECT_ID, storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET };
  assert.equal(live.webConfigHash, createHash('sha256').update(JSON.stringify(web)).digest('hex'), 'Public SDK settings differ from V2 metadata.');
  assert.equal(live.region, inventory.region);
  assert.equal(live.functionsPaginated, false);
  assert.equal(live.status.functions, 200);
  assert.equal(env.VITE_ENABLE_TEAM_EMAIL, 'false'); // Reproduced and checked byte-for-byte in the current online baseline.
}
mkdirSync(out);
mkdirSync(scratch);
const write = (name, value) => writeFileSync(path.join(out, name), value, { flag: 'wx' });
const run = (file, args, cwd = root) => execFileSync(process.execPath, [path.join(root, file), ...args], { cwd, env, stdio: 'inherit' });
const compiledFunctions = path.join(scratch, 'compiled-functions');
run('node_modules/typescript/bin/tsc', ['-p', 'packages/quiz-domain/tsconfig.json']);
run('node_modules/typescript/bin/tsc', ['-p', 'functions/tsconfig.json', '--outDir', compiledFunctions]);
if (synthetic) {
  run('apps/web/node_modules/vite/bin/vite.js', ['build', '--mode', 'staging', '--outDir', path.join(out, 'hosting')], path.join(root, 'apps/web'));
} else {
  write('hosting-manifest.json', JSON.stringify(buildLiveHosting({ root, baseline, metadata, config, out, scratch, env, mode }), null, 2) + '\n');
}

const functions = path.join(out, 'functions');
mkdirSync(path.join(functions, 'vendor', 'quiz-domain'), { recursive: true });

run('node_modules/typescript/bin/tsc', ['-p', 'packages/quiz-domain/tsconfig.json', '--outDir', path.join(functions, 'vendor/quiz-domain/lib')]);
cpSync(path.join(root, 'packages/quiz-domain/package.json'), path.join(functions, 'vendor/quiz-domain/package.json'));
const deployPkg = json('functions/package.json');
delete deployPkg.scripts;
deployPkg.dependencies['@filmovy-kviz/quiz-domain'] = 'file:vendor/quiz-domain';
const lock = json('tools/staging/functions-package-lock.json');
assert.deepEqual(deployPkg.dependencies, lock.packages[''].dependencies);
write('functions/package.json', JSON.stringify(deployPkg, null, 2) + '\n');
cpSync(path.join(root, 'tools/staging/functions-package-lock.json'), path.join(functions, 'package-lock.json'));
const index = [
  "import { getApps, initializeApp } from 'firebase-admin/app';",
  'if (!getApps().length) initializeApp();',
  "export { readOfflineTrust, prepareOfflineEvent, authorizeOfflineEvent } from './offline/prepare.js';",
  "export { previewOfflineSync, commitOfflineSync } from './offline/sync.js';",
  "export { readQuizMedia } from './media/endpoint.js';",
  ...(synthetic ? ["export { beginQuizMediaUpload, finalizeQuizMediaUpload } from './media/callables.js';"] : []),
  "export { deleteEvent } from './events/deletion.js';",
  '',
].join('\n');
for (const [file, contents] of runtimeClosure(index, name => readFileSync(path.join(compiledFunctions, name), 'utf8'), Object.keys(deployPkg.dependencies))) {
  mkdirSync(path.dirname(path.join(functions, 'lib', file)), { recursive: true });
  write('functions/lib/' + file, contents);
}
const exports = [...inventory.newCallableFunctions, ...inventory.existingFunctionsToUpdate,
  ...inventory.compatibleDeletionRegistryIfMissing, ...(synthetic ? inventory.compatibleMediaPrerequisitesIfMissing : [])];
if (!synthetic) {
  assert(inventory.newCallableFunctions.every(name => live.functions[name] === null), 'New callable IDs unexpectedly already exist.');
  const existing = [...inventory.existingFunctionsToUpdate, ...inventory.compatibleDeletionRegistryIfMissing];
  for (const name of existing) {
    assert(live.functions[name]?.allTrafficOnLatest && live.functions[name]?.runtime === 'nodejs22', 'Live update baseline differs: ' + name);
  }
  const gateway = live.functions.readQuizMedia;
  assert.equal(gateway.relevantFlags.DRIVE_CONNECTION_ENABLED, 'true');
  assert.deepEqual(gateway.secretBindings, [{ key: 'DRIVE_OAUTH_CLIENT_SECRET', version: '1' }, { key: 'DRIVE_TOKEN_KEYRING', version: '1' }]);
  write('backend-scope.json', JSON.stringify({ project: STAGING_PROJECT, region: inventory.region, mode,
    create: inventory.newCallableFunctions, update: existing, previous: Object.fromEntries(existing.map(name => [name, live.functions[name]])),
    skip: inventory.compatibleMediaPrerequisitesIfMissing, storageRules: 'unchanged', firestoreRules: 'unchanged',
    activate: { JUSTKVIZ_OFFLINE_ENABLED: mode === 'disabled' ? 'false' : 'true',
      JUSTKVIZ_OFFLINE_RECOVERY_ONLY: mode === 'recovery' ? 'true' : 'false', eventIdsRequired: mode !== 'disabled',
      signingBinding: mode === 'enabled' ? ['readOfflineTrust', 'prepareOfflineEvent'] : [] },
    guard: 'Review exact live configuration before writes. Preserve all unlisted environment variables, existing runtime identities, bindings and traffic. No IAM operation is authorized.',
  }, null, 2) + '\n');
}
write(synthetic ? 'firebase.offline-hosting.example.json' : 'firebase.offline-hosting.json', JSON.stringify(config, null, 2) + '\n');
const checksums = {};
function inspect(dir, prefix = '') {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    assert(!entry.isSymbolicLink());
    const filename = path.join(dir, entry.name), name = prefix + entry.name;
    if (entry.isDirectory()) inspect(filename, name + '/');
    else checksums[name] = createHash('sha256').update(readFileSync(filename)).digest('hex');
  }
}
inspect(out);
for (const name of inventory.hostingEntries.slice(1)) assert.equal(Boolean(checksums['hosting/' + name]), mode !== 'disabled');
assert.equal(git('rev-parse', 'HEAD'), commit);
clean();
write('receipt.json', JSON.stringify({
  status: synthetic ? 'SYNTHETIC_NOT_DEPLOYABLE' : 'PREPARED_NOT_DEPLOYED', commit, tree, mode,
  project: STAGING_PROJECT, site: inventory.hostingSite, node: process.versions.node,
  exports, newFunctions: inventory.newCallableFunctions, updatedFunctions: inventory.existingFunctionsToUpdate,
  deletionRegistry: inventory.compatibleDeletionRegistryIfMissing,
  backendActivation: 'A separately reviewed exact endpoint list is required. No backend deploy config is generated.',
  checksums,
}, null, 2) + '\n');
console.log('OFFLINE_RELEASE_PREPARED ' + path.relative(root, out));
