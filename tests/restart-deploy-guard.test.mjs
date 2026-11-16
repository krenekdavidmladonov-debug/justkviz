import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
const require = createRequire(import.meta.url);
const policy = require('../tools/staging/restart-deploy-policy.cjs');
const cli = name => require('firebase-tools/lib/' + name);
const actualBackend = cli('deploy/functions/backend');
const actualBuild = cli('deploy/functions/build');
const actualPlanner = cli('deploy/functions/release/planner');
const actualHelpers = cli('deploy/functions/functionsDeployHelper');
const actualGcf = cli('gcp/cloudfunctionsv2');
const actualProjectConfig = cli('functions/projectConfig');
const actualDiscovery = cli('deploy/functions/runtimes/discovery/v1alpha1');
const actualExtensionsPrepare = cli('deploy/extensions/prepare');
const actualStorage = cli('gcp/storage');
const actualExperiments = cli('experiments');
const ActualFabricator = cli('deploy/functions/release/fabricator').Fabricator;
const ActualClient = cli('apiv2').Client;
const names = JSON.parse(readFileSync(new URL('../tools/staging/restart-release-manifest.json', import.meta.url))).functions;
const makeEndpoint = id => ({ id, project: policy.PROJECT, region: policy.REGION, entryPoint: id, runtime: 'nodejs22', platform: 'gcfv2', codebase: 'default', targetedByOnly: true, ...(id === 'readQuizMedia' || id === 'generatePrintArtifact' ? { httpsTrigger: {} } : { callableTrigger: {} }) });
const makeArgs = () => ({ projectId: policy.PROJECT, codebase: 'default', filters: actualHelpers.getEndpointFilters({ only: names.map(n => 'functions:' + n).join(',') }, [{ source: 'functions', codebase: 'default' }]),
  wantBackend: actualBackend.of(...names.map(makeEndpoint)),
  haveBackend: actualBackend.of(...[...names, 'health'].map(id => ({ ...makeEndpoint(id), state: 'ACTIVE', serviceAccount: `${policy.NUMBER}-compute@developer.gserviceaccount.com` }))) });
const state = () => ({ backendVerified: true, planVerified: true, applyVerified: true, uploadUrls: new Set(), storageSource: { bucket: 'synthetic-managed-upload', object: 'source.zip' } });
const client = new ActualClient({ urlPrefix: 'https://cloudfunctions.googleapis.com', apiVersion: 'v2' });
const patch = s => ({ method: 'PATCH', path: `projects/${policy.PROJECT}/locations/${policy.REGION}/functions/updateEventRegistration`, body: actualGcf.functionFromEndpoint({ ...makeEndpoint('updateEventRegistration'), source: { storageSource: structuredClone(s.storageSource) } }) });

test('pinned CLI real planner produces exactly 70 existing safe updates and excludes health', async () => {
  assert.equal(require('firebase-tools/package.json').version, '15.34.2');
  const args = makeArgs(), plan = await actualPlanner.createDeploymentPlan(args);
  policy.plan(plan, names, actualBackend.allEndpoints);
  const updates = Object.values(plan.regionalChangesets).flatMap(c => c.endpointsToUpdate);
  assert.equal(updates.length, 70); assert(!updates.some(u => u.endpoint.id === 'health'));
});

test('real planner creations, deletes, hash skips and recreation are rejected', async () => {
  for (const kind of ['missing', 'extra', 'skip']) {
    const args = makeArgs();
    if (kind === 'missing') delete args.haveBackend.endpoints[policy.REGION][names[0]];
    if (kind === 'extra') args.haveBackend.endpoints[policy.REGION]['updateEventRegistration-extra'] = { ...makeEndpoint('updateEventRegistration-extra'), labels: { 'deployment-tool': 'cli-firebase' } };
    if (kind === 'skip') { args.wantBackend.endpoints[policy.REGION][names[0]].targetedByOnly = false; args.wantBackend.endpoints[policy.REGION][names[0]].hash = args.haveBackend.endpoints[policy.REGION][names[0]].hash = 'equal'; }
    const plan = await actualPlanner.createDeploymentPlan(args);
    assert.throws(() => policy.plan(plan, names, actualBackend.allEndpoints), kind);
  }
  const plan = await actualPlanner.createDeploymentPlan(makeArgs());
  Object.values(plan.regionalChangesets)[0].endpointsToUpdate[0].deleteAndRecreate = {};
  assert.throws(() => policy.plan(plan, names, actualBackend.allEndpoints));
});

