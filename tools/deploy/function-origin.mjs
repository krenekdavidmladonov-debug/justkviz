import { createHash } from 'node:crypto';

const environment = 'justkviz-d1-functions-europe-west1';
const task = 'justkviz_d1_functions';
const schema = 'justkviz-d1-functions-v1';
const sha = /^[0-9a-f]{40}$/u;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

const resolvedSource = fn => fn.buildConfig?.sourceProvenance?.resolvedStorageSource ?? fn.buildConfig?.source?.storageSource;

// Hash immutable source identity, not credentials, environment variables or the Firebase CLI cache label.
export function functionIdentity(fn) {
  const source = resolvedSource(fn);
  const revision = fn.serviceConfig?.revision;
  if (fn.state !== 'ACTIVE' || fn.environment !== 'GEN_2' || fn.buildConfig?.runtime !== 'nodejs22'
    || fn.serviceConfig?.allTrafficOnLatestRevision === false || !fn.name || !fn.buildConfig.entryPoint
    || !fn.updateTime || !revision || !source?.bucket || !source.object
    || typeof source.generation !== 'string' || !/^[1-9]\d*$/u.test(source.generation)) return undefined;
  return digest([fn.name, fn.buildConfig.entryPoint, fn.updateTime, revision, fn.buildConfig.build ?? null,
    source.bucket, source.object, source.generation]);
}

// GCF may copy an upload to a managed object. Compare the old and completed
// sources, including generation, independently of the mutable update timestamp.
export function updatedFunctionIdentity(before, after) {
  const old = resolvedSource(before);
  const current = resolvedSource(after);
  const identity = functionIdentity(after);
  if (!identity || !old?.bucket || !old.object || !old.generation || !before.serviceConfig?.revision) return undefined;
  if (before.serviceConfig.revision === after.serviceConfig.revision ||
      (old.bucket === current.bucket && old.object === current.object && old.generation === current.generation)) {
    throw new Error('Nelze potvrdit novou revizi a změnu zdroje ' + after.name + '.');
  }
  return identity;
}

export function inventoryIdentity(targets) {
  if (!targets.length || targets.some(fn => !fn.identity)) return undefined;
  return digest(targets.map(fn => [fn.entryPoint, fn.identity]).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}

export function readFunctionOrigin(api, targets) {
  const inventory = inventoryIdentity(targets);
  if (!inventory) return { reason: 'Živý inventář nemá úplnou identitu aktivních revizí a jejich zdrojů.' };
  try {
    const [record] = api('deployments?environment=' + environment + '&task=' + task + '&per_page=1');
    if (record?.environment === environment && record.task === task && Number.isSafeInteger(record.id)
      && sha.test(record.sha) && record.payload?.schema === schema && record.payload.inventory === inventory
      && api('deployments/' + record.id + '/statuses?per_page=1')[0]?.state === 'success') {
      return { commit: record.sha };
    }
    return { reason: 'Pro aktuální stav všech běžných Functions chybí shodný úspěšný záznam nasazení.' };
  } catch {
    return { reason: 'Původ živého backendu se nepodařilo ověřit v GitHub Deployments.' };
  }
}

// A successful checkpoint certifies the equivalent source for the whole ordinary backend.
// Untouched functions were checked against the previous checkpoint by the impact planner.
export function recordFunctionOrigin(api, head, targets, updated) {
  const inventory = inventoryIdentity(targets);
  if (!sha.test(head) || !inventory) throw new Error('Chybí ověřená identita vydaných Functions.');
  const record = api('deployments', { ref: head, task, environment, auto_merge: false, required_contexts: [],
    production_environment: true, description: 'Ověřené zdroje běžných Functions v europe-west1',
    payload: { schema, inventory, updated: [...updated].sort() } });
  if (!Number.isSafeInteger(record.id) || record.sha !== head) throw new Error('GitHub nepotvrdil záznam pro tento commit.');
  const status = api('deployments/' + record.id + '/statuses', { state: 'success', auto_inactive: false });
  if (status.state !== 'success') throw new Error('GitHub nepotvrdil úspěšný stav vydání Functions.');
}
