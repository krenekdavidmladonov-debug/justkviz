import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { verifyMain, storageBucketExists, functionSourcePatch, listDeployedFunctions, functionTargets, deployFunctionPlan } from './nasadit.mjs';
import { fastJobs, longJobs, repository } from './ci-proof.mjs';
import { deploymentConfig, prepareFunctionCreation } from './artefakt.mjs';

const head = 'a'.repeat(40);
const origin = 'https://github.com/krenekdavidmladonov-debug/justkviz.git';

function fixture({ branch = 'main', status = '', tracking = head, remote = head, run = {}, gate = {} } = {}) {
  const githubRequests = [];
  return {
    githubRequests,
    git(args) {
      return new Map([
        ['branch --show-current', branch],
        ['status --porcelain=v1 --untracked-files=all --ignore-submodules=none', status],
        ['rev-parse HEAD', head],
        ['rev-parse HEAD^{tree}', 'f'.repeat(40)],
        ['rev-parse refs/remotes/origin/main', tracking],
        ['ls-remote --exit-code origin refs/heads/main', remote + '\trefs/heads/main\n'],
        ['remote get-url origin', origin],
      ]).get(args.join(' '));
    },
    gh(endpoint) {
      githubRequests.push(endpoint);
      if (endpoint.startsWith('actions/workflows/')) {
        return { workflow_runs: [{
          id: 42, run_attempt: 2, head_sha: head, head_branch: 'main', event: 'push',
          status: 'completed', conclusion: 'success', path: '.github/workflows/ci.yml',
          repository: { full_name: repository }, head_repository: { full_name: repository }, ...run,
        }] };
      }
      const jobs = [...fastJobs, ...longJobs, 'Quality gate'].map(name => ({ name, head_sha: head, run_id: 42, run_attempt: 2,
        status: 'completed', conclusion: 'success', ...(name === 'Quality gate' && {
          steps: [{ name: 'Full main suite', status: 'completed', conclusion: 'success' }], ...gate }),
      }));
      return { jobs, total_count: jobs.length };
    },
  };
}

test('odmítne jinou větev i odpojený HEAD před dotazem na CI', () => {
  for (const branch of ['feature', '']) {
    const mock = fixture({ branch });
    assert.throws(() => verifyMain(mock.git, mock.gh), /větev main/u);
    assert.deepEqual(mock.githubRequests, []);
  }
});

test('odmítne změněné i nesledované soubory před dotazem na CI', () => {
  for (const status of [' M README.md', '?? notes.txt']) {
    const mock = fixture({ status });
    assert.throws(() => verifyMain(mock.git, mock.gh), /není čistý/u);
    assert.deepEqual(mock.githubRequests, []);
  }
});

test('odmítne neaktuální lokální tracking i posunutý vzdálený main', () => {
  for (const key of ['tracking', 'remote']) {
    const mock = fixture({ [key]: 'b'.repeat(40) });
    assert.throws(() => verifyMain(mock.git, mock.gh), /se musí shodovat/u);
    assert.deepEqual(mock.githubRequests, []);
  }
});

test('odmítne červené nebo nedokončené CI i úspěch jiného commitu nebo PR', () => {
  for (const run of [{ conclusion: 'failure' }, { status: 'in_progress' }, { head_sha: 'b'.repeat(40) }, { event: 'pull_request' }]) {
    const mock = fixture({ run });
    assert.throws(() => verifyMain(mock.git, mock.gh), /CI pro přesný push/u);
    assert.equal(mock.githubRequests.length, 1);
  }
});

test('odmítne chybějící nebo neúspěšnou Quality gate', () => {
  for (const gate of [{ name: 'Other job' }, { conclusion: 'failure' }, { status: 'queued' }]) {
    const mock = fixture({ gate });
    assert.throws(() => verifyMain(mock.git, mock.gh), /Quality gate/u);
  }
});

test('ověřuje přesný push na main a Quality gate z aktuálního pokusu', () => {
  const mock = fixture();
  assert.equal(verifyMain(mock.git, mock.gh), head);
  assert.deepEqual(mock.githubRequests, [
    'actions/workflows/ci.yml/runs?branch=main&event=push&head_sha=' + head + '&per_page=1',
    'actions/runs/42/attempts/2/jobs?per_page=100',
  ]);
});

test('NASADIT odmítne zelený main, pokud Quality gate nedoloží vykonání plné sady', () => {
  const mock = fixture({ gate: { steps: [] } });
  assert.throws(() => verifyMain(mock.git, mock.gh), /nelze doložit/u);
});

