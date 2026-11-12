import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, writeFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertStagingEnvironment, assertStagingProject, STAGING_PROJECT, STAGING_URL } from './guard.mjs';
import { stagingWebConfig, stagingClient } from './cloud.mjs';
import { deploymentMode, assertNoObsoleteHostingDeployment, assertHostingOnlyConfig, hostingOnlyArgs, assertFrontendFiles, teamToolFunctionArgs } from './hosting-only.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
process.chdir(root);
assertStagingProject(process.argv[2]);
const mode = deploymentMode(process.argv.slice(2));
if (Number(process.versions.node.split('.')[0]) !== 22) throw new Error('Node 22 required.');
const branch = spawnSync('git', ['branch', '--show-current'], { encoding: 'utf8' });
if (branch.status !== 0 || !branch.stdout.trim()) throw new Error('A named Git branch is required.');
console.log(`Branch: ${branch.stdout.trim()}\nTarget: ${STAGING_PROJECT}`);
const config = JSON.parse(readFileSync('firebase.staging.json', 'utf8'));
assertNoObsoleteHostingDeployment(mode, config);
if (mode !== 'full') assertHostingOnlyConfig(config);
if (config.hosting.site !== STAGING_PROJECT || config.functions.source !== '.local-data/staging/functions' ||
    config.hosting.public !== 'apps/web/dist' || config.storage || config.functions.predeploy) throw new Error('Unexpected deploy configuration.');
const sdk = await stagingWebConfig();
const env = { ...process.env, VITE_APP_ENV: 'staging', VITE_FIREBASE_API_KEY: sdk.apiKey,
  VITE_FIREBASE_AUTH_DOMAIN: sdk.authDomain, VITE_FIREBASE_PROJECT_ID: sdk.projectId,
  VITE_FIREBASE_STORAGE_BUCKET: `${STAGING_PROJECT}.firebasestorage.app`,
  VITE_FIREBASE_MESSAGING_SENDER_ID: sdk.messagingSenderId, VITE_FIREBASE_APP_ID: sdk.appId,
  VITE_FIREBASE_USE_EMULATORS: 'false', VITE_FIREBASE_ALLOW_NON_DEMO_PROJECT: 'true' };
