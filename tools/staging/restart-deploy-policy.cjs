'use strict';
// Policies are shared with offline adversarial tests. No CLI, Auth or network here.
const assert = require('node:assert/strict');
const PROJECT = 'filmovy-kviz-v2-staging', NUMBER = '177615774316', REGION = 'europe-west1';
const RELEASE_SHA = 'ddb862f946a7621e4ff9dbfb30f8976ad8d0e3ac';
const RECEIPT_SHA256 = '3507ab5d2742e50ff1798dfb1ffa1a3c2a166d1643d3c7ec3cd700bdedc5d375';
const HTTP_NAMES = new Set(['generatePrintArtifact', 'readQuizMedia']);
const sorted = values => [...values].sort();
function namesEqual(actual, expected) { assert.deepEqual(sorted(actual), sorted(expected), 'Exact 70 endpoints required'); }
function emptyExtensions(value) {
  assert(value === undefined || (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype && Reflect.ownKeys(value).length === 0), 'Only absent or empty plain Extensions metadata allowed');
}
function endpoint(e, names, raw = false) {
  assert(names.includes(e.id), 'Unknown endpoint');
  assert.equal(e.project, PROJECT); assert.equal(e.platform, 'gcfv2');
  assert.deepEqual(raw ? e.region : [e.region], [REGION]);
  assert.equal(e.runtime, 'nodejs22'); assert.equal(e.entryPoint, e.id);
  const trigger = HTTP_NAMES.has(e.id) ? 'httpsTrigger' : 'callableTrigger';
  assert(e[trigger] && typeof e[trigger] === 'object', 'Expected HTTP/callable trigger');
  assert(e.httpsTrigger?.invoker === undefined, 'Invoker mutation requested');
  for (const key of ['eventTrigger', 'taskQueueTrigger', 'scheduleTrigger', 'blockingTrigger', 'dataConnectGraphqlTrigger']) assert(!e[key], 'Forbidden trigger');
  assert(!(trigger === 'httpsTrigger' ? e.callableTrigger : e.httpsTrigger));
  assert(!e.callableTrigger?.genkitAction && !e.secretEnvironmentVariables?.length);
  assert(!e.serviceAccount || e.serviceAccount === `${NUMBER}-compute@developer.gserviceaccount.com`, 'Runtime service account changed');
  assert(!e.omit && !e.vpc && !e.baseImageUri && !e.command && !e.args, 'Unexpected runtime topology');
}
function backend(value, names, allEndpoints, { existing = false, allowHealth = false } = {}) {
  assert(!value.requiredRoles?.length && !Object.keys(value.lifecycleHooks ?? {}).length);
  const endpoints = allEndpoints(value), selected = endpoints.filter(e => !allowHealth || e.id !== 'health');
  namesEqual(selected.map(e => e.id), names);
  for (const e of selected) { endpoint(e, names); if (existing) { assert.equal(e.state, 'ACTIVE'); assert.equal(e.serviceAccount, `${NUMBER}-compute@developer.gserviceaccount.com`); } }
  if (allowHealth) {
    const extras = endpoints.filter(e => e.id === 'health'); assert(extras.length <= 1);
    for (const e of extras) assert(e.project === PROJECT && e.region === REGION && e.platform === 'gcfv2');
  }
}
function rawBuild(value, names) {
  emptyExtensions(value.extensions);
  assert.equal((value.params ?? []).length, 0, 'No params or secrets');
  assert(!value.requiredRoles?.length && !Object.keys(value.lifecycleHooks ?? {}).length);
  namesEqual(Object.keys(value.endpoints), names);
  for (const [id, e] of Object.entries(value.endpoints)) endpoint({ ...e, id }, names, true);
}
function plan(value, names, allEndpoints) {
  backend(value.plannedBackend, names, allEndpoints);
  for (const key of ['rolesToAdd', 'rolesToRemove']) assert(!value[key]?.length);
  for (const key of ['serviceAccountToCreate', 'serviceAccountToDelete', 'managedServiceAccount']) assert(!value[key]);
  assert.equal(Object.keys(value.secretAccessPlan ?? {}).length, 0);
  const changes = Object.values(value.regionalChangesets);
  assert(changes.length > 0);
  for (const change of changes) for (const key of ['endpointsToCreate', 'endpointsToDelete', 'endpointsToSkip']) assert.deepEqual(change[key], [], 'Update-only deployment');
  const updates = changes.flatMap(c => c.endpointsToUpdate);
  namesEqual(updates.map(u => u.endpoint.id), names);
  for (const u of updates) { assert(!u.unsafe && !u.deleteAndRecreate, 'Unsafe recreation forbidden'); endpoint(u.endpoint, names); }
}
function requestUrl(client, req) {
  // Match apiv2.Client.requestURL, including its API version and PUT query params.
  assert(typeof req.path === 'string' && !req.path.includes('://') && !req.path.startsWith('//'));
  const prefix = client.opts.urlPrefix.replace(/\/$/u, '');
  const pathname = '/' + req.path.replace(/^\//u, '');
  const url = new URL(prefix + (client.opts.apiVersion ? '/' + client.opts.apiVersion : '') + pathname);
  const query = req.queryParams;
  if (query instanceof URLSearchParams) url.search = query.toString();
  else for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, String(value));
  assert(url.protocol === 'https:' && !url.username && !url.password && !url.hash);
  return url;
}
const READ_HOSTS = new Set(['firebase.googleapis.com', 'cloudfunctions.googleapis.com', 'cloudresourcemanager.googleapis.com', 'run.googleapis.com', 'serviceusage.googleapis.com', 'iam.googleapis.com', 'artifactregistry.googleapis.com', 'cloudbuild.googleapis.com', 'storage.googleapis.com', 'compute.googleapis.com', 'cloudbilling.googleapis.com', 'www.googleapis.com']);
function readScope(url, state) {
  const p = decodeURIComponent(url.pathname);
  for (const match of p.matchAll(/\/projects\/([^/:]+)/gu)) assert([PROJECT, NUMBER].includes(match[1]), 'Foreign project read');
  // Object contents/listing are not deployment metadata. Managed source upload
  // uses a separately checked signed capability, never this read allowance.
  if (url.hostname === 'storage.googleapis.com') {
    const bucket = p.match(/^\/storage\/v1\/b\/([^/]+)(.*)$/u);
    assert(bucket && [PROJECT + '.firebasestorage.app', PROJECT + '.appspot.com', state.storageSource?.bucket].includes(bucket[1]) && !bucket[2], 'Unapproved bucket/content read');
  }
  if (url.hostname === 'www.googleapis.com') assert(p === '/oauth2/v3/token', 'Unapproved global read');
}
function requestPolicy(client, req, state, names) {
  const url = requestUrl(client, req), method = (req.method ?? 'GET').toUpperCase(), p = url.pathname, host = url.hostname;
  assert(!/:setIamPolicy$|:generateServiceIdentity$|:(?:enable|disable|batchEnable|batchDisable)$|\/keys(?:\/|$)|\/o\/oauth2\/revoke$/u.test(p), 'Forbidden infrastructure/identity action');
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    assert(READ_HOSTS.has(host), 'Unapproved API read origin');
    readScope(url, state);
    return { kind: 'read', host, path: p };
  }
  if (method === 'POST' && ((host === 'www.googleapis.com' && p === '/oauth2/v3/token') || (host === 'oauth2.googleapis.com' && p === '/token'))) return { kind: 'oauth-refresh', host, path: p };
  const readRpc = method === 'POST' && (
    (host === 'cloudresourcemanager.googleapis.com' && [`/v1/projects/${PROJECT}:getIamPolicy`, `/v1/projects/${NUMBER}:getIamPolicy`, `/v1/projects/${PROJECT}:testIamPermissions`, `/v1/projects/${NUMBER}:testIamPermissions`].includes(p)) ||
    (host === 'iam.googleapis.com' && [NUMBER + '-compute@developer.gserviceaccount.com', PROJECT + '@appspot.gserviceaccount.com'].some(account => p === `/v1/projects/${PROJECT}/serviceAccounts/${account}:testIamPermissions`)) ||
    (host === 'cloudfunctions.googleapis.com' && /^\/v[12]\/projects\/filmovy-kviz-v2-staging\/locations\/europe-west1\/functions(?:\/[A-Za-z]\w*)?:testIamPermissions$/u.test(p)));
  if (readRpc) return { kind: 'read-rpc', host, path: p };
  assert(state.backendVerified && state.planVerified, 'Verified plan required before source/function writes');
  if (method === 'POST' && host === 'cloudfunctions.googleapis.com' && p === `/v2/projects/${PROJECT}/locations/${REGION}/functions:generateUploadUrl`) return { kind: 'upload-url', host, path: p };
  if (method === 'PUT' && state.uploadUrls.has(url.href)) return { kind: 'source-upload', host, path: p };
  if (method === 'PATCH' && host === 'cloudfunctions.googleapis.com') {
    const id = p.split('/').at(-1);
    assert(names.includes(id) && p === `/v2/projects/${PROJECT}/locations/${REGION}/functions/${id}`, 'Function update target mismatch');
    const body = req.body;
    const keys = (value, allowed, location) => {
      const unknown = Object.keys(value ?? {}).filter(key => !allowed.includes(key));
      assert(unknown.length === 0, `Unexpected update field in ${location}: ${unknown.map(key => /^[A-Za-z][A-Za-z0-9_]{0,79}$/u.test(key) ? key : '<invalid-field-name>').join(',')}`);
    };
    keys(body, ['name', 'buildConfig', 'serviceConfig', 'labels'], 'function');
    keys(body.buildConfig, ['runtime', 'entryPoint', 'source', 'environmentVariables'], 'buildConfig');
    keys(body.buildConfig.source, ['storageSource'], 'buildConfig.source');
    keys(body.serviceConfig, ['environmentVariables', 'secretEnvironmentVariables', 'ingressSettings', 'timeoutSeconds', 'serviceAccountEmail', 'availableMemory', 'minInstanceCount', 'maxInstanceCount', 'maxInstanceRequestConcurrency', 'availableCpu', 'vpcConnector', 'vpcConnectorEgressSettings', 'directVpcNetworkInterface', 'directVpcEgress'], 'serviceConfig');
    for (const key of ['vpcConnector', 'vpcConnectorEgressSettings', 'directVpcNetworkInterface', 'directVpcEgress']) assert(body.serviceConfig?.[key] == null);
    assert(body?.name === p.slice(4), 'Function body target mismatch');
    assert.equal(body.buildConfig?.entryPoint, id); assert.equal(body.buildConfig?.runtime, 'nodejs22');
    assert(!body.eventTrigger && !body.serviceConfig?.secretEnvironmentVariables?.length);
    // SDK null/default resolves to the compute identity already checked on every
    // existing endpoint. Explicitly changing it to any other account is denied.
    assert(body.serviceConfig?.serviceAccountEmail == null || body.serviceConfig.serviceAccountEmail === `${NUMBER}-compute@developer.gserviceaccount.com`);
    assert(!body.serviceConfig?.vpcConnector && !body.serviceConfig?.vpcAccess && !body.buildConfig?.dockerRepository && !body.buildConfig?.workerPool);
    assert(body.buildConfig?.source?.storageSource, 'Approved source required');
    assert.deepEqual(body.buildConfig.source.storageSource, state.storageSource, 'Different upload source');
    return { kind: 'function-update', host, path: p };
  }
  throw new Error(`Unapproved deployment write: ${method} ${host}${p}`);
}
function evidenceEnvelope(value) {
  assert.deepEqual(Object.keys(value).sort(), ['schemaVersion', 'mode', 'projectId', 'region', 'releaseSha', 'receiptSha256', 'approvalReference', 'ci', 'preflight', 'pause'].sort());
  assert.equal(value.schemaVersion, 1); assert.equal(value.mode, 'APPROVED_RESTART_FUNCTIONS_UPDATE');
  assert.equal(value.projectId, PROJECT); assert.equal(value.region, REGION);
  assert.equal(value.releaseSha, RELEASE_SHA); assert.equal(value.receiptSha256, RECEIPT_SHA256);
  assert(typeof value.approvalReference === 'string' && value.approvalReference.trim().length >= 3);
}
function freshPreflight(value, names, expectedRevision, controlUpdateTime, now = Date.now()) {
  assert.equal(value.mode, 'RESTART_PREFLIGHT_VERIFIED'); assert.equal(value.releaseSha, RELEASE_SHA);
  assert.equal(value.projectId, PROJECT); assert.equal(value.region, REGION);
  const observed = Date.parse(value.observedAt);
  assert(Number.isFinite(observed) && observed <= now && now - observed <= 30 * 60 * 1000, 'Fresh post-pause preflight required');
  assert.equal(value.accessControl?.collaborationEnabled, false);
  assert.equal(value.accessControl.revision, expectedRevision + 1);
  const updated = Date.parse(value.accessControl.updateTime);
  assert(Number.isFinite(updated) && updated <= observed, 'Valid observed control updateTime required');
  assert.equal(value.accessControl.updateTime, controlUpdateTime, 'Control changed after audited pause');
  namesEqual(value.functions.map(f => f.name), [...names, 'health']);
  assert(value.functions.every(f => f.state === 'ACTIVE' && f.platform === 'gcfv2' && f.region === REGION && f.serviceAccount === `${NUMBER}-compute@developer.gserviceaccount.com`));
  for (const name of ['apisAlreadyEnabled', 'storageRulesMatch', 'indexesReadyMatch', 'runtimeConfigMatches', 'noEmailEndpoints', 'failuresResolved']) assert.equal(value.checks?.[name], true, name);
}
module.exports = { PROJECT, NUMBER, REGION, RELEASE_SHA, RECEIPT_SHA256, namesEqual, endpoint, backend, rawBuild, plan, requestUrl, requestPolicy, evidenceEnvelope, freshPreflight };

