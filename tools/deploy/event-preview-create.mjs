import { randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { STAGING_PROJECT as project } from '../staging/guard.mjs';
import { eventPreviewRewrite } from './artefakt.mjs';

const projectNumber = '177615774316';
const { functionId, region } = eventPreviewRewrite.function;
const location = 'projects/' + project + '/locations/' + region;
const functionName = location + '/functions/' + functionId;
const runName = location + '/services/' + functionId.toLowerCase();
const serviceAccountEmail = projectNumber + '-compute@developer.gserviceaccount.com';
const publicInvoker = 'roles/run.invoker';
const policyOptions = { queryParams: { 'options.requestedPolicyVersion': 3 } };

function hasPublicInvoker(policy) {
  return (policy.bindings ?? []).some(binding =>
    binding.role === publicInvoker && !binding.condition && binding.members.includes('allUsers'));
}

function matchesResource(actual, expected) {
  return actual === expected || actual === expected.replace('projects/' + project + '/', 'projects/' + projectNumber + '/');
}

async function assertMissing(client, resource) {
  try {
    await client.get(resource);
  } catch (error) {
    if (error?.status === 404) return;
    throw error;
  }
  throw new Error('První vytvoření vyžaduje nepřítomný prostředek: ' + resource);
}

export async function assertEventPreviewAbsent(functions, run) {
  await assertMissing(functions, functionName);
  await assertMissing(run, runName);
}

async function readEventPreview(functions) {
  const { body: fn } = await functions.get(functionName);
  if (!matchesResource(fn?.name, functionName) || fn.environment !== 'GEN_2' || fn.state !== 'ACTIVE' ||
      fn.buildConfig?.runtime !== 'nodejs22' || fn.buildConfig.entryPoint !== functionId || fn.eventTrigger || !fn.updateTime ||
      !matchesResource(fn.serviceConfig?.service, runName)) {
    throw new Error('Endpoint náhledu nemá očekávanou aktivní HTTPS konfiguraci.');
  }
  return fn;
}

export async function verifyEventPreviewForHosting(functions, run, hosting) {
  if (!hosting.rewrites.some(rewrite => isDeepStrictEqual(rewrite, eventPreviewRewrite))) return;
  let fn;
  try {
    fn = await readEventPreview(functions);
  } catch (error) {
    if (error?.status !== 404) throw error;
    throw new Error('Před změnou Hostingu použijte schválenou volbu 4 pro první vytvoření funkce ' + functionId + '.', { cause: error });
  }
  const { body: policy } = await run.get(fn.serviceConfig.service + ':getIamPolicy', policyOptions);
  if (!hasPublicInvoker(policy)) throw new Error('Endpoint náhledu nemá veřejné oprávnění k volání. Zkontrolujte záznam prvního vytvoření.');
}

export function eventPreviewCreationDetails() {
  return { functionName, runName, serviceAccountEmail };
}

function safeDirectory(directory) {
  try { mkdirSync(directory); }
  catch (error) { if (error?.code !== 'EEXIST') throw error; }
  if (!lstatSync(directory).isDirectory() || realpathSync(directory) !== directory) {
    throw new Error('Neočekávaná cesta k místnímu záznamu pro rollback.');
  }
}

export function eventPreviewRollbackRecord(root, head, prior, previousSource) {
  const base = path.join(realpathSync(root), '.local-data');
  const directory = path.join(base, 'deploy');
  safeDirectory(base);
  safeDirectory(directory);
  const id = randomUUID();
  const filename = path.join(directory, 'first-create-' + functionId + '-' + id + '.json');
  const record = {
    id, project, region, functionName, runName, sourceCommit: head, functionBefore: null,
    hostingBefore: { ...prior, commit: previousSource },
    hostingRollback: 'NASADIT.cmd --rollback ' + prior.id + ' ' + previousSource,
    state: 'prepared', createdAt: new Date().toISOString(),
  };
  const json = () => JSON.stringify(record, null, 2) + '\n';
  writeFileSync(filename, json(), { flag: 'wx', flush: true });
  return {
    id, filename,
    update(patch) {
      Object.assign(record, patch);
      const next = filename + '.' + randomUUID() + '.tmp';
      writeFileSync(next, json(), { flag: 'wx', flush: true });
      renameSync(next, filename);
    },
  };
}

export async function createEventPreview({ functions, run, head, record, storageSource, waitForOperation }) {
  await assertEventPreviewAbsent(functions, run);
  record.update({ state: 'creating' });
  const { body: operation } = await functions.post(location + '/functions', {
    name: functionName,
    environment: 'GEN_2',
    labels: { 'justkviz-source': head, 'justkviz-first-create': record.id },
    buildConfig: {
      runtime: 'nodejs22', entryPoint: functionId, source: { storageSource },
      environmentVariables: { GOOGLE_NODE_RUN_SCRIPTS: '' },
    },
    serviceConfig: {
      serviceAccountEmail, availableMemory: '256Mi', availableCpu: '1',
      timeoutSeconds: 10, minInstanceCount: 0, maxInstanceCount: 3, maxInstanceRequestConcurrency: 80,
      allTrafficOnLatestRevision: true, ingressSettings: 'ALLOW_ALL',
      environmentVariables: {
        FIREBASE_CONFIG: JSON.stringify({ projectId: project, storageBucket: project + '.firebasestorage.app' }),
        FUNCTION_TARGET: functionId, LOG_EXECUTION_ID: 'true',
      },
    },
  }, { queryParams: { functionId } });
  if (!matchesResource(operation?.name?.split('/operations/')[0], location) ||
      !/\/operations\/[^/]+$/u.test(operation.name)) throw new Error('Neočekávaná operace vytváření funkce náhledu.');
  record.update({ operation: operation.name });
  await waitForOperation(operation.name);

  const fn = await readEventPreview(functions);
  if (fn.labels?.['justkviz-source'] !== head || fn.labels?.['justkviz-first-create'] !== record.id ||
      fn.serviceConfig.serviceAccountEmail !== serviceAccountEmail) {
    throw new Error('Vytvořený endpoint neodpovídá potvrzenému zdroji a identitě.');
  }
  const service = fn.serviceConfig.service;
  record.update({ state: 'created', functionAfter: { name: fn.name, service, updateTime: fn.updateTime } });

  const { body: policy } = await run.get(service + ':getIamPolicy', policyOptions);
  if (!hasPublicInvoker(policy)) {
    if (!policy.etag) throw new Error('Cloud Run nevrátil etag potřebný k bezpečné změně IAM.');
    const bindings = [...(policy.bindings ?? [])];
    const index = bindings.findIndex(binding => binding.role === publicInvoker && !binding.condition);
    if (index === -1) bindings.push({ role: publicInvoker, members: ['allUsers'] });
    else bindings[index] = { ...bindings[index], members: [...bindings[index].members, 'allUsers'] };
    const { body: updated } = await run.post(service + ':setIamPolicy', {
      policy: { ...policy, bindings },
      updateMask: 'bindings,etag',
    });
    if (!hasPublicInvoker(updated)) throw new Error('Veřejné oprávnění nového endpointu se nepodařilo ověřit.');
  }
  record.update({ state: 'ready', publicInvoker });
}
