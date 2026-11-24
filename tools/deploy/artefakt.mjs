import { execFileSync } from 'node:child_process';
import { cpSync, createWriteStream, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { assertStagingEnvironment, STAGING_PROJECT as PROJECT } from '../staging/guard.mjs';

const SITE = 'justkviz-v2';
const BUCKET = PROJECT + '.firebasestorage.app';
const readJson = file => JSON.parse(readFileSync(file, 'utf8'));

function run(command, args, cwd, env = process.env) {
  execFileSync(command, args, { cwd, env, stdio: 'inherit', windowsHide: true });
}

function pnpmInstall(source, env) {
  const args = ['install', '--frozen-lockfile', '--ignore-scripts', '--prod=false'];
  if (process.platform === 'win32') run('cmd.exe', ['/d', '/c', 'pnpm ' + args.join(' ')], source, env);
  else run('pnpm', args, source, env);
}

export function removeArtifact(directory) {
  const resolved = realpathSync(directory);
  if (resolved !== directory || path.dirname(resolved) !== realpathSync(tmpdir()) ||
      !path.basename(resolved).startsWith('justkviz-deploy-')) throw new Error('Neočekávaná cesta dočasného artefaktu.');
  rmSync(directory, { recursive: true, force: true });
}

export function deploymentConfig(hosting, withRules, withStorageRules) {
  if (hosting?.site !== SITE || hosting.public !== 'apps/web/dist' ||
      Object.keys(hosting).some(key => !['site', 'public', 'headers', 'ignore', 'rewrites'].includes(key)) ||
      !isDeepStrictEqual(hosting.rewrites, [{ source: '**', destination: '/index.html' }])) {
    throw new Error('Hosting musí používat pouze statické soubory explicitního produkčního site.');
  }
  const config = { hosting };
  if (withRules) {
    config.firestore = { database: '(default)', rules: 'firestore.rules' };
    if (withStorageRules) config.storage = [{ bucket: BUCKET, rules: 'storage.rules' }];
  }
  return config;
}

export function childEnv(source = process.env, nodeDir = path.dirname(process.execPath)) {
  const env = Object.fromEntries(Object.entries(source).filter(([key]) =>
    !/^(VITE_|NODE_ENV$|NODE_OPTIONS$|NODE_PATH$|FIREBASE_.*(?:_URL|_ORIGIN|_HOST)$)/iu.test(key) &&
    !/_EMULATOR_HOST$/iu.test(key)));
  // firebase-tools spouští při analýze Functions příkaz `node`; D1 běží přes .tools\node22 mimo PATH.
  const key = Object.keys(env).find(name => name.toUpperCase() === 'PATH') ?? 'PATH';
  env[key] = nodeDir + path.delimiter + (env[key] ?? '');
  return env;
}

function webEnvironment(sdk, env) {
  const web = {
    ...env,
    VITE_APP_ENV: 'staging',
    VITE_FIREBASE_API_KEY: sdk.apiKey,
    VITE_FIREBASE_AUTH_DOMAIN: sdk.authDomain,
    VITE_FIREBASE_PROJECT_ID: sdk.projectId,
    VITE_FIREBASE_STORAGE_BUCKET: BUCKET,
    VITE_FIREBASE_MESSAGING_SENDER_ID: sdk.messagingSenderId,
    VITE_FIREBASE_APP_ID: sdk.appId,
    VITE_FIREBASE_USE_EMULATORS: 'false',
    VITE_FIREBASE_ALLOW_NON_DEMO_PROJECT: 'true',
    VITE_JUSTKVIZ_OFFLINE: 'true',
    VITE_ENABLE_TEAM_EMAIL: 'false',
  };
  assertStagingEnvironment(web);
  return web;
}

function validateWeb(directory) {
  function inspect(dir) {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      if (item.isSymbolicLink() || /^\./u.test(item.name) || /\.(?:key|pem|p12|map)$/iu.test(item.name)) {
        throw new Error('Nepovolená položka výstupu webu: ' + item.name);
      }
      if (item.isDirectory()) inspect(file);
      else if (!item.isFile()) throw new Error('Neočekávaný typ souboru ve webu.');
    }
  }
  inspect(directory);
  for (const file of ['index.html', 'offline.html', 'offline-sw.js', 'offline.webmanifest']) {
    if (!readFileSync(path.join(directory, file)).length) throw new Error('Webový artefakt neobsahuje ' + file);
  }
}