assertStagingEnvironment(env);
function run(file, args, cwd = root) {
  const result = spawnSync(process.execPath, [file, ...args], { cwd, env, stdio: 'inherit' });
  if (result.status !== 0) throw new Error('Staging command failed; deployment stopped.');
}
const tsc = path.join(root, 'node_modules/typescript/bin/tsc');
if (mode === 'hosting-only') {
  const git = (args) => {
    const result = spawnSync('git', args, { encoding: 'utf8' });
    if (result.status !== 0) throw new Error('Cannot verify deployment Git state.');
    return result.stdout.trim();
  };
  if (git(['status', '--porcelain'])) throw new Error('Hosting-only requires a clean verified commit.');
  const sha = git(['rev-parse', 'HEAD']);
  const hosting = await stagingClient('https://firebasehosting.googleapis.com', 'v1beta1');
  const releases = async () => (await hosting.get(`sites/${STAGING_PROJECT}/releases`, { queryParams: { pageSize: 1 } })).body.releases ?? [];
  const previous = (await releases()).map((release) => ({ name: release.name, releaseTime: release.releaseTime, version: release.version?.name }));
  run(tsc, ['-p', 'packages/quiz-domain/tsconfig.json']);
  run(path.join(root, 'apps/web/node_modules/vite/bin/vite.js'), ['build', '--mode', 'staging'], path.join(root, 'apps/web'));
  const publicDir = path.join(root, 'apps/web/dist');
  if (realpathSync(publicDir) !== publicDir) throw new Error('Frontend output must not be a linked directory.');
  const files = [];
  function inspect(directory, prefix = '') {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('Linked frontend artifacts are forbidden.');
      const name = prefix + entry.name;
      if (entry.isDirectory()) inspect(path.join(directory, entry.name), name + '/');
      else files.push({ name, text: readFileSync(path.join(directory, entry.name), 'utf8') });
    }
  }
  inspect(publicDir);
  assertFrontendFiles(files);
  if (!files.some((file) => file.text.includes('STAGING'))) throw new Error('STAGING marker missing from build.');
  mkdirSync('.local-data/staging', { recursive: true });
  const configPath = path.join(root, '.local-data/staging/hosting-only.json');
  writeFileSync(configPath, JSON.stringify({ hosting: { ...config.hosting, public: publicDir } }, null, 2));
  const auditPath = path.join(root, '.local-data/staging/hosting-' + sha + '.json');
  writeFileSync(auditPath, JSON.stringify({ sha, branch: branch.stdout.trim(), project: STAGING_PROJECT, previous, status: 'prepared' }, null, 2));
  if (git(['rev-parse', 'HEAD']) !== sha || git(['status', '--porcelain'])) throw new Error('Git state changed during build.');
  run(path.join(root, 'node_modules/firebase-tools/lib/bin/firebase.js'), hostingOnlyArgs(STAGING_PROJECT, env, config, configPath));
  const current = (await releases()).map((release) => ({ name: release.name, releaseTime: release.releaseTime, version: release.version?.name }));
  writeFileSync(auditPath, JSON.stringify({ sha, project: STAGING_PROJECT, previous, current, status: 'deployed' }, null, 2));
  console.log(JSON.stringify({ sha, previous, current, url: STAGING_URL }));
  process.exit(0);
}
run(tsc, ['-p', 'packages/quiz-domain/tsconfig.json']);
run(tsc, ['-p', 'functions/tsconfig.json']);
if (mode === 'full') run(path.join(root, 'apps/web/node_modules/vite/bin/vite.js'), ['build', '--mode', 'staging'], path.join(root, 'apps/web'));

// Self-contained generated source package. No workspace symlinks, seeds, or local credentials are uploaded.
const output = path.join(root, config.functions.source);
mkdirSync(output, { recursive: true });
cpSync('functions/lib', path.join(output, 'lib'), { recursive: true, filter: (source) => !source.split(path.sep).includes('dev') });
const domain = path.join(output, 'vendor/quiz-domain');
mkdirSync(domain, { recursive: true });
cpSync('packages/quiz-domain/lib', path.join(domain, 'lib'), { recursive: true });
cpSync('packages/quiz-domain/package.json', path.join(domain, 'package.json'));
const pkg = JSON.parse(readFileSync('functions/package.json', 'utf8'));
delete pkg.scripts;
pkg.dependencies['@filmovy-kviz/quiz-domain'] = 'file:vendor/quiz-domain';
writeFileSync(path.join(output, 'package.json'), JSON.stringify(pkg, null, 2));
cpSync('tools/staging/functions-package-lock.json', path.join(output, 'package-lock.json'));
const npm = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
run(npm, ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], output);
if (mode === 'team-tools-functions') {
  const status = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8' });
  if (status.status !== 0 || status.stdout.trim()) throw new Error('Functions delivery requires a clean commit.');
  const configPath = path.join(root, '.local-data/staging/team-tools-functions.json');
  writeFileSync(configPath, JSON.stringify({ functions: { ...config.functions, source: output } }, null, 2));
  const args = teamToolFunctionArgs(STAGING_PROJECT, env, config, configPath);
  console.log('Exact scope: ' + args[args.indexOf('--only') + 1]);
  run(path.join(root, 'node_modules/firebase-tools/lib/bin/firebase.js'), args);
  process.exit(0);
}
run(path.join(root, 'node_modules/firebase-tools/lib/bin/firebase.js'), [
  'deploy', '--project', STAGING_PROJECT, '--config', 'firebase.staging.json',
  '--only', 'firestore:rules,firestore:indexes,functions,hosting', '--non-interactive',
]);
console.log(`STAGING: ${STAGING_URL}`);
