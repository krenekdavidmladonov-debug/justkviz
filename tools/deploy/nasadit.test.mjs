import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { verifyMain, storageBucketExists, functionSourcePatch } from './nasadit.mjs';
import { deploymentConfig, eventPreviewRewrite } from './artefakt.mjs';
import { assertEventPreviewAbsent, createEventPreview, eventPreviewRollbackRecord, verifyEventPreviewForHosting } from './event-preview-create.mjs';

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
  const preview = { ...hosting, rewrites: [eventPreviewRewrite, ...hosting.rewrites] };
  assert.deepEqual(deploymentConfig(preview, false), { hosting: preview });
  for (const rewrites of [
    [{ source: '**', function: 'health' }],
    [{ ...eventPreviewRewrite, regex: '^/events/.*$' }, ...hosting.rewrites],
    [{ ...eventPreviewRewrite, function: { ...eventPreviewRewrite.function, pinTag: true } }, ...hosting.rewrites],
    [...hosting.rewrites, eventPreviewRewrite],
  ]) assert.throws(() => deploymentConfig({ ...hosting, rewrites }, false), /rewrites/u);
});

test('Hosting rewrite vyžaduje aktivní veřejnou funkci náhledu', async () => {
  const hosting = { rewrites: [eventPreviewRewrite] };
  const { functions, run, active } = eventPreviewFixture();
  await verifyEventPreviewForHosting({}, {}, { rewrites: [{ source: '**', destination: '/index.html' }] });
  await assert.rejects(verifyEventPreviewForHosting(functions, run, hosting), /první vytvoření/u);
  const present = { get: async () => ({ body: active }) };
  await assert.rejects(verifyEventPreviewForHosting(present, run, hosting), /veřejné oprávnění/u);
  await verifyEventPreviewForHosting(present, { get: async () => ({ body: { bindings: [{ role: 'roles/run.invoker', members: ['allUsers'] }] } }) }, hosting);
  await assert.rejects(verifyEventPreviewForHosting({ get: async () => ({ body: { ...active, state: 'FAILED' } }) }, run, hosting), /HTTPS konfiguraci/u);
});

const previewLocation = 'projects/filmovy-kviz-v2-staging/locations/europe-west1';
const previewName = previewLocation + '/functions/servePublicEventMeta';
const previewService = previewLocation + '/services/servepubliceventmeta';

function notFound() { return Object.assign(new Error('Missing'), { status: 404 }); }

function eventPreviewFixture() {
  const operation = previewLocation + '/operations/create-preview';
  const id = '12345678-1234-1234-1234-1234567890ab';
  const active = {
    name: previewName, environment: 'GEN_2', state: 'ACTIVE', updateTime: '2026-11-17T12:00:00Z',
    buildConfig: { runtime: 'nodejs22', entryPoint: 'servePublicEventMeta' },
    serviceConfig: { service: previewService, serviceAccountEmail: '177615774316-compute@developer.gserviceaccount.com' },
    labels: { 'justkviz-source': head, 'justkviz-first-create': id },
  };
  const iam = { etag: 'original-etag', version: 3, bindings: [
    { role: 'roles/run.viewer', members: ['user:demo@example.test'] },
    { role: 'roles/run.invoker', members: ['user:demo@example.test'] },
  ] };
  const calls = [], states = [];
  let created = false;
  const functions = {
    async get(name) {
      assert.equal(name, previewName);
      if (!created) throw notFound();
      return { body: active };
    },
    async post(resource, body, options) {
      calls.push({ resource, body, options });
      assert.equal(resource, previewLocation + '/functions');
      assert.equal(body.name, previewName);
      assert.deepEqual(options.queryParams, { functionId: 'servePublicEventMeta' });
      created = true;
      return { body: { name: operation } };
    },
  };
  const run = {
    async get(resource) {
      if (resource === previewService) throw notFound();
      assert.equal(resource, previewService + ':getIamPolicy');
      return { body: iam };
    },
    async post(resource, body) {
      assert.equal(resource, previewService + ':setIamPolicy');
      calls.push({ resource, body });
      return { body: body.policy };
    },
  };
  const input = {
    functions, run, head, storageSource: { bucket: 'source', object: 'artifact' },
    record: { id, update: patch => states.push(patch) },
    waitForOperation: async name => assert.equal(name, operation),
  };
  return { input, functions, run, active, calls, states };
}