async function packageFunctions(source, directory, cliRequire) {
  const bundle = path.join(directory, 'functions');
  const domain = path.join(bundle, 'vendor/quiz-domain');
  mkdirSync(domain, { recursive: true });
  cpSync(path.join(source, 'functions/lib'), path.join(bundle, 'lib'),
    { recursive: true, filter: filename => !path.relative(path.join(source, 'functions/lib'), filename).split(path.sep).includes('dev') });
  cpSync(path.join(source, 'packages/quiz-domain/lib'), path.join(domain, 'lib'), { recursive: true });
  cpSync(path.join(source, 'packages/quiz-domain/package.json'), path.join(domain, 'package.json'));
  const pkg = readJson(path.join(source, 'functions/package.json'));
  delete pkg.scripts;
  pkg.dependencies['@filmovy-kviz/quiz-domain'] = 'file:vendor/quiz-domain';
  const lock = path.join(source, 'tools/staging/functions-package-lock.json');
  if (!isDeepStrictEqual(readJson(lock).packages['']?.dependencies, pkg.dependencies)) {
    throw new Error('Uzamčené závislosti Functions je potřeba sladit s package.json.');
  }
  writeFileSync(path.join(bundle, 'package.json'), JSON.stringify(pkg, null, 2));
  cpSync(lock, path.join(bundle, 'package-lock.json'));

  const zip = path.join(directory, 'functions.zip');
  const archive = cliRequire('archiver')('zip');
  await new Promise((resolve, reject) => {
    const output = createWriteStream(zip, { flags: 'wx' });
    output.once('close', resolve);
    output.once('error', reject);
    archive.once('error', reject);
    archive.once('warning', reject);
    archive.pipe(output);
    archive.directory(bundle, false);
    archive.finalize().catch(reject);
  });
  return zip;
}

// CLI vytváří pouze chybějící exporty ze stejného balíčku, ze kterého vznikl functions.zip.
export function prepareFunctionCreation(artifact, execute = run) {
  const bundle = path.join(artifact.directory, 'functions');
  const npm = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  execute(process.execPath, [npm, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], bundle, artifact.env);
  const configPath = path.join(artifact.source, artifact.configName);
  const config = readJson(configPath);
  config.functions = { source: bundle, codebase: 'default', runtime: 'nodejs22' };
  writeFileSync(configPath, JSON.stringify(config, null, 2));
}

export async function prepareArtifact(root, head, sdk, { withFunctions, withRules, withStorageRules }) {
  const paths = execFileSync('git', ['ls-tree', '-r', head], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (/^(?:120000|160000) /mu.test(paths)) throw new Error('Zdroje vydání nesmí obsahovat odkazy ani submoduly.');
  const directory = mkdtempSync(path.join(realpathSync(tmpdir()), 'justkviz-deploy-'));
  try {
    const source = path.join(directory, 'source');
    const tar = path.join(directory, 'source.tar');
    mkdirSync(source);
    run('git', ['-c', 'core.autocrlf=false', 'archive', '--format=tar', '--output=' + tar, head], root);
    run('tar', ['-xf', tar, '-C', source], directory);

    const env = childEnv();
    pnpmInstall(source, env);
    const tsc = path.join(source, 'node_modules/typescript/bin/tsc');
    run(process.execPath, [tsc, '-p', 'packages/quiz-domain/tsconfig.json'], source, env);
    const web = path.join(source, 'apps/web');
    run(process.execPath, [path.join(web, 'node_modules/vite/bin/vite.js'), 'build', '--mode', 'staging'], web, webEnvironment(sdk, env));
    validateWeb(path.join(web, 'dist'));

    const hosting = readJson(path.join(source, 'firebase.offline-hosting.json')).hosting;
    const config = deploymentConfig(hosting, withRules, withStorageRules);
    const configName = 'firebase.produkce.json';
    writeFileSync(path.join(source, configName), JSON.stringify(config, null, 2));
    const require = createRequire(path.join(source, 'package.json'));
    const cliPackage = require.resolve('firebase-tools/package.json');
    let zip;
    if (withFunctions) {
      run(process.execPath, [tsc, '-p', 'functions/tsconfig.json'], source, env);
      zip = await packageFunctions(source, directory, createRequire(cliPackage));
    }
    const cli = path.join(path.dirname(cliPackage), 'lib/bin/firebase.js');
    return { directory, source, zip, cli, configName, env };
  } catch (error) {
    removeArtifact(directory);
    throw error;
  }
}