test('povolí jen určený Hosting a výslovně přidané Rules', () => {
  const hosting = { site: 'justkviz-v2', public: 'apps/web/dist', rewrites: [{ source: '**', destination: '/index.html' }] };
  assert.deepEqual(deploymentConfig(hosting, false), { hosting });
  assert.deepEqual(deploymentConfig(hosting, true, false), { hosting, firestore: { database: '(default)', rules: 'firestore.rules' } });
  assert.deepEqual(deploymentConfig(hosting, true, true), {
    hosting,
    firestore: { database: '(default)', rules: 'firestore.rules' },
    storage: [{ bucket: 'filmovy-kviz-v2-staging.firebasestorage.app', rules: 'storage.rules' }],
  });
  assert.throws(() => deploymentConfig({ ...hosting, site: 'filmovy-kviz-v2-staging' }, false), /site/u);
  assert.throws(() => deploymentConfig({ ...hosting, rewrites: [{ source: '**', function: 'health' }] }, false), /statické/u);
});

test('produkční konfigurace omezuje noindex na soukromé a offline trasy', () => {
  const require = createRequire(import.meta.url);
  const requireFirebase = createRequire(require.resolve('firebase-tools/package.json'));
  const { configMatcher } = requireFirebase('superstatic/lib/utils/patterns.js');
  const { hosting } = JSON.parse(readFileSync(new URL('../../firebase.offline-hosting.json', import.meta.url), 'utf8'));
  const config = deploymentConfig(hosting, false);
  function headersFor(url) {
    const pathname = new URL(url, 'https://justkviz.cz').pathname;
    const headers = new Map(config.hosting.headers.filter(rule => configMatcher(pathname, rule))
      .flatMap(rule => rule.headers.map(({ key, value }) => [key.toLowerCase(), value])));
    assert.equal(headers.get('x-content-type-options'), 'nosniff', url);
    assert.equal(headers.get('referrer-policy'), 'strict-origin-when-cross-origin', url);
    return headers;
  }
  for (const url of ['/', '/privacy', '/events', '/events/quiz', '/robots.txt', '/sitemap.xml',
    '/offline.webmanifest', '/offline-sw.js', '/admin-guide', '/events/quiz/registration-info']) {
    assert.equal(headersFor(url).has('x-robots-tag'), false, url);
  }
  for (const url of ['/admin', '/admin/login', '/projector', '/projector/demo', '/referee', '/referee/demo',
    '/account', '/account/', '/invite/demo', '/events/quiz/registration/manage?view=demo', '/offline.html']) {
    assert.equal(headersFor(url).get('x-robots-tag'), 'noindex, nofollow', url);
  }
  assert.equal(headersFor('/offline.html').get('cache-control'), 'no-cache, max-age=0, must-revalidate');
});

test('ověřuje pouze metadata cílového bucketu a při 404 jej vynechá', async () => {
  const bucket = 'filmovy-kviz-v2-staging.firebasestorage.app';
  assert.equal(await storageBucketExists({
    async get(path, options) {
      assert.equal(path, 'b/' + bucket);
      assert.deepEqual(options, { queryParams: { fields: 'name,projectNumber' } });
      return { body: { name: bucket, projectNumber: '177615774316' } };
    },
  }), true);
  assert.equal(await storageBucketExists({
    async get() { throw Object.assign(new Error('Not Found'), { status: 404 }); },
  }), false);
});

test('odmítnutí přístupu a jiný projekt nejsou chybějící bucket', async () => {
  await assert.rejects(storageBucketExists({
    async get() { throw Object.assign(new Error('Forbidden'), { status: 403 }); },
  }), /Forbidden/u);
  await assert.rejects(storageBucketExists({
    async get() { return { body: { name: 'filmovy-kviz-v2-staging.firebasestorage.app', projectNumber: '1' } }; },
  }), /v produkčním projektu/u);
});

test('změna Functions obsahuje pouze jméno a zdroj sestavení', () => {
  const name = 'projects/filmovy-kviz-v2-staging/locations/europe-west1/functions/health';
  const storageSource = { bucket: 'staging-upload', object: 'function.zip', generation: '123' };
  assert.deepEqual(functionSourcePatch(name, storageSource), { name, buildConfig: { source: { storageSource } } });
});