test('první vytvoření používá POST jediného ID a omezenou změnu IAM s etagem', async () => {
  const { input, calls, states } = eventPreviewFixture();
  await createEventPreview(input);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].body.buildConfig.source, { storageSource: input.storageSource });
  assert.equal(calls[0].body.serviceConfig.maxInstanceCount, 3);
  assert.equal(calls[0].body.serviceConfig.timeoutSeconds, 10);
  assert.equal(calls[0].body.serviceConfig.serviceAccountEmail, '177615774316-compute@developer.gserviceaccount.com');
  assert.deepEqual(calls[1].body, { updateMask: 'bindings,etag', policy: {
    etag: 'original-etag', version: 3, bindings: [
      { role: 'roles/run.viewer', members: ['user:demo@example.test'] },
      { role: 'roles/run.invoker', members: ['user:demo@example.test', 'allUsers'] },
    ],
  } });
  assert.deepEqual(states.map(state => state.state ?? 'operation'), ['creating', 'operation', 'created', 'ready']);
});

test('první vytvoření se zastaví při existujícím prostředku, chybě oprávnění a souběhu', async () => {
  const { input, functions, run, calls, states } = eventPreviewFixture();
  await assert.rejects(assertEventPreviewAbsent({ get: async () => ({ body: {} }) }, run), /nepřítomný/u);
  await assert.rejects(assertEventPreviewAbsent(functions, { get: async () => ({ body: {} }) }), /nepřítomný/u);
  await assert.rejects(assertEventPreviewAbsent({ async get() { throw Object.assign(new Error('Denied'), { status: 403 }); } }, run), /Denied/u);
  await assert.rejects(createEventPreview({ ...input, waitForOperation: async () => { throw new Error('ALREADY_EXISTS'); } }), /ALREADY_EXISTS/u);
  assert.equal(calls.length, 1);
  assert.deepEqual(states.map(state => state.state ?? 'operation'), ['creating', 'operation']);
});

test('při neshodě vytvořeného endpointu či chybějícím etagu se IAM nemění', async () => {
  const mismatch = eventPreviewFixture();
  mismatch.active.labels['justkviz-first-create'] = 'different';
  await assert.rejects(createEventPreview(mismatch.input), /neodpovídá/u);
  assert.equal(mismatch.calls.length, 1);
  const noEtag = eventPreviewFixture();
  const original = noEtag.run.get;
  noEtag.run.get = async name => name === previewService ? original(name) : ({ body: {} });
  await assert.rejects(createEventPreview(noEtag.input), /etag/u);
  assert.equal(noEtag.calls.length, 1);
  assert.equal(noEtag.states.at(-1).state, 'created');
});

test('záznam pro rollback uchová výchozí Hosting před vytvořením i výsledek', t => {
  const prefix = path.join(realpathSync(tmpdir()), 'justkviz-preview-record-');
  const root = mkdtempSync(prefix);
  t.after(() => {
    assert.equal(realpathSync(root), root);
    assert(root.startsWith(prefix));
    rmSync(root, { recursive: true, force: true });
  });
  const prior = { id: 'release-before', version: 'version-before' };
  const previous = 'b'.repeat(40);
  const record = eventPreviewRollbackRecord(root, head, prior, previous);
  const read = () => JSON.parse(readFileSync(record.filename, 'utf8'));
  assert.equal(read().state, 'prepared');
  assert.equal(read().functionBefore, null);
  assert.equal(read().hostingRollback, 'NASADIT.cmd --rollback release-before ' + previous);
  record.update({ state: 'creating', operation: 'op' });
  record.update({ state: 'ready', functionAfter: { name: previewName } });
  assert.deepEqual(read().hostingBefore, { ...prior, commit: previous });
  assert.equal(read().sourceCommit, head);
  assert.equal(read().operation, 'op');
  assert.deepEqual(read().functionAfter, { name: previewName });
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
  assert.equal(headersFor('/events/quiz').has('cache-control'), false);
  for (const url of ['/events', '/events/quiz/', '/events/quiz/registration/manage']) {
    assert.equal(configMatcher(url, config.hosting.rewrites[0]), false, url);
    assert.equal(headersFor(url).get('cache-control'), 'no-cache, max-age=0, must-revalidate', url);
  }
  for (const url of ['/events/quiz', '\\events\\quiz']) {
    assert.deepEqual(config.hosting.rewrites.find(rule => configMatcher(url, rule)), eventPreviewRewrite, url);
  }
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
