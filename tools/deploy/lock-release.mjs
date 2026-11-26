import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { d2Names, exceptions } from './d2-functions.mjs';
import { verifyFunctionRelease } from './release-verification.mjs';
import { LIMIT } from './lock-bundle.mjs';

export const REGION_PATH = 'projects/filmovy-kviz-v2-staging/locations/europe-west1';
export const LOCK = REGION_PATH + '/functions/lockEventQuiz';
export const resource = name => {
  assert(d2Names.includes(name), 'Neznámá funkce D2.');
  return REGION_PATH + '/functions/' + name;
};
export const SOURCE_MASK = 'buildConfig.source.storageSource';

export function linuxProof(head, jobs, readLog, name = 'lockEventQuiz') {
  assert(d2Names.includes(name));
  const matches = jobs.filter(job => job.name === 'D2 Linux packages' && job.status === 'completed'
    && job.conclusion === 'success' && job.head_sha === head && Number.isSafeInteger(job.id));
  assert.equal(matches.length, 1, 'Chybí úspěšný Linux build tohoto commitu a pokusu CI.');
  const records = [...readLog(matches[0].id).matchAll(/^(?:[\dT:.Z-]+ )?D2_VERIFIED ([a-zA-Z]+) ([a-f0-9]{40}) ([a-f0-9]{64}) ([1-9]\d*)\r?$/gmu)]
    .filter(match => match[1] === name && match[2] === head);
  assert.equal(records.length, 1, 'Chybí jednoznačný výsledek ověření ZIPu v Linuxu.');
  const [, , sha, digest, size] = records[0];
  assert(Number(size) < LIMIT);
  return { sha, digest, size: Number(size) };
}

export function baseline(fn, name) {
  const service = REGION_PATH + '/services/' + name.toLowerCase();
  assert(fn.name === resource(name) && fn.environment === 'GEN_2' && fn.state === 'ACTIVE' && !fn.eventTrigger);
  assert(fn.buildConfig?.runtime === 'nodejs22' && fn.buildConfig.entryPoint === name
    && fn.buildConfig.environmentVariables?.GOOGLE_NODE_RUN_SCRIPTS === 'gcp-build');
  assert([service, service.replace('filmovy-kviz-v2-staging', '177615774316')].includes(fn.serviceConfig?.service));
  assert(fn.serviceConfig.revision?.startsWith(name.toLowerCase() + '-') && /^[a-z0-9-]+$/u.test(fn.serviceConfig.revision));
  assert(fn.serviceConfig.allTrafficOnLatestRevision !== false, 'Směrování provozu vyžaduje kontrolu.');
  const old = fn.buildConfig.sourceProvenance?.resolvedStorageSource ?? fn.buildConfig.source?.storageSource;
  assert(typeof old?.bucket === 'string' && /^[a-z0-9.-]+$/u.test(old.bucket)
    && typeof old.object === 'string' && /^[a-zA-Z0-9_./-]+$/u.test(old.object) && typeof old.generation === 'string' && /^[1-9]\d*$/u.test(old.generation));
  assert(typeof fn.updateTime === 'string' && Number.isFinite(Date.parse(fn.updateTime)));
  return { updateTime: fn.updateTime, revision: fn.serviceConfig.revision, old };
}

// No create, IAM, Hosting, Rules or general deployment callback is available here.
export async function publishD2({ name, head, bytes, verifyCI, client, confirm, upload, wait, readRevision, savePrevious, expected, log = console.log }) {
  const target = resource(name);
  assert(!exceptions[name], exceptions[name]);
  const evidence = { sha: head, digest: createHash('sha256').update(bytes).digest('hex'), size: bytes.length };
  assert.match(head, /^[a-f0-9]{40}$/u);
  assert(bytes.length > 0 && bytes.length < LIMIT);
  assert.deepEqual(verifyCI(), evidence, 'Místní ZIP neodpovídá ověřenému Linuxovému sestavení.');
  const previous = (await client.get(target)).body;
  const before = baseline(previous, name);
  log('D2 pouze ' + target + '\nCommit ' + head + ', ZIP ' + bytes.length + ' B, SHA-256 ' + evidence.digest);
  log('Předchozí revize ' + before.revision + ', zdroj ' + JSON.stringify(before.old) + ', updateTime ' + before.updateTime);
  if (expected) assert.deepEqual(before, expected, 'Cíl D2 se od výběru změnil.');
  const phrase = 'NASADIT ' + name + ' ' + head.slice(0, 12);
  assert.equal(await confirm(phrase), phrase, 'D2 nebylo potvrzeno.');
  const unchanged = async () => assert.deepEqual(baseline((await client.get(target)).body, name), before, 'Cíl D2 se změnil.');
  assert.deepEqual(verifyCI(), evidence);
  await unchanged();
  savePrevious(name, before, evidence);
  const source = await upload(client, bytes);
  assert.deepEqual(verifyCI(), evidence);
  await unchanged();
  const { body: op } = await client.patch(target, { name: target, buildConfig: { source: { storageSource: source } } },
    { queryParams: { updateMask: SOURCE_MASK } });
  const result = await wait(op);
  baseline(result, name);
  const after = (await client.get(target)).body;
  const deployed = baseline(after, name);
  await verifyFunctionRelease(target, { previous, result, startedAt: op.metadata?.createTime }, after, readRevision);
  log('D2 dokončeno: ' + deployed.revision + ', zdroj ' + JSON.stringify(deployed.old));
  return deployed;
}