test('function inventory asks for the first page without a pageToken and follows nextPageToken', async () => {
  const calls = [];
  const pages = [
    { functions: [{ name: 'a' }], nextPageToken: 'p2' },
    { functions: [{ name: 'b' }] },
  ];
  const client = { async get(path, options) { calls.push(options.queryParams); return { body: pages[calls.length - 1] }; } };
  const deployed = await listDeployedFunctions(client);
  assert.deepEqual([...deployed.keys()], ['a', 'b']);
  assert.deepEqual(calls, [{ pageSize: 100 }, { pageSize: 100, pageToken: 'p2' }]);
  assert.ok(!('pageToken' in calls[0]));
});

const functionLocation = 'projects/filmovy-kviz-v2-staging/locations/europe-west1/functions/';
function activeFunction(entryPoint, overrides = {}) {
  return { name: functionLocation + entryPoint, environment: 'GEN_2', state: 'ACTIVE',
    buildConfig: { runtime: 'nodejs22', entryPoint }, updateTime: '2026-11-17T10:00:00Z', ...overrides };
}

test('čtecí náhled rozliší existující, chybějící a přebytečné Functions i přes stránky', async () => {
  const calls = [];
  const pages = [
    { functions: [activeFunction('health')], nextPageToken: 'second' },
    { functions: [activeFunction('legacyOnly')] },
  ];
  const client = { async get(url, options) {
    calls.push({ url, options });
    return { body: pages[calls.length - 1] };
  } };
  const plan = await functionTargets(client, ['authorizeLocalImageBackup', 'health']);
  assert.deepEqual(plan, {
    existing: [{ name: functionLocation + 'health', entryPoint: 'health', updateTime: '2026-11-17T10:00:00Z' }],
    missing: ['authorizeLocalImageBackup'],
    extra: ['legacyOnly'],
    special: [],
  });
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.url === functionLocation.slice(0, -1)));
});

test('prázdný inventář znamená nové funkce; neúplné API není prázdný inventář', async () => {
  assert.deepEqual(await functionTargets({ async get() { return { body: {} }; } }, ['health']),
    { existing: [], missing: ['health'], extra: [], special: [] });
  await assert.rejects(functionTargets({ async get() {
    return { body: { unreachable: ['europe-west1'] } };
  } }, ['health']), /není úplný/u);
});

test('existující neaktivní, Gen 1 nebo jinak nastavená funkce se nevydává za chybějící', async () => {
  for (const overrides of [
    { environment: 'GEN_1' }, { state: 'DEPLOYING' }, { updateTime: undefined },
    { buildConfig: { runtime: 'nodejs20', entryPoint: 'health' } },
    { buildConfig: { runtime: 'nodejs22', entryPoint: 'other' } },
  ]) {
    await assert.rejects(functionTargets({ async get() {
      return { body: { functions: [activeFunction('health', overrides)] } };
    } }, ['health']), /Nelze bezpečně aktualizovat/u);
  }
});

test('další čtecí náhled odhalí vytvoření funkce jiným nasazením před zápisem', async () => {
  let created = false;
  const client = { async get() {
    return { body: { functions: created ? [activeFunction('health')] : [] } };
  } };
  const preview = await functionTargets(client, ['health']);
  created = true;
  assert.notDeepEqual(await functionTargets(client, ['health']), preview);
});

test('nejprve vytvoří pouze chybějící ze stejného artefaktu, potom aktualizuje existující', async () => {
  const calls = [];
  const artifact = { zip: 'same-artifact/functions.zip' };
  const plan = { existing: [{ entryPoint: 'health' }],
    missing: ['authorizeLocalImageBackup', 'readLocalImageManifest'], extra: ['legacyOnly'] };
  await deployFunctionPlan(plan, artifact, {
    prepare(value) { assert.equal(value, artifact); calls.push('prepare'); },
    deploy(only) { calls.push(only); },
    update(targets, zip) {
      assert.equal(targets, plan.existing);
      assert.equal(zip, artifact.zip);
      calls.push('update');
    },
  });
  assert.deepEqual(calls, [
    'prepare', 'functions:authorizeLocalImageBackup,functions:readLocalImageManifest', 'update',
  ]);
  assert.ok(calls.every(call => !call.includes('legacyOnly') && !call.includes('--force')));
});