test('raw discovery and resolved policies reject source/config/secret/identity deviations', () => {
  const raw = { params: [], endpoints: Object.fromEntries(names.map(id => [id, { ...makeEndpoint(id), region: [policy.REGION] }])) };
  policy.rawBuild(raw, names);
  for (const change of [r => r.params.push({ type: 'secret', name: 'synthetic-secret' }), r => r.endpoints[names[0]].region = ['us-central1'], r => r.endpoints[names[0]].serviceAccount = 'foreign@example.test', r => r.lifecycleHooks = { before: 'arbitrary' }, r => r.requiredRoles = ['roles/owner'], r => r.endpoints[names[0]].secretEnvironmentVariables = [{}], r => r.endpoints[names[0]].scheduleTrigger = {}, r => r.endpoints[names[0]].entryPoint = 'health']) {
    const altered = structuredClone(raw); change(altered); assert.throws(() => policy.rawBuild(altered, names));
  }
});

test('actual apiv2 API version/query shape permits only the fixed source and authorized PATCH', () => {
  const s = state(), req = patch(s);
  assert.equal(policy.requestUrl(client, req).href, client.requestURL({ ...req, path: '/' + req.path }));
  assert.equal(policy.requestPolicy(client, req, s, names).kind, 'function-update');
  const signed = new URL('https://storage.googleapis.com/synthetic-managed-upload/source.zip?GoogleAccessId=synthetic&Signature=abc%2Fxyz');
  s.uploadUrls.add(signed.href);
  const storageClient = new ActualClient({ urlPrefix: signed.origin, auth: false });
  assert.equal(policy.requestPolicy(storageClient, { method: 'PUT', path: signed.pathname, queryParams: signed.searchParams }, s, names).kind, 'source-upload');
  assert.throws(() => policy.requestPolicy(storageClient, { method: 'PUT', path: signed.pathname, queryParams: { Signature: 'different' } }, s, names));
  assert.throws(() => policy.requestPolicy(storageClient, { method: 'PUT', path: '/synthetic-managed-upload/other.zip', queryParams: signed.searchParams }, s, names));
});

test('request policy denies infrastructure, foreign project, create/delete, health/email and mismatched source/body', () => {
  const s = state();
  for (const req of [
    { method: 'POST', path: `projects/${policy.PROJECT}/locations/${policy.REGION}/functions`, queryParams: { functionId: names[0] } },
    { method: 'DELETE', path: `projects/${policy.PROJECT}/locations/${policy.REGION}/functions/${names[0]}` },
    { ...patch(s), path: `projects/foreign/locations/${policy.REGION}/functions/updateEventRegistration` },
    { ...patch(s), path: `projects/${policy.PROJECT}/locations/${policy.REGION}/functions/health` },
    { ...patch(s), path: `projects/${policy.PROJECT}/locations/${policy.REGION}/functions/deliverEmailTask` },
    { method: 'POST', path: `projects/${policy.PROJECT}:setIamPolicy` },
    { method: 'GET', path: `projects/${policy.PROJECT}:generateServiceIdentity` },
  ]) assert.throws(() => policy.requestPolicy(client, req, s, names));
  for (const modify of [r => r.body.name = 'foreign', r => r.body.buildConfig.source.storageSource.object = 'other.zip', r => r.body.serviceConfig.secretEnvironmentVariables = [{}], r => r.body.serviceConfig.serviceAccountEmail = 'foreign@example.test', r => r.body.serviceConfig.invokerIamDisabled = true, r => r.body.buildConfig.workerPool = 'foreign', r => r.body.eventTrigger = {}]) {
    const req = patch(s); modify(req); assert.throws(() => policy.requestPolicy(client, req, s, names));
  }
  assert.throws(() => policy.requestPolicy(client, patch(s), { ...s, planVerified: false }, names));
  for (const host of ['serviceusage.googleapis.com', 'run.googleapis.com', 'artifactregistry.googleapis.com', 'identitytoolkit.googleapis.com']) {
    const c = new ActualClient({ urlPrefix: 'https://' + host, apiVersion: 'v1' });
    assert.throws(() => policy.requestPolicy(c, { method: 'PATCH', path: `projects/${policy.PROJECT}/config` }, s, names));
  }
});