function install({ cli, names, checkArtifact, log, operatorEmail }) {
  const state = { backendVerified: false, planVerified: false, applyVerified: false, uploadUrls: new Set(), storageSource: null };
  const fail = label => { log('blocked', { reason: label }); throw new Error(`Restart deployment guard: ${label}`); };
  const experiments = cli('experiments'), isEnabled = experiments.isEnabled;
  experiments.isEnabled = function(name) {
    if (name === 'functionsv2deployoptimizations') return false;
    return isEnabled.call(this, name);
  };
  log('disabled-build-image-reuse', { experiment: 'functionsv2deployoptimizations', reason: 'Pinned supported no-sourceToken branch; exact uploaded source remains required' });
  assert(typeof operatorEmail === 'string' && operatorEmail.includes('@'));
  const auth = cli('requireAuth'), requireAuth = auth.requireAuth;
  auth.requireAuth = async function(options) {
    assert.equal(options.user?.email, operatorEmail, 'Explicit signed-in operator differs from pause approval');
    assert(!options.token, 'Token authentication forbidden');
    const email = await requireAuth.call(this, options, true);
    assert.equal(email, operatorEmail, 'Signed-in operator required; no ADC fallback');
    log('verified-operator', { attribution: 'Same explicit CLI account as pause approval' });
    return email;
  };
  const projectConfig = cli('functions/projectConfig');
  projectConfig.shouldUseRuntimeConfig = config => {
    // Same supported CLI branch as disallowLegacyRuntimeConfig:true, applied
    // only to the exact frozen local configuration without editing its bytes.
    assert.deepEqual(config, { codebase: 'default', source: 'functions', runtime: 'nodejs22' }, 'Unexpected Functions config');
    log('disabled-legacy-runtime-config', { reason: 'Pinned supported no-legacy configuration branch; no legacy config read or packaging' });
    return false;
  };
  cli('deploy/functions/prepareFunctionsUpload').getFunctionsConfig = () => fail('Legacy Runtime Config read forbidden');
  const api = cli('apiv2'), originalRequest = api.Client.prototype.request;
  api.Client.prototype.request = async function(req) {
    let decision;
    try { decision = requestPolicy(this, req, state, names); } catch (error) { return fail(error.message); }
    if (decision.kind === 'function-update') assert(state.applyVerified, 'ApplyPlan gate required');
    if (!['read', 'read-rpc', 'oauth-refresh'].includes(decision.kind)) log('allowed-write', { method: req.method, ...decision });
    return originalRequest.call(this, req);
  };
  const backendApi = cli('deploy/functions/backend'), all = backendApi.allEndpoints;
  const build = cli('deploy/functions/build'), resolve = build.resolveBackend;
  build.resolveBackend = async function(opts) {
    assert.equal(opts.codebase, 'default'); assert.equal(opts.isEmulator, false); assert(!opts.force);
    rawBuild(opts.build, names);
    const resolved = await resolve.call(this, opts);
    backend(resolved.backend, names, all);
    state.backendVerified = true; log('verified-backend', { functions: names.length });
    return resolved;
  };
  const usage = cli('gcp/serviceusage');
  usage.generateServiceIdentity = async (number, service, prefix) => {
    assert(state.backendVerified && String(number) === NUMBER && prefix === 'functions');
    assert(['pubsub.googleapis.com', 'eventarc.googleapis.com'].includes(service));
    log('skipped-unused-identity-preparation', { service, reason: 'Verified HTTP-only backend; no identity created or claimed' });
    return undefined;
  };
  const apiEnabled = cli('ensureApiEnabled');
  apiEnabled.ensure = async (project, api, prefix) => {
    assert([PROJECT, NUMBER].includes(String(project)));
    if (!await apiEnabled.check(project, api, prefix, true)) fail('Required API not already enabled');
  };
  const planner = cli('deploy/functions/release/planner'), createPlan = planner.createDeploymentPlan;
  async function verifyPlan(args) {
    assert.equal(args.projectId, PROJECT); assert.equal(args.codebase, 'default'); assert(!args.deleteAll);
    backend(args.wantBackend, names, all);
    backend(args.haveBackend, names, all, { existing: true, allowHealth: true });
    assert.equal(args.filters?.length, names.length);
    namesEqual(args.filters.map(f => { assert.equal(f.codebase, 'default'); assert.equal(f.idChunks?.length, 1); return f.idChunks[0]; }), names);
    checkArtifact();
    const result = await createPlan.call(planner, args);
    plan(result, names, all);
    state.planVerified = true; log('verified-update-only-plan', { updates: names, creates: [], deletes: [], skips: [] });
    return result;
  }
  planner.createDeploymentPlan = verifyPlan;
  // CLI 15.28.2 uploads in deploy(), before the later release planner. Verify the
  // real planner here too, so bad plans cannot even allocate an upload URL.
  const deploy = cli('deploy/functions/deploy'), originalDeploy = deploy.deploy;
  deploy.deploy = async function(context, options, payload) {
    assert(state.backendVerified); assert.equal(context.projectId, PROJECT);
    assert.equal(String(options.projectNumber), NUMBER); emptyExtensions(payload.extensions);
    if (payload.extensions !== undefined) log('empty-dynamic-extensions', { declaredExtensions: 0, plannedExtensionOperations: 0 });
    assert.deepEqual(Object.keys(payload.functions ?? {}), ['default']);
    const current = payload.functions.default;
    await verifyPlan({ ...current, codebase: 'default', projectId: PROJECT, filters: context.filters });
    return originalDeploy.call(this, context, options, payload);
  };
  const fab = cli('deploy/functions/release/fabricator').Fabricator, apply = fab.prototype.applyPlan, update = fab.prototype.updateV2Function;
  fab.prototype.applyPlan = async function(plans) {
    assert(state.planVerified); assert.equal(this.projectId, PROJECT); assert.equal(String(this.projectNumber), NUMBER);
    assert.deepEqual(Object.keys(plans), ['default']); plan(plans.default, names, all); checkArtifact();
    state.applyVerified = true;
    return apply.call(this, plans);
  };
  fab.prototype.updateV2Function = async function(e) {
    assert(state.applyVerified); endpoint(e, names);
    // CLI 15.34 uses withToken even when reuse is disabled. Never enter its
    // shared token queue or retain a source token from an operation response.
    const noReuse = { getToken: async () => undefined, withToken: async work => work(undefined), poller: () => {}, abort: () => {} };
    return update.call(this, e, noReuse);
  };
  for (const method of ['createV1Function', 'createV2Function', 'createRunFunction', 'updateV1Function', 'updateRunFunction', 'deleteV1Function', 'deleteV2Function', 'deleteRunFunction']) if (typeof fab.prototype[method] === 'function') fab.prototype[method] = () => fail(`Forbidden Fabricator.${method}`);
  const run = cli('gcp/run');
  for (const method of ['setInvokerCreate', 'setInvokerUpdate', 'setIamPolicy']) run[method] = () => fail(`Forbidden run.${method}`);
  const artifacts = cli('functions/artifacts');
  artifacts.checkCleanupPolicy = async (project, locations) => {
    assert.equal(project, PROJECT); assert.deepEqual(locations, [REGION]);
    log('skipped-cleanup-policy-preparation', { reason: 'No artifact cleanup policy reads or writes requested' });
    return { locationsToSetup: [], locationsWithErrors: [] };
  };
  artifacts.setCleanupPolicies = () => fail('Artifact cleanup policy write forbidden');
  const gcf = cli('gcp/cloudfunctionsv2'), upload = gcf.generateUploadUrl;
  gcf.generateUploadUrl = async function(project, region) {
    assert(state.backendVerified && state.planVerified); assert.equal(project, PROJECT); assert.equal(region, REGION);
    checkArtifact();
    const result = await upload.call(this, project, region);
    const url = new URL(result.uploadUrl);
    assert(url.protocol === 'https:' && url.hostname === 'storage.googleapis.com' && !url.username && !url.password && !url.hash);
    assert(typeof result.storageSource?.bucket === 'string' && /^[a-z0-9][a-z0-9._-]+$/u.test(result.storageSource.bucket));
    assert(typeof result.storageSource.object === 'string' && /^[A-Za-z0-9_-]+\.zip$/u.test(result.storageSource.object));
    // Bind the one upload capability to the exact storageSource returned by the
    // fixed project's GCF API. Do not guess managed bucket naming conventions.
    assert.equal(decodeURIComponent(url.pathname), '/' + result.storageSource.bucket + '/' + result.storageSource.object);
    // gcp/storage.upload passes URLSearchParams to apiv2.doRequest, which uses
    // its toString() serialization (e.g. ~ => %7E and spaces => +). Preserve
    // every ordered pair/value while registering the same wire capability.
    url.search = url.searchParams.toString();
    state.uploadUrls.add(url.href); state.storageSource = result.storageSource;
    return result;
  };
  for (const method of ['createFunction', 'deleteFunction']) gcf[method] = () => fail(`Forbidden cloudfunctionsv2.${method}`);
  return state;
}
module.exports.install = install;
