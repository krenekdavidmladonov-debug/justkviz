import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { verifyMain, storageBucketExists, functionSourcePatch } from './nasadit.mjs';
import { deploymentConfig } from './artefakt.mjs';

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
          status: 'completed', conclusion: 'success', ...run,
        }] };
      }
      return { jobs: [{ name: 'Quality gate', status: 'completed', conclusion: 'success', ...gate }] };
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