test('read transport rejects foreign project and bucket/content paths without blocking fixed metadata', () => {
  const s = state();
  for (const host of ['cloudfunctions.googleapis.com', 'serviceusage.googleapis.com', 'run.googleapis.com', 'firebase.googleapis.com', 'cloudresourcemanager.googleapis.com']) {
    const c = new ActualClient({ urlPrefix: 'https://' + host, apiVersion: 'v1' });
    assert.equal(policy.requestPolicy(c, { path: `projects/${policy.PROJECT}/metadata` }, s, names).kind, 'read');
    for (const project of ['production', '999999', '%66oreign']) assert.throws(() => policy.requestPolicy(c, { path: `projects/${project}/metadata` }, s, names));
  }
  const storage = new ActualClient({ urlPrefix: 'https://storage.googleapis.com', apiVersion: 'storage/v1' });
  assert.equal(policy.requestPolicy(storage, { path: `b/${policy.PROJECT}.firebasestorage.app` }, s, names).kind, 'read');
  for (const path of ['b/foreign', `b/${policy.PROJECT}.firebasestorage.app/o`, `b/${policy.PROJECT}.firebasestorage.app/o/private`]) assert.throws(() => policy.requestPolicy(storage, { path }, s, names));
});

test('evidence policy binds reviewed release/receipt/target and fresh actual paused control metadata', () => {
  const envelope = { schemaVersion: 1, mode: 'APPROVED_RESTART_FUNCTIONS_UPDATE', projectId: policy.PROJECT, region: policy.REGION, releaseSha: policy.RELEASE_SHA, receiptSha256: policy.RECEIPT_SHA256, approvalReference: 'synthetic-only', ci: {}, preflight: {}, pause: {} };
  policy.evidenceEnvelope(envelope);
  for (const alter of [e => e.releaseSha = 'a'.repeat(40), e => e.receiptSha256 = 'a'.repeat(64), e => e.projectId = 'foreign', e => e.region = 'us-central1', e => e.approvalReference = '', e => e.force = true]) { const copy = structuredClone(envelope); alter(copy); assert.throws(() => policy.evidenceEnvelope(copy)); }
  const now = Date.parse('2026-10-12T12:00:00Z'), expectedRevision = 18;
  const preflight = { mode: 'RESTART_PREFLIGHT_VERIFIED', releaseSha: policy.RELEASE_SHA, projectId: policy.PROJECT, region: policy.REGION, observedAt: '2026-10-12T11:59:00Z', accessControl: { collaborationEnabled: false, revision: 19, updateTime: '2026-10-12T10:00:00Z' }, functions: [...names, 'health'].map(name => ({ name, state: 'ACTIVE', platform: 'gcfv2', region: policy.REGION, serviceAccount: `${policy.NUMBER}-compute@developer.gserviceaccount.com` })), checks: Object.fromEntries(['apisAlreadyEnabled', 'storageRulesMatch', 'indexesReadyMatch', 'runtimeConfigMatches', 'noEmailEndpoints', 'failuresResolved'].map(n => [n, true])) };
  policy.freshPreflight(preflight, names, expectedRevision, preflight.accessControl.updateTime, now);
  for (const alter of [p => p.observedAt = '2026-10-12T11:00:00Z', p => p.observedAt = '2026-10-12T12:01:00Z', p => p.accessControl.collaborationEnabled = true, p => p.accessControl.revision = 18, p => p.accessControl.updateTime = 'invalid', p => p.accessControl.updateTime = '2026-10-12T10:00:01Z', p => p.functions.pop(), p => p.functions[0].name = 'deliverEmailTask', p => p.functions[0].serviceAccount = 'foreign', p => p.checks.failuresResolved = false, p => p.releaseSha = 'a'.repeat(40)]) { const copy = structuredClone(preflight); alter(copy); assert.throws(() => policy.freshPreflight(copy, names, expectedRevision, preflight.accessControl.updateTime, now)); }
});

