import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertStagingEnvironment, STAGING_APP, STAGING_PROJECT } from '../staging/guard.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const json = file => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
const clean = () => assert.equal(git('status', '--porcelain', '--untracked-files=all'), '', 'Commit reviewed inputs before preparing a release.');
assert.equal(process.versions.node.split('.')[0], '22');
clean();
const [mode, synthetic] = process.argv.slice(2);
assert(process.argv.length <= 4 && ['disabled', 'enabled', 'recovery'].includes(mode) && [undefined, '--synthetic'].includes(synthetic),
  'Use: node tools/offline/prepare-release.mjs disabled|enabled|recovery [--synthetic]');
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
mkdirSync(out);
const write = (name, value) => writeFileSync(path.join(out, name), value, { flag: 'wx' });
const run = (file, args, cwd = root) => execFileSync(process.execPath, [path.join(root, file), ...args], { cwd, env, stdio: 'inherit' });
const compiledFunctions = path.join(out, '.compiled-functions');
run('node_modules/typescript/bin/tsc', ['-p', 'packages/quiz-domain/tsconfig.json']);
run('node_modules/typescript/bin/tsc', ['-p', 'functions/tsconfig.json', '--outDir', compiledFunctions]);
run('apps/web/node_modules/vite/bin/vite.js', ['build', '--mode', 'staging', '--outDir', path.join(out, 'hosting')], path.join(root, 'apps/web'));

const functions = path.join(out, 'functions');
mkdirSync(path.join(functions, 'vendor', 'quiz-domain'), { recursive: true });
cpSync(compiledFunctions, path.join(functions, 'lib'), { recursive: true, filter: source => {
  const relative = path.relative(compiledFunctions, source);
  assert(!lstatSync(source).isSymbolicLink());
  return relative !== 'dev' && relative !== 'index.js';
} });
run('node_modules/typescript/bin/tsc', ['-p', 'packages/quiz-domain/tsconfig.json', '--outDir', path.join(functions, 'vendor/quiz-domain/lib')]);
cpSync(path.join(root, 'packages/quiz-domain/package.json'), path.join(functions, 'vendor/quiz-domain/package.json'));
const deployPkg = json('functions/package.json');
delete deployPkg.scripts;
deployPkg.dependencies['@filmovy-kviz/quiz-domain'] = 'file:vendor/quiz-domain';
const lock = json('tools/staging/functions-package-lock.json');
assert.deepEqual(deployPkg.dependencies, lock.packages[''].dependencies);
write('functions/package.json', JSON.stringify(deployPkg, null, 2) + '\n');
cpSync(path.join(root, 'tools/staging/functions-package-lock.json'), path.join(functions, 'package-lock.json'));
write('functions/lib/index.js', [
  "import { getApps, initializeApp } from 'firebase-admin/app';",
  'if (!getApps().length) initializeApp();',
  "export { readOfflineTrust, prepareOfflineEvent, authorizeOfflineEvent } from './offline/prepare.js';",
  "export { previewOfflineSync, commitOfflineSync } from './offline/sync.js';",
  "export { readQuizMedia } from './media/endpoint.js';",
  "export { beginQuizMediaUpload, finalizeQuizMediaUpload } from './media/callables.js';",
  "export { deleteEvent } from './events/deletion.js';",
  '',
].join('\n'));
const config = json(inventory.hostingConfig);
assert.equal(config.hosting.site, inventory.hostingSite);
config.hosting.public = 'hosting';
config.functions = { source: 'functions', codebase: 'default', runtime: 'nodejs22' };
config.storage = { rules: 'storage.rules' };
cpSync(path.join(root, 'storage.rules'), path.join(out, 'storage.rules'));
write(synthetic ? 'firebase.offline-release.example.json' : 'firebase.offline-release.json', JSON.stringify(config, null, 2) + '\n');
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
  newFunctions: inventory.newCallableFunctions, updatedFunctions: inventory.existingFunctionsToUpdate,
  conditionalFunctions: [...inventory.compatibleMediaPrerequisitesIfMissing, ...inventory.compatibleDeletionRegistryIfMissing],
  checksums,
}, null, 2) + '\n');
console.log('OFFLINE_RELEASE_PREPARED ' + path.relative(root, out));
