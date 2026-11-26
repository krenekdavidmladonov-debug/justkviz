import assert from 'node:assert/strict';

const project = 'projects/filmovy-kviz-v2-staging/';
const canonical = name => name?.replace(/^projects\/177615774316\//u, project);
const sourceOf = fn => fn.buildConfig?.sourceProvenance?.resolvedStorageSource ?? fn.buildConfig?.source?.storageSource;

// GCF timestamps are UTC protobuf timestamps with up to nine fractional digits.
function timestamp(value) {
  const match = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?Z$/u.exec(value);
  assert(match && Number.isFinite(Date.parse(value)), 'Chybí platný čas operace nebo funkce.');
  return match[1] + '.' + (match[2] ?? '').padEnd(9, '0');
}

function releaseFields(fn, target, startedAt) {
  const entryPoint = target.split('/').at(-1);
  assert.equal(canonical(fn.name), target, 'Výsledek patří jiné funkci.');
  assert.equal(fn.state, 'ACTIVE', target + ' není ACTIVE.');
  assert.equal(fn.environment, 'GEN_2');
  assert.equal(fn.buildConfig?.runtime, 'nodejs22');
  assert.equal(fn.buildConfig.entryPoint, entryPoint);
  assert(fn.buildConfig.build, 'Chybí identita buildu ' + target);
  assert(timestamp(fn.updateTime) >= timestamp(startedAt), 'Stav funkce předchází zahájení operace.');
  const cfg = fn.serviceConfig;
  const service = target.replace('/functions/' + entryPoint, '/services/' + entryPoint.toLowerCase());
  assert.equal(canonical(cfg?.service), service, 'Neočekávaná služba ' + target);
  assert(cfg.serviceAccountEmail && cfg.allTrafficOnLatestRevision !== false, 'Chybí identita služby nebo provoz na poslední revizi.');
  assert(cfg.revision?.startsWith(entryPoint.toLowerCase() + '-') && /^[a-z0-9-]+$/u.test(cfg.revision), 'Chybí revize služby.');
  const source = sourceOf(fn);
  assert(source?.bucket && source.object && typeof source.generation === 'string' && /^[1-9]\d*$/u.test(source.generation),
    'Chybí neměnný zdroj ' + target);
  return { service, account: cfg.serviceAccountEmail, revision: cfg.revision, build: fn.buildConfig.build,
    source: { bucket: source.bucket, object: source.object, generation: source.generation } };
}

export async function verifyFunctionRelease(target, { result, previous, startedAt }, live, readRevision) {
  const expected = releaseFields(result, target, startedAt);
  assert.deepEqual(releaseFields(live, target, startedAt), expected, 'Stav funkce neodpovídá dokončené operaci ' + target);
  if (previous) {
    const prior = previous.serviceConfig;
    assert.equal(canonical(prior?.service), expected.service);
    assert.equal(prior.serviceAccountEmail, expected.account);
    assert(prior.revision && prior.revision !== expected.revision, 'Nelze potvrdit novou revizi ' + target);
    const old = sourceOf(previous);
    assert(old?.bucket && old.object && old.generation, 'Chybí předchozí zdroj ' + target);
    assert(old.bucket !== expected.source.bucket || old.object !== expected.source.object || old.generation !== expected.source.generation,
      'Nelze potvrdit změnu zdroje ' + target);
  }
  const path = expected.service + '/revisions/' + expected.revision;
  const revision = await readRevision(path);
  assert.equal(canonical(revision.name), path);
  assert(revision.conditions?.some(c => c.type === 'Ready' && c.state === 'CONDITION_SUCCEEDED'), 'Revize není READY: ' + path);
}

// The Firebase CLI does not return CREATE receipts. Recover the unique successful
// CREATE for each missing target in this invocation, including paginated results.
export async function createdFunctionOperations(client, location, names, since) {
  const targets = new Set(names.map(name => location + '/functions/' + name));
  const found = new Map();
  let pageToken;
  do {
    const { body } = await client.get(location + '/operations', { queryParams: { pageSize: 100, ...(pageToken && { pageToken }) } });
    for (const op of body.operations ?? []) {
      const target = canonical(op.metadata?.target);
      if (!targets.has(target) || op.metadata.verb !== 'create' || timestamp(op.metadata.createTime) < timestamp(since)) continue;
      assert(!found.has(target) && op.done && !op.error && op.response, 'Nejednoznačný výsledek vytvoření ' + target);
      found.set(target, { result: op.response, startedAt: op.metadata.createTime });
    }
    pageToken = body.nextPageToken;
  } while (pageToken);
  assert.equal(found.size, targets.size, 'Chybí výsledek CREATE pro novou funkci.');
  return found;
}