function harness(uploadUrl = 'https://storage.googleapis.com/synthetic-managed-upload/source.zip?GoogleAccessId=synthetic&Signature=abc%2Fxyz', realFabricator = false) {
  const writes = [], logs = [], order = [], modules = {};
  class MockClient extends ActualClient { async request(req) { writes.push(req); order.push(req.method); return { body: req.method === 'PATCH' ? { name: `projects/${policy.PROJECT}/locations/${policy.REGION}/operations/` + req.path.split('/').at(-1) } : {}, response: { headers: { get: () => 'synthetic-generation' } } }; } }
  const upload = { uploadUrl, storageSource: { bucket: 'synthetic-managed-upload', object: 'source.zip' } };
  class Fabricator {
    constructor() { this.projectId = policy.PROJECT; this.projectNumber = policy.NUMBER; }
    async applyPlan() { order.push('apply'); return { ok: true }; }
    async updateV2Function(e) { return new MockClient({ urlPrefix: 'https://cloudfunctions.googleapis.com', apiVersion: 'v2' }).request({ method: 'PATCH', path: `projects/${policy.PROJECT}/locations/${policy.REGION}/functions/${e.id}`, body: actualGcf.functionFromEndpoint({ ...e, source: { storageSource: upload.storageSource } }) }); }
    createV2Function() { throw Error('unwrapped create'); }
    deleteV2Function() { throw Error('unwrapped delete'); }
  }
  Object.assign(modules, {
    experiments: { isEnabled: actualExperiments.isEnabled },
    requireAuth: { requireAuth: async (options, skipAutoAuth) => { assert.equal(skipAutoAuth, true); return options.user?.email ?? null; } },
    'functions/projectConfig': { shouldUseRuntimeConfig: actualProjectConfig.shouldUseRuntimeConfig },
    'deploy/functions/prepareFunctionsUpload': { getFunctionsConfig: () => { throw Error('unwrapped legacy config read'); } },
    apiv2: { Client: MockClient }, 'deploy/functions/backend': actualBackend,
    'deploy/functions/build': { resolveBackend: async opts => ({ backend: actualBuild.toBackend(opts.build, {}) }) },
    'gcp/serviceusage': { generateServiceIdentity: () => { throw Error('unwrapped identity'); } },
    ensureApiEnabled: { check: async () => true },
    'deploy/functions/release/planner': { createDeploymentPlan: actualPlanner.createDeploymentPlan },
    'deploy/functions/deploy': { deploy: async () => { order.push('upload'); return modules['gcp/cloudfunctionsv2'].generateUploadUrl(policy.PROJECT, policy.REGION); } },
    'deploy/functions/release/fabricator': { Fabricator: realFabricator ? ActualFabricator : Fabricator },
    'gcp/run': {}, 'functions/artifacts': {},
    'gcp/cloudfunctionsv2': { generateUploadUrl: async () => { await new MockClient({ urlPrefix: 'https://cloudfunctions.googleapis.com', apiVersion: 'v2' }).post(`projects/${policy.PROJECT}/locations/${policy.REGION}/functions:generateUploadUrl`); return upload; } },
  });
  const state = policy.install({ cli: n => { assert(modules[n], n); return modules[n]; }, names, operatorEmail: 'operator@example.test', checkArtifact: () => order.push('hash'), log: (event, fields) => { logs.push({ event, fields }); order.push(event); } });
  return { modules, writes, logs, order, state, Fabricator: modules['deploy/functions/release/fabricator'].Fabricator, MockClient };
}
async function discover(h) {
  return h.modules['deploy/functions/build'].resolveBackend({ codebase: 'default', force: false, isEmulator: false, build: { params: [], requiredAPIs: [], endpoints: Object.fromEntries(names.map(id => [id, { ...makeEndpoint(id), region: [policy.REGION] }])) } });
}
test('hooked actual planner is checked before any upload, and mutated apply plans fail', async () => {
  const h = harness(); await discover(h);
  const args = makeArgs();
  await h.modules['deploy/functions/deploy'].deploy({ projectId: policy.PROJECT, filters: args.filters }, { projectNumber: policy.NUMBER }, { functions: { default: args } });
  assert(h.order.indexOf('verified-update-only-plan') < h.order.indexOf('upload'));
  assert.equal(h.writes.length, 1); assert(h.state.planVerified);
  const plan = await h.modules['deploy/functions/release/planner'].createDeploymentPlan(args);
  await new h.Fabricator().applyPlan({ default: plan });
  await new h.Fabricator().updateV2Function(makeEndpoint('updateEventRegistration'));
  assert.equal(h.writes.length, 2);
  Object.values(plan.regionalChangesets)[0].endpointsToUpdate.pop();
  await assert.rejects(new h.Fabricator().applyPlan({ default: plan }));
});
test('real storage upload serializes the entire signed capability exactly, preserving encoded values and duplicate pairs', async () => {
  const original = new URL('https://storage.googleapis.com/synthetic-managed-upload/source.zip?GoogleAccessId=synthetic%40example.test&Signature=~%2B+%20%2F%3D%40&duplicate=first&duplicate=second');
  const expected = new URL(original); expected.search = expected.searchParams.toString();
  assert.notEqual(expected.href, original.href);
  assert.deepEqual([...expected.searchParams], [...original.searchParams]);
  const h = harness(original.href); await discover(h); const args = makeArgs();
  const issued = await h.modules['deploy/functions/deploy'].deploy({ projectId: policy.PROJECT, filters: args.filters }, { projectNumber: policy.NUMBER }, { functions: { default: args } });
  assert.deepEqual([...h.state.uploadUrls], [expected.href]);
  assert.equal(issued.uploadUrl, original.href);
  const actualApi = cli('apiv2'), savedClient = actualApi.Client;
  try {
    // The real gcp/storage.upload creates this client; only transport is mocked.
    actualApi.Client = h.MockClient;
    assert.deepEqual(await actualStorage.upload({ file: 'synthetic.zip', stream: 'synthetic-stream' }, issued.uploadUrl, undefined, true), { generation: 'synthetic-generation' });
    const put = h.writes.at(-1);
    assert.equal(put.method, 'PUT'); assert(put.queryParams instanceof URLSearchParams);
    assert.deepEqual([...put.queryParams], [...original.searchParams]);
    assert.equal(policy.requestUrl(new h.MockClient({ urlPrefix: original.origin }), put).href, expected.href);
    const allowedRequests = h.writes.length;
    for (const alter of [url => url.searchParams.set('Signature', 'different'), url => url.searchParams.set('GoogleAccessId', 'different'), url => url.searchParams.append('extra', 'value'), url => url.searchParams.delete('duplicate'), url => url.searchParams.set('duplicate', 'changed'), url => url.pathname = '/synthetic-managed-upload/other.zip', url => url.hostname = 'foreign.example.test']) {
      const changed = new URL(original); alter(changed);
      await assert.rejects(actualStorage.upload({ file: 'synthetic.zip', stream: 'synthetic-stream' }, changed.href, undefined, true));
      assert.equal(h.writes.length, allowedRequests);
    }
  } finally { actualApi.Client = savedClient; }
});
test('real Fabricator applies all 70 updates through real GCF conversion and guarded transport without source-token reuse or IAM writes', async () => {
  assert.equal(actualExperiments.ALL_EXPERIMENTS.functionsv2deployoptimizations.default, true);
  const proto = ActualFabricator.prototype, descriptors = Object.getOwnPropertyDescriptors(proto);
  const savedRequest = ActualClient.prototype.request, savedExperiment = actualExperiments.isEnabled;
  const poller = cli('operation-poller'), savedPoll = poller.pollOperation;
  const scraper = cli('deploy/functions/release/sourceTokenScraper').SourceTokenScraper;
  const savedGetToken = scraper.prototype.getToken;
  const run = cli('gcp/run'), savedInvoker = run.setInvokerUpdate;
  const logger = cli('logger').logger, savedErrorLog = logger.error;
  let sourceTokenReads = 0, polls = 0, iamWrites = 0;
  try {
    proto.logOpStart = proto.logOpSuccess = () => {};
    const h = harness(undefined, true); await discover(h); const args = makeArgs();
    await h.modules['deploy/functions/deploy'].deploy({ projectId: policy.PROJECT, filters: args.filters }, { projectNumber: policy.NUMBER }, { functions: { default: args } });
    ActualClient.prototype.request = h.MockClient.prototype.request;
    actualExperiments.isEnabled = h.modules.experiments.isEnabled;
    for (const name of Object.keys(actualExperiments.ALL_EXPERIMENTS).filter(n => n !== 'functionsv2deployoptimizations')) assert.equal(actualExperiments.isEnabled(name), savedExperiment(name));
    scraper.prototype.getToken = async () => { sourceTokenReads++; throw Error('Build reuse must remain disabled'); };
    run.setInvokerUpdate = () => { iamWrites++; throw Error('IAM write forbidden'); };
    poller.pollOperation = async opts => {
      assert(opts.operationResourceName.startsWith(`projects/${policy.PROJECT}/locations/${policy.REGION}/operations/`));
      assert.equal(typeof opts.onPoll, 'function'); polls++;
      const id = opts.operationResourceName.split('/').at(-1);
      return { serviceConfig: { service: `projects/${policy.PROJECT}/locations/${policy.REGION}/services/` + id.toLowerCase(), uri: 'https://synthetic.example.invalid' } };
    };
    const directExecutor = { run: async fn => fn() };
    const fab = new h.Fabricator({ projectId: policy.PROJECT, projectNumber: policy.NUMBER, sources: { default: { storage: h.state.storageSource } }, executor: directExecutor, functionExecutor: directExecutor, runFunctionExecutor: directExecutor });
    const plan = await h.modules['deploy/functions/release/planner'].createDeploymentPlan(args);
    const summary = await fab.applyPlan({ default: plan });
    assert.equal(summary.results.length, 70); assert(summary.results.every(result => !result.error), summary.results.filter(result => result.error).map(result => result.error.message).join('; '));
    const patches = h.writes.filter(req => req.method === 'PATCH');
    assert.equal(patches.length, 70); assert.equal(polls, 70); assert.equal(sourceTokenReads, 0); assert.equal(iamWrites, 0);
    for (const req of patches) {
      assert(!Object.hasOwn(req.body.buildConfig, 'sourceToken'));
      assert.deepEqual(req.body.buildConfig.source.storageSource, h.state.storageSource);
      assert.equal(req.body.buildConfig.environmentVariables.GOOGLE_NODE_RUN_SCRIPTS, '');
      assert(req.queryParams.updateMask.includes('buildConfig.source.storageSource'));
    }
    assert(h.logs.some(row => row.event === 'disabled-build-image-reuse'));
    // Reproduce the old real-Fabricator cause synthetically: default-enabled
    // optimization injects sourceToken and the unchanged write allowlist denies
    // it before transport. Neither the token value nor body enters diagnostics.
    actualExperiments.isEnabled = name => name === 'functionsv2deployoptimizations' || savedExperiment(name);
    logger.error = () => {};
    await assert.rejects(descriptors.updateV2Function.value.call(fab, makeEndpoint('updateEventRegistration'), { withToken: work => work('synthetic-only-do-not-log'), abort: () => {}, poller: () => {} }), /Failed to update function updateEventRegistration/u);
    assert(h.logs.some(row => row.event === 'blocked' && /Unexpected update field in buildConfig: sourceToken/u.test(row.fields.reason)));
    assert.equal(h.writes.filter(req => req.method === 'PATCH').length, 70);
    assert(!JSON.stringify(h.logs).includes('synthetic-only-do-not-log'));
  } finally {
    for (const [key, descriptor] of Object.entries(descriptors)) Object.defineProperty(proto, key, descriptor);
    ActualClient.prototype.request = savedRequest; actualExperiments.isEnabled = savedExperiment;
    poller.pollOperation = savedPoll; scraper.prototype.getToken = savedGetToken;
    run.setInvokerUpdate = savedInvoker; logger.error = savedErrorLog;
  }
});
test('real discovery and dynamic Extensions prepare leave an empty object that reaches the guarded 70-update planner', async () => {
  const manifest = { specVersion: 'v1alpha1', extensions: {}, endpoints: Object.fromEntries(names.map(id => [id, { platform: 'gcfv2', entryPoint: id, region: [policy.REGION], ...(id === 'readQuizMedia' || id === 'generatePrintArtifact' ? { httpsTrigger: {} } : { callableTrigger: {} }) }])) };
  const raw = actualDiscovery.buildFromV1Alpha1(manifest, policy.PROJECT, policy.REGION, 'nodejs22');
  assert.deepEqual(raw.extensions, {}); policy.rawBuild(raw, names);
  const extensionPayload = {}, extensionContext = {};
  const extensionsHelper = cli('extensions/extensionsHelper'), utils = cli('utils');
  const originalEnsure = extensionsHelper.ensureExtensionsApiEnabled, originalLog = utils.logLabeledError;
  let blockedRead = 0;
  try {
    extensionsHelper.ensureExtensionsApiEnabled = async () => { blockedRead++; throw Error('Synthetic blocked extension metadata origin'); };
    utils.logLabeledError = () => {};
    await actualExtensionsPrepare.prepareDynamicExtensions(extensionContext, { project: policy.PROJECT, projectNumber: policy.NUMBER, only: names.map(n => 'functions:' + n).join(','), config: { src: { functions: { source: 'functions', codebase: 'default', runtime: 'nodejs22' } } } }, extensionPayload, { default: raw });
  } finally { extensionsHelper.ensureExtensionsApiEnabled = originalEnsure; utils.logLabeledError = originalLog; }
  assert.equal(blockedRead, 1); assert.deepEqual(extensionPayload, {}); assert.deepEqual(extensionContext, {});
  const h = harness(); await discover(h); const args = makeArgs();
  // Same extPayload object assigned by Functions prepare.js after the helper's
  // caught read failure; the real planner executes before the mocked upload.
  await h.modules['deploy/functions/deploy'].deploy({ projectId: policy.PROJECT, filters: args.filters, extensions: extensionContext }, { projectNumber: policy.NUMBER }, { functions: { default: { wantBackend: args.wantBackend, haveBackend: args.haveBackend } }, extensions: extensionPayload });
  assert(h.order.indexOf('verified-update-only-plan') < h.order.indexOf('upload'));
  assert.equal(h.writes.length, 1); assert(h.logs.some(l => l.event === 'empty-dynamic-extensions' && l.fields.declaredExtensions === 0 && l.fields.plannedExtensionOperations === 0));
});
test('nonempty, malformed, array and hidden Extensions values stop before the original deploy adapter', async () => {
  for (const extensions of [{ instance: {} }, [], null, false, '', Object.create(null), Object.defineProperty({}, 'hidden', { value: {} }), { [Symbol('extension')]: {} }]) {
    const h = harness(); await discover(h); const args = makeArgs();
    await assert.rejects(h.modules['deploy/functions/deploy'].deploy({ projectId: policy.PROJECT, filters: args.filters }, { projectNumber: policy.NUMBER }, { functions: { default: args }, extensions }));
    assert.equal(h.writes.length, 0); assert(!h.order.includes('upload'));
    const raw = { params: [], extensions, endpoints: Object.fromEntries(names.map(id => [id, { ...makeEndpoint(id), region: [policy.REGION] }])) };
    assert.throws(() => policy.rawBuild(raw, names));
  }
});
test('operator attribution permits only explicit reviewed CLI account without ADC or token fallback', async () => {
  const h = harness(), auth = h.modules.requireAuth.requireAuth;
  assert.equal(await auth({ user: { email: 'operator@example.test' } }), 'operator@example.test');
  await assert.rejects(auth({ user: { email: 'different@example.test' } }));
  await assert.rejects(auth({}));
  await assert.rejects(auth({ user: { email: 'operator@example.test' }, token: 'synthetic' }));
  assert.equal(h.writes.length, 0);
});
test('pinned supported no-legacy branch avoids enabled Runtime Config transfer without changing frozen config', () => {
  const frozenConfig = { source: 'functions', codebase: 'default', runtime: 'nodejs22' };
  const normalized = actualProjectConfig.normalizeAndValidate(frozenConfig)[0], before = structuredClone(frozenConfig);
  assert.equal(actualProjectConfig.shouldUseRuntimeConfig(normalized), true);
  assert.equal(actualProjectConfig.shouldUseRuntimeConfig({ ...normalized, disallowLegacyRuntimeConfig: true }), false);
  const h = harness();
  assert.equal(h.modules['functions/projectConfig'].shouldUseRuntimeConfig(normalized), false);
  assert.deepEqual(frozenConfig, before);
  for (const alter of [c => c.source = 'other', c => c.codebase = 'other', c => c.runtime = 'nodejs20', c => c.predeploy = ['arbitrary'], c => c.disallowLegacyRuntimeConfig = false]) { const changed = structuredClone(normalized); alter(changed); assert.throws(() => h.modules['functions/projectConfig'].shouldUseRuntimeConfig(changed)); }
  assert.throws(() => h.modules['deploy/functions/prepareFunctionsUpload'].getFunctionsConfig(policy.PROJECT));
  assert.equal(h.writes.length, 0);
});
test('missing actual backend prevents even source upload; IAM/identity/cleanup writes never reach request sink', async () => {
  const h = harness(); await discover(h);
  const args = makeArgs(); delete args.haveBackend.endpoints[policy.REGION][names[0]];
  await assert.rejects(h.modules['deploy/functions/deploy'].deploy({ projectId: policy.PROJECT, filters: args.filters }, { projectNumber: policy.NUMBER }, { functions: { default: args } }));
  assert.equal(h.writes.length, 0);
  await h.modules['gcp/serviceusage'].generateServiceIdentity(policy.NUMBER, 'pubsub.googleapis.com', 'functions');
  assert.equal(h.writes.length, 0); assert(h.logs.some(l => l.event === 'skipped-unused-identity-preparation'));
  assert.throws(() => h.modules['gcp/run'].setInvokerUpdate());
  assert.throws(() => h.modules['functions/artifacts'].setCleanupPolicies());
  assert.deepEqual(await h.modules['functions/artifacts'].checkCleanupPolicy(policy.PROJECT, [policy.REGION]), { locationsToSetup: [], locationsWithErrors: [] });
  h.modules.ensureApiEnabled.check = async () => false;
  await assert.rejects(h.modules.ensureApiEnabled.ensure(policy.PROJECT, 'synthetic.googleapis.com', 'functions'));
  await assert.rejects(new h.MockClient({ urlPrefix: 'https://run.googleapis.com', apiVersion: 'v2' }).post(`projects/${policy.PROJECT}/locations/${policy.REGION}/services/health:setIamPolicy`, {}));
  assert.equal(h.writes.length, 0);
});