test('při chybě přípravy nebo vytváření se aktualizace a následující kroky nespustí', async () => {
  for (const failure of ['prepare', 'create', 'update']) {
    const calls = [];
    const step = name => {
      calls.push(name);
      if (failure === name) throw new Error(name + ' failed');
    };
    await assert.rejects(async () => {
      await deployFunctionPlan({ missing: ['newFunction'], existing: [{ entryPoint: 'health' }], extra: [] }, {}, {
        prepare() { step('prepare'); },
        deploy() { step('create'); },
        update() { step('update'); },
      });
      step('hosting');
    }, new RegExp(failure + ' failed', 'u'));
    assert.deepEqual(calls, ['prepare', 'create', 'update'].slice(0,
      ['prepare', 'create', 'update'].indexOf(failure) + 1));
  }
});

test('bez chybějících nevytváří a bez existujících neaktualizuje ani nenahrává další ZIP', async () => {
  for (const missing of [[], ['newFunction']]) {
    const calls = [];
    await deployFunctionPlan({ missing, existing: [], extra: ['legacyOnly'] }, {}, {
      prepare() { calls.push('prepare'); },
      deploy(only) { calls.push(only); },
      update() { assert.fail('Žádná existující funkce nesmí být aktualizována.'); },
    });
    assert.deepEqual(calls, missing.length ? ['prepare', 'functions:newFunction'] : []);
  }
  const calls = [];
  await deployFunctionPlan({ missing: [], existing: [{ entryPoint: 'health' }], extra: [] }, {}, {
    prepare() { assert.fail('Není co vytvářet.'); },
    deploy() { assert.fail('Není co vytvářet.'); },
    update() { calls.push('update'); },
  });
  assert.deepEqual(calls, ['update']);
});

test('CLI vytváření používá již sestavený balíček D1 a zamčené závislosti bez rebuildů', context => {
  const directory = mkdtempSync(path.join(tmpdir(), 'justkviz-d1-creation-test-'));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'source');
  mkdirSync(source);
  const configName = 'firebase.produkce.json';
  const configPath = path.join(source, configName);
  const hosting = { site: 'justkviz-v2' };
  writeFileSync(configPath, JSON.stringify({ hosting }));
  const artifact = { directory, source, configName, env: { SYNTHETIC: 'true' } };
  const calls = [];
  prepareFunctionCreation(artifact, (...args) => calls.push(args));
  assert.deepEqual(calls, [[process.execPath, [
    path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund',
  ], path.join(directory, 'functions'), artifact.env]]);
  assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), {
    hosting, functions: { source: path.join(directory, 'functions'), codebase: 'default', runtime: 'nodejs22' },
  });
});
test('funkce s vlastním sestavením (GOOGLE_NODE_RUN_SCRIPTS) se neaktualizují obecným artefaktem', async () => {
  const worker = activeFunction('beginQuizMediaUpload');
  worker.buildConfig = { ...worker.buildConfig, environmentVariables: { GOOGLE_NODE_RUN_SCRIPTS: 'gcp-build' } };
  const plain = activeFunction('health');
  plain.buildConfig = { ...plain.buildConfig, environmentVariables: { GOOGLE_NODE_RUN_SCRIPTS: '' } };
  const plan = await functionTargets({ async get() { return { body: { functions: [worker, plain] } }; } }, ['beginQuizMediaUpload', 'health']);
  assert.deepEqual(plan.special, ['beginQuizMediaUpload']);
  assert.deepEqual(plan.existing.map(target => target.entryPoint), ['health']);
  assert.deepEqual(plan.missing, []);
});

test('nevytvořené nové funkce zastaví nasazení před aktualizací a webem', async () => {
  const steps = [];
  await assert.rejects(deployFunctionPlan({ missing: ['newOne'], existing: [{ entryPoint: 'health' }] }, {}, {
    prepare: async () => steps.push('prepare'),
    deploy: async () => steps.push('deploy'),
    verifyCreated: async () => { throw new Error('Nové Functions nevznikly'); },
    update: async () => steps.push('update'),
  }), /nevznikly/u);
  assert.deepEqual(steps, ['prepare', 'deploy']);
});

test('podřízené procesy D1 mají Node z .tools v PATH', async () => {
  const { childEnv } = await import('./artefakt.mjs');
  const env = childEnv({ Path: 'C:\\Windows', NODE_OPTIONS: 'x', VITE_X: '1' }, 'C:\\Projects\\justkviz\\.tools\\node22');
  const key = Object.keys(env).find(name => name.toUpperCase() === 'PATH');
  assert.equal(key, 'Path');
  assert.ok(env.Path.startsWith('C:\\Projects\\justkviz\\.tools\\node22'));
  assert.ok(env.Path.endsWith('C:\\Windows'));
  assert.ok(!('NODE_OPTIONS' in env) && !('VITE_X' in env));
});
