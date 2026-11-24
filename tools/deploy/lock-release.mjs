import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { LIMIT } from './lock-bundle.mjs';

export const REGION_PATH = 'projects/filmovy-kviz-v2-staging/locations/europe-west1';
export const LOCK = REGION_PATH + '/functions/lockEventQuiz';
const service = REGION_PATH + '/services/lockeventquiz';
export const SOURCE_MASK = 'buildConfig.source.storageSource';

export function linuxProof(head, jobs, readLog) {
  const matches = jobs.filter(job => job.name === 'D2 Linux lockEventQuiz' && job.status === 'completed'
    && job.conclusion === 'success' && job.head_sha === head && Number.isSafeInteger(job.id));
  assert.equal(matches.length, 1, 'Chybí úspěšný Linux build tohoto commitu a pokusu CI.');
  const records = [...readLog(matches[0].id).matchAll(/^(?:[\dT:.Z-]+ )?D2_VERIFIED ([a-f0-9]{40}) ([a-f0-9]{64}) ([1-9]\d*)\r?$/gmu)]
    .filter(match => match[1] === head);
  assert.equal(records.length, 1, 'Chybí jednoznačný výsledek ověření ZIPu v Linuxu.');
  const [, sha, digest, size] = records[0];
  assert(Number(size) < LIMIT);
  return { sha, digest, size: Number(size) };
}

function baseline(fn) {
  assert(fn.name === LOCK && fn.environment === 'GEN_2' && fn.state === 'ACTIVE' && !fn.eventTrigger);
  assert(fn.buildConfig?.runtime === 'nodejs22' && fn.buildConfig.entryPoint === 'lockEventQuiz'
    && fn.buildConfig.environmentVariables?.GOOGLE_NODE_RUN_SCRIPTS === 'gcp-build');
  assert([service, service.replace('filmovy-kviz-v2-staging', '177615774316')].includes(fn.serviceConfig?.service));
  assert.match(fn.serviceConfig.revision ?? '', /^lockeventquiz-[a-z0-9-]+$/u);
  const old = fn.buildConfig.sourceProvenance?.resolvedStorageSource ?? fn.buildConfig.source?.storageSource;
  assert(typeof old?.bucket === 'string' && /^[a-z0-9.-]+$/u.test(old.bucket)
    && typeof old.object === 'string' && /^[a-zA-Z0-9_./-]+$/u.test(old.object) && typeof old.generation === 'string' && /^[1-9]\d*$/u.test(old.generation));
  assert(typeof fn.updateTime === 'string' && Number.isFinite(Date.parse(fn.updateTime)));
  return { updateTime: fn.updateTime, revision: fn.serviceConfig.revision, old };
}

// No create, IAM, Hosting, Rules or general deployment callback is available here.
export async function publishLock({ head, bytes, verifyCI, client, confirm, upload, wait, log = console.log }) {
  const evidence = { sha: head, digest: createHash('sha256').update(bytes).digest('hex'), size: bytes.length };
  assert.match(head, /^[a-f0-9]{40}$/u);
  assert(bytes.length > 0 && bytes.length < LIMIT);
  assert.deepEqual(verifyCI(), evidence, 'Místní ZIP neodpovídá ověřenému Linuxovému sestavení.');
  const before = baseline((await client.get(LOCK)).body);
  log('D2 pouze ' + LOCK + '\nCommit ' + head + ', ZIP ' + bytes.length + ' B, SHA-256 ' + evidence.digest);
  log('Předchozí revize ' + before.revision + ', zdroj ' + JSON.stringify(before.old) + ', updateTime ' + before.updateTime);
  const phrase = 'NASADIT lockEventQuiz ' + head.slice(0, 12);
  assert.equal(await confirm(phrase), phrase, 'D2 nebylo potvrzeno.');
  const unchanged = async () => assert.deepEqual(baseline((await client.get(LOCK)).body), before, 'Cíl D2 se změnil.');
  assert.deepEqual(verifyCI(), evidence);
  await unchanged();
  const source = await upload(client, bytes);
  assert.deepEqual(verifyCI(), evidence);
  await unchanged();
  const { body: op } = await client.patch(LOCK, { name: LOCK, buildConfig: { source: { storageSource: source } } },
    { queryParams: { updateMask: SOURCE_MASK } });
  const completed = baseline(await wait(op));
  const after = (await client.get(LOCK)).body;
  const deployed = baseline(after);
  assert.deepEqual(deployed, completed, 'Stav funkce neodpovídá dokončené operaci D2.');
  assert(deployed.updateTime !== before.updateTime && deployed.revision !== before.revision, 'Nelze potvrdit novou revizi.');
  // GCF can copy the upload into a managed source bucket, giving it a new object name.
  assert.notDeepEqual(deployed.old, before.old, 'Nelze potvrdit změnu zdroje.');
  log('D2 dokončeno: ' + deployed.revision + ', zdroj ' + JSON.stringify(deployed.old));
}
