import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { stagingClient, stagingWebConfig } from '../staging/cloud.mjs';
import { STAGING_PROJECT as PROJECT } from '../staging/guard.mjs';
import { verifyFunctionRelease, createdFunctionOperations } from './release-verification.mjs';
import { analyzeFunctionImpact } from './function-impact.mjs';
import { functionIdentity, updatedFunctionIdentity, readFunctionOrigin, recordFunctionOrigin } from './function-origin.mjs';
import { attemptJobs, checkedRun, verifyMainSuite } from './ci-proof.mjs';
import { buildLockZip } from './lock-bundle.mjs';
import { releaseHistory, historyDirectory, releaseSelection } from './d2-selection.mjs';
import { d2Names, exceptions } from './d2-functions.mjs';
import { linuxProof } from './lock-release.mjs';
import { prepareArtifact, prepareFunctionCreation, removeArtifact } from './artefakt.mjs';

const SITE = 'justkviz-v2';
const LIVE_URL = 'https://justkviz.cz';
const REGION = 'europe-west1';
const FUNCTION_BATCH_SIZE = 5;
const BUCKET = PROJECT + '.firebasestorage.app';
const REPO = 'krenekdavidmladonov-debug/justkviz';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const shaPattern = /^[0-9a-f]{40}$/u;
const idPattern = /^[a-zA-Z0-9_-]{1,100}$/u;
const live = 'sites/' + SITE + '/channels/live';
const messagePrefix = 'JustKviz D1 git ';
const location = 'projects/' + PROJECT + '/locations/' + REGION;
const functionsOrigin = 'https://cloudfunctions.googleapis.com';

const git = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 45_000 });
const gh = (endpoint, body) => JSON.parse(execFileSync('gh', ['api', '--hostname', 'github.com', 'repos/' + REPO + '/' + endpoint,
  ...(body ? ['--method', 'POST', '--input', '-'] : [])],
  { cwd: ROOT, encoding: 'utf8', input: body ? JSON.stringify(body) : undefined, windowsHide: true, timeout: 45_000 }));

export function verifyMain(readGit, readGitHub, checkJobs) {
  if (readGit(['branch', '--show-current']).trim() !== 'main') throw new Error('Nasazení vyžaduje větev main.');
  if (readGit(['status', '--porcelain=v1', '--untracked-files=all', '--ignore-submodules=none']).trim()) {
    throw new Error('Pracovní strom není čistý.');
  }
  const head = readGit(['rev-parse', 'HEAD']).trim();
  const tracking = readGit(['rev-parse', 'refs/remotes/origin/main']).trim();
  const origin = readGit(['remote', 'get-url', 'origin']).trim();
  if (!['https://github.com/' + REPO + '.git', 'git@github.com:' + REPO + '.git'].includes(origin)) {
    throw new Error('Origin není schválený repozitář JustKvízu.');
  }
  const remote = readGit(['ls-remote', '--exit-code', 'origin', 'refs/heads/main']).trim();
  if (!shaPattern.test(head) || tracking !== head || remote !== head + '\trefs/heads/main') {
    throw new Error('HEAD, origin/main a main na GitHubu se musí shodovat.');
  }
  const run = readGitHub('actions/workflows/ci.yml/runs?branch=main&event=push&head_sha=' + head + '&per_page=1').workflow_runs?.[0];
  if (!checkedRun(run, 'push', head) || run.head_branch !== 'main') {
    throw new Error('CI pro přesný push na main nemá výsledek success.');
  }
  let jobs;
  try {
    jobs = attemptJobs(readGitHub, run);
    verifyMainSuite(readGitHub, run, jobs, readGit(['rev-parse', 'HEAD^{tree}']).trim());
  } catch (error) {
    throw new Error('Nasazení zastaveno: nelze doložit zelené kontroly pro aktuální main. ' + error.message, { cause: error });
  }
  checkJobs?.(head, jobs);
  return head;
}

function parseArgs(args) {
  if (!args.length) return {};
  const [mode, release, commit] = args;
  if (args.length !== 3 || !['--previous', '--rollback'].includes(mode) || !idPattern.test(release) || !shaPattern.test(commit)) {
    throw new Error('Použití: NASADIT.cmd [--previous ID_RELEASE COMMIT | --rollback ID_RELEASE COMMIT]');
  }
  return { mode, release, commit };
}

function hostingRelease(release) {
  const parts = /^sites\/justkviz-v2\/(?:channels\/live\/)?releases\/([a-zA-Z0-9_-]{1,100})$/u.exec(release?.name);
  if (!parts || !/^sites\/justkviz-v2\/versions\/[a-zA-Z0-9_-]{1,100}$/u.test(release.version?.name)) {
    throw new Error('Nepodařilo se ověřit aktuální vydání a verzi Hostingu.');
  }
  const commit = /^JustKviz D1 git ([0-9a-f]{40})$/u.exec(release.message ?? '')?.[1];
  return { id: parts[1], version: release.version.name, commit };
}

function showRelease(release) {
  console.log('Aktivní Hosting release ' + release.id + ', verze ' + release.version);
}

function previousCommit(release, options, head) {
  if (options.mode === '--previous' && (options.release !== release.id ||
      (release.commit && options.commit !== release.commit))) {
    throw new Error('Zadaná dvojice předchozího vydání a commitu neodpovídá živému Hostingu.');
  }
  const commit = release.commit ?? options.commit;
  if (!commit) throw new Error('Chybí původ vydání. Zadejte ověřenou dvojici: NASADIT.cmd --previous ' + release.id + ' COMMIT');
  git(['merge-base', '--is-ancestor', commit, head]);
  return commit;
}

function exportedFunctions(head) {
  const ts = require('typescript');
  const source = ts.createSourceFile('index.ts', git(['show', head + ':functions/src/index.ts']), ts.ScriptTarget.Latest, true);
  const names = [];
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly || !statement.exportClause || !ts.isNamedExports(statement.exportClause)) {
        throw new Error('Inventář Functions vyžaduje explicitní exporty.');
      }
      names.push(...statement.exportClause.elements.map(element => element.name.text));
    } else if (statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      if (!ts.isVariableStatement(statement)) throw new Error('Nepodporovaný export v inventáři Functions.');
      names.push(...statement.declarationList.declarations.map(declaration => declaration.name.getText(source)));
    }
  }
  if (!names.length || new Set(names).size !== names.length || names.some(name => !/^[A-Za-z]\w*$/u.test(name))) {
    throw new Error('Neplatný inventář Functions.');
  }
  return names.sort();
}

export async function listDeployedFunctions(client) {
  const deployed = new Map();
  let pageToken;
  do {
    // apiv2 serializuje undefined jako text "undefined" – první stránka se proto ptá bez pageToken.
    const { body } = await client.get(location + '/functions', { queryParams: pageToken ? { pageSize: 100, pageToken } : { pageSize: 100 } });
    if (body.unreachable?.length) throw new Error('Inventář Functions není úplný.');
    for (const fn of body.functions ?? []) deployed.set(fn.name, fn);
    pageToken = body.nextPageToken;
  } while (pageToken);
  return deployed;
}

export async function functionTargets(client, entryPoints, verify) {
  const deployed = await listDeployedFunctions(client);
  const existing = [];
  const missing = [];
  const special = [];
  for (const entryPoint of entryPoints) {
    if (entryPoint === 'runEventRetention') {
      // Separate release owns the Scheduler job, its identity and retention mode.
      special.push(entryPoint);
      continue;
    }
    const name = location + '/functions/' + entryPoint;
    const fn = deployed.get(name);
    if (entryPoint === 'lockEventQuiz' && fn?.buildConfig?.environmentVariables?.GOOGLE_NODE_RUN_SCRIPTS !== 'gcp-build') {
      throw new Error('Inventář lockEventQuiz neodpovídá D2. Obecné nasazení bylo zastaveno.');
    }
    if (!fn) {
      missing.push(entryPoint);
      continue;
    }
    // Funkce s vlastním sestavením (media worker, gcp-build) obecný artefakt D1 neumí – zůstanou beze změny.
    if (fn.buildConfig?.environmentVariables?.GOOGLE_NODE_RUN_SCRIPTS) {
      special.push(entryPoint);
      continue;
    }
    if (fn.environment !== 'GEN_2' || fn.state !== 'ACTIVE' || fn.buildConfig?.runtime !== 'nodejs22' ||
        fn.buildConfig.entryPoint !== entryPoint || !fn.updateTime) {
      throw new Error('Nelze bezpečně aktualizovat existující Gen 2 funkci ' + entryPoint + '.');
    }
    if (verify) await verify(fn);
    const identity = functionIdentity(fn);
    existing.push({ name, entryPoint, updateTime: fn.updateTime, ...(identity && { identity }) });
  }
  const expected = new Set(entryPoints.map(entryPoint => location + '/functions/' + entryPoint));
  const extra = [...deployed.keys()].filter(name => !expected.has(name)).map(name => name.split('/').at(-1)).sort();
  return { existing, missing, extra, special };
}

export function chooseFunctionPlan(selection, inventory, head, origin = readFunctionOrigin, analyze = analyzeFunctionImpact) {
  if (selection !== '2') return inventory;
  const names = inventory.existing.map(fn => fn.entryPoint);
  const unsafe = [...names, ...inventory.missing].find(name => d2Names.includes(name));
  if (unsafe) throw new Error('Inventář D2 neodpovídá očekávání pro ' + unsafe + '. Připravte nový náhled.');
  const proof = origin(gh, inventory.existing);
  let reason = proof.reason ?? (!shaPattern.test(proof.commit) ? 'Chybí ověřené SHA živého backendu.' : undefined);
  if (inventory.missing.includes('resetEventScores')) reason = 'První vytvoření resetEventScores vyžaduje úplnou aktualizaci zapisovačů.';
  if (reason) return { ...inventory, unchanged: [], fullReason: reason };
  const impact = analyze({ root: ROOT, baseline: proof.commit, target: head, functionNames: names });
  if (impact.mode === 'full') return { ...inventory, unchanged: [], fullReason: impact.reasons.join(' '), baseline: proof.commit };
  const changed = new Set(impact.changed);
  return { ...inventory, existing: inventory.existing.filter(fn => changed.has(fn.entryPoint)),
    unchanged: names.filter(name => !changed.has(name)), baseline: proof.commit };
}

export function describeFunctionPlan(plan) {
  const names = [...plan.existing.map(fn => fn.entryPoint), ...plan.missing].sort();
  return [`Změněné funkce (${names.length}): ${names.join(', ') || '(žádné)'}`, 'Beze změny: ' + plan.unchanged.length,
    ...(plan.baseline ? ['Ověřený commit backendu: ' + plan.baseline] : []),
    ...(plan.fullReason ? ['Důvod plného nasazení: ' + plan.fullReason] : [])].join('\n');
}

export async function deployFunctionPlan(plan, artifact, { prepare = prepareFunctionCreation, deploy, update, verifyCreated, createReset }) {
  if (plan.missing.includes('resetEventScores')) {
    if (plan.missing.length !== 1 || !['saveEventScore', 'saveRefereeScore', 'commitOfflineSync', 'authorizeOfflineEvent',
      'prepareOfflineEvent', 'previewOfflineSync'].every(name => plan.existing.some(fn => fn.entryPoint === name))) {
      throw new Error('Inventář pro první vydání resetEventScores neodpovídá plánu. Zastaveno před zápisem.');
    }
    await update(plan.existing, artifact.zip);
    await createReset(artifact.zip);
    await verifyCreated(['resetEventScores']);
    return;
  }
  if (plan.missing.length) {
    await prepare(artifact);
    await deploy(plan.missing.map(entryPoint => 'functions:' + entryPoint).join(','));
    if (verifyCreated) await verifyCreated(plan.missing);
  }
  if (plan.existing.length) await update(plan.existing, artifact.zip);
}

export async function storageBucketExists(client) {
  let bucket;
  try {
    ({ body: bucket } = await client.get('b/' + BUCKET, { queryParams: { fields: 'name,projectNumber' } }));
  } catch (error) {
    if (error?.status === 404) return false;
    throw error;
  }
  if (bucket?.name !== BUCKET || bucket.projectNumber !== '177615774316') {
    throw new Error('Nepodařilo se ověřit bucket ' + BUCKET + ' v produkčním projektu.');
  }
  return true;
}

export function functionSourcePatch(name, storageSource) {
  return { name, buildConfig: { source: { storageSource } } };
}

async function uploadSource(client, archive, pinned = false) {
  const { body: { uploadUrl, storageSource } } = await client.post(location + '/functions:generateUploadUrl');
  const url = new URL(uploadUrl);
  if (url.origin !== 'https://storage.googleapis.com' || url.username || url.password || url.hash ||
      !storageSource?.bucket || !storageSource.object) throw new Error('Neočekávaná adresa úložiště zdrojů Functions.');
  const pathFromSource = '/' + storageSource.bucket + '/' + storageSource.object;
  if (decodeURIComponent(url.pathname) !== pathFromSource) throw new Error('Podepsaná adresa neodpovídá zdroji Functions.');
  if (!archive.length || archive.length > 104857600) throw new Error('Neplatná velikost archivu Functions.');
  const upload = await fetch(url, {
    method: 'PUT', redirect: 'error', signal: AbortSignal.timeout(120_000),
    headers: { 'content-type': 'application/zip' }, body: archive,
  });
  if (!upload.ok) throw new Error('Nahrání zdroje Functions selhalo (HTTP ' + upload.status + ').');
  const generation = upload.headers.get('x-goog-generation');
  if (generation && /^[1-9]\d*$/u.test(generation)) storageSource.generation = generation;
  if (pinned && !/^[1-9]\d*$/u.test(storageSource.generation)) throw new Error('Chybí neměnná generace nahraného zdroje.');
  return storageSource;
}

async function waitForBuild(operation) {
  const prefix = 'projects/(?:filmovy-kviz-v2-staging|177615774316)/locations/europe-west1/operations/';
  if (!new RegExp('^' + prefix + '[a-zA-Z0-9_-]+$').test(operation.name)) throw new Error('Neočekávaná operace pro Functions.');
  const { pollOperation } = require('firebase-tools/lib/operation-poller');
  return pollOperation({ apiOrigin: functionsOrigin, apiVersion: 'v2', operationResourceName: operation.name, masterTimeout: 900_000 });
}

export async function createPrivateReset(client, storageSource, wait = waitForBuild, onCreated) {
  const name = location + '/functions/resetEventScores';
  const { body: scoring } = await client.get(location + '/functions/saveEventScore');
  const identity = scoring.serviceConfig?.serviceAccountEmail;
  if (scoring.name !== location + '/functions/saveEventScore' || scoring.state !== 'ACTIVE' || !identity?.endsWith('.gserviceaccount.com')) {
    throw new Error('Nepodařilo se ověřit runtime identitu bodování.');
  }
  // Direct Gen 2 CREATE has no setIamPolicy call. Only the later operator step grants public transport.
  const { body: op } = await client.post(location + '/functions', { name, environment: 'GEN_2',
    buildConfig: { runtime: 'nodejs22', entryPoint: 'resetEventScores', source: { storageSource }, environmentVariables: { GOOGLE_NODE_RUN_SCRIPTS: '' } },
    serviceConfig: { serviceAccountEmail: identity, timeoutSeconds: 120 },
    labels: { 'deployment-callable': 'true' } }, { queryParams: { functionId: 'resetEventScores' } });
  const fn = await wait(op);
  if (fn.name !== name || fn.state !== 'ACTIVE' || fn.serviceConfig?.serviceAccountEmail !== identity)
    throw new Error('Vytvoření resetEventScores nebylo potvrzeno.');
  onCreated?.({ result: fn, startedAt: op.metadata?.createTime });
  return fn;
}

async function deployFunctions(client, targets, zip, onUpdated) {
  const storageSource = await uploadSource(client, readFileSync(zip));

  for (let offset = 0; offset < targets.length; offset += FUNCTION_BATCH_SIZE) {
    const batch = await Promise.allSettled(targets.slice(offset, offset + FUNCTION_BATCH_SIZE).map(async target => {
      const { body } = await client.get(target.name);
      if (body.state !== 'ACTIVE' || body.updateTime !== target.updateTime) {
        throw new Error('Funkce ' + target.entryPoint + ' se od náhledu změnila.');
      }
      const { body: operation } = await client.patch(target.name, functionSourcePatch(target.name, storageSource),
        { queryParams: { updateMask: 'buildConfig.source.storageSource' } });
      const fn = await waitForBuild(operation);
      await onUpdated(target, body, fn, operation);
      console.log('Functions hotovo: ' + target.entryPoint);
    }));
    const failure = batch.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
  }
}

// Compare actual operation results with an independent read. A later release may only
// reuse proof if every ordinary function still matches this exact inventory.
export function finishFunctionRelease(before, completed, after, head, record = recordFunctionOrigin, warn = console.warn) {
  const expected = new Map(before.existing.map(fn => [fn.entryPoint, fn.identity]));
  for (const [name, identity] of completed) expected.set(name, identity);
  if (after.missing.length || after.existing.length !== expected.size || !isDeepStrictEqual(before.special, after.special)
    || after.existing.some(fn => !expected.has(fn.entryPoint) || (expected.get(fn.entryPoint) && expected.get(fn.entryPoint) !== fn.identity))) {
    throw new Error('Skutečný stav Functions neodpovídá dokončenému plánu. Web se nenasadil.');
  }
  try {
    if ([...expected.values()].some(identity => !identity)) throw new Error('Chybí jednoznačný doklad revize nebo zdroje.');
    record(gh, head, after.existing, completed.keys());
  } catch (error) {
    warn('Functions byly vydány. Doklad původu se nepodařilo potvrdit: ' + error.message + ' Další volba 2 bez dokladu provede plné nasazení.');
  }
}

// Verify the final inventory before recording it and publishing Hosting.
export async function finishOption2({ functions, entryPoints, inventory, operations, plan, head, readRevision, publishHosting, record }) {
  const planned = [...plan.existing.map(fn => fn.entryPoint), ...plan.missing];
  if (planned.some(name => !operations.has(name)) || operations.size !== planned.length) {
    throw new Error('Chybí výsledek plánované operace Functions.');
  }
  if (operations.size) {
    const completed = new Map();
    const after = await functionTargets(functions, entryPoints, async fn => {
      const name = fn.buildConfig.entryPoint;
      if (!operations.has(name)) return;
      await verifyFunctionRelease(location + '/functions/' + name, operations.get(name), fn, readRevision);
      completed.set(name, functionIdentity(fn));
    });
    if (completed.size !== operations.size) throw new Error('V živém inventáři chybí dokončená funkce.');
    finishFunctionRelease(inventory, completed, after, head, record);
  }
  await publishHosting();
}

function checklist() {
  console.log('\nKontrola po nasazení:');
  console.log('- Titulní stránka ' + LIVE_URL + '/');
  console.log('- Detail existující veřejné akce ' + LIVE_URL + '/events/<id>');
  console.log('- Přihlášení do administrace ' + LIVE_URL + '/admin/login');
}

export function menuAction(selection, options = {}) {
  if (options.mode === '--rollback' && selection === undefined) return 'hosting';
  if (selection === '4' && !options.mode) return 'd2';
  if (['1', '2', '3'].includes(selection)) return 'hosting';
  throw new Error('Neplatná kombinace volby a parametrů nasazení.');
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  if (process.versions.node.split('.')[0] !== '22') throw new Error('Použijte Node.js 22.');
  const head = verifyMain(git, gh);
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Vyžaduje se interaktivní terminál.');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const { Client } = require('firebase-tools/lib/apiv2');
    const runClient = new Client({ urlPrefix: 'https://run.googleapis.com', apiVersion: 'v2' });
    const readRevision = async path => (await runClient.get(path)).body;
    const selection = options.mode === '--rollback' ? undefined : await rl.question(
      'PRODUKCE ' + LIVE_URL + '\n1) Jen web\n2) Web + Functions\n3) Web + Functions + Rules\n4) Speciální funkce D2\nVolba: ');
    if (menuAction(selection, options) === 'd2') {
      console.log(d2Names.map(name => name + (exceptions[name] ? ' — ' + exceptions[name] : '')).join('\n'));
      const choice = (await rl.question('Zadejte název jedné funkce nebo „vše“ pro všechny změněné D2: ')).trim();
      if (choice !== 'vše' && !d2Names.includes(choice)) throw new Error('Neplatný výběr D2.');
      if (exceptions[choice]) throw new Error(exceptions[choice]);
      const proof = name => {
        let record;
        const currentHead = verifyMain(git, gh, (sha, jobs) => {
          record = linuxProof(sha, jobs, id => execFileSync('gh',
            ['api', '--hostname', 'github.com', '--allow-escape-sequences', 'repos/' + REPO + '/actions/jobs/' + id + '/logs'],
            { cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 45_000, maxBuffer: 8 * 1024 * 1024 }), name);
        });
        if (currentHead !== head) throw new Error('Main se změnil.');
        return record;
      };
      const client = await stagingClient(functionsOrigin, 'v2');
      return await releaseSelection({ choice, root: ROOT, head, build: buildLockZip, proof, client, readRevision, history: releaseHistory(historyDirectory()), upload: (api, data) => uploadSource(api, data, true),
        wait: waitForBuild, confirm: phrase => rl.question('Pro změnu jediné produkční funkce napište ' + phrase + ': ') });
    }
    const hosting = await stagingClient('https://firebasehosting.googleapis.com', 'v1beta1');
    const { body: site } = await hosting.get('projects/' + PROJECT + '/sites/' + SITE);
    if (!['projects/' + PROJECT + '/sites/' + SITE, 'projects/177615774316/sites/' + SITE].includes(site.name)) {
      throw new Error('Hosting site není v očekávaném produkčním projektu.');
    }
    const current = async () => hostingRelease((await hosting.get(live)).body.release);
    const prior = await current();
    showRelease(prior);
    const confirm = async () => {
      if (await rl.question('Pro schválený zásah do PRODUKCE napište ANO: ') !== 'ANO') throw new Error('Zrušeno.');
    };
    const recheck = async () => {
      if (verifyMain(git, gh) !== head || !isDeepStrictEqual(await current(), prior)) {
        throw new Error('Zdroj, CI nebo aktivní Hosting se změnil. Připravte nový náhled.');
      }
    };

    if (options.mode === '--rollback') {
      const { body } = await hosting.get(live + '/releases/' + options.release);
      const target = hostingRelease(body);
      if (target.id !== options.release || (target.commit && target.commit !== options.commit) || target.version === prior.version) {
        throw new Error('Požadovaná verze neodpovídá rollbacku nebo již běží.');
      }
      git(['merge-base', '--is-ancestor', options.commit, head]);
      console.log('Vrátí se jen Hosting ' + SITE + ' v projektu ' + PROJECT + ' na ' + target.version);
      await confirm();
      await recheck();
      const { body: restored } = await hosting.post(live + '/releases', { message: messagePrefix + options.commit },
        { queryParams: { versionName: target.version } });
      if (hostingRelease(restored).version !== target.version) throw new Error('Firebase nevrátil očekávanou verzi.');
      checklist();
      return;
    }

    const base = previousCommit(prior, options, head);
    const withFunctions = selection !== '1';
    const withRules = selection === '3';
    const functions = withFunctions ? new Client({ urlPrefix: functionsOrigin, apiVersion: 'v2' }) : undefined;
    const withStorageRules = withRules && await storageBucketExists(
      new Client({ urlPrefix: 'https://storage.googleapis.com', apiVersion: 'storage/v1' }));
    const entryPoints = withFunctions ? exportedFunctions(head) : [];
    const inventory = functions ? await functionTargets(functions, entryPoints) : { existing: [], missing: [], extra: [], special: [] };
    const plan = chooseFunctionPlan(selection, inventory, head);
    if (selection === '2') console.log(describeFunctionPlan(plan));
    console.log('\nNasadí se Hosting site ' + SITE + ' (web) v projektu ' + PROJECT + '.');
    const batches = Math.ceil((plan.existing.length + plan.missing.length) / FUNCTION_BATCH_SIZE);
    const estimate = batches
      ? batches * 2 + '–' + batches * 5 + ' min (orientačně, fronta Cloud Build může dobu prodloužit)'
      : '0 min';
    console.log('Functions k aktualizaci: ' + plan.existing.length + ', k vytvoření: ' + plan.missing.length + '. Odhad doby Functions: ' + estimate + '.');
    if (withFunctions) {
      console.log('Zdroj existujících Functions v ' + REGION + ': ' + plan.existing.map(target => target.entryPoint).join(', '));
      console.log('Chybějící Functions – vytvoří se: ' + (plan.missing.join(', ') || '(žádné)'));
      console.log('Functions navíc – ponechají se beze změny: ' + (plan.extra.join(', ') || '(žádné)'));
      console.log('Functions se samostatným nasazením (vlastní build nebo Scheduler) – ponechají se beze změny: ' + (plan.special.join(', ') || '(žádné)'));
    }
    if (withRules) {
      console.log('Rules: Firestore (default).');
      if (withStorageRules) console.log('Rules: Storage ' + BUCKET + '.');
      else console.log('Bucket ' + BUCKET + ' neexistuje. Pravidla Storage se vynechají.');
    }
    console.log('\nZměněné soubory mezi aktivním zdrojem Hostingu ' + base + ' a main ' + head + ':');
    console.log(git(['-c', 'core.quotepath=true', 'diff', '--name-status', base, head, '--']).trim() || '(žádné)');
    console.log('\nNávrat Hostingu: NASADIT.cmd --rollback ' + prior.id + ' ' + base);
    await confirm();

    const artifact = await prepareArtifact(ROOT, head, await stagingWebConfig(), { withFunctions: !!(plan.existing.length || plan.missing.length), withRules, withStorageRules });
    const deploy = (only, message) => {
      const args = [artifact.cli, 'deploy', '--non-interactive', '--project', PROJECT, '--config', artifact.configName, '--only', only];
      if (message) args.push('--message', message);
      execFileSync(process.execPath, args, { cwd: artifact.source, env: artifact.env, stdio: 'inherit', windowsHide: true });
    };
    const publishHosting = async () => {
      if (!isDeepStrictEqual(await current(), prior)) throw new Error('Aktivní Hosting se během nasazení změnil.');
      deploy('hosting', messagePrefix + head);
      const deployed = await current();
      if (deployed.commit !== head || deployed.id === prior.id) throw new Error('Nové vydání Hostingu se nepodařilo potvrdit.');
      showRelease(deployed);
      checklist();
    };
    try {
      await recheck();
      if (functions) {
        if (!isDeepStrictEqual(await functionTargets(functions, entryPoints), inventory)) throw new Error('Inventář Functions se od náhledu změnil.');
        const completed = new Map();
        const operations = selection === '2' ? new Map() : undefined;
        let creationStarted;
        await deployFunctionPlan(plan, artifact, {
          deploy: only => {
            creationStarted = new Date().toISOString();
            deploy(only);
          },
          createReset: async zip => {
            const fn = await createPrivateReset(functions, await uploadSource(functions, readFileSync(zip), true),
              waitForBuild, operation => operations?.set('resetEventScores', operation));
            if (!operations) completed.set('resetEventScores', functionIdentity(fn));
          },
          verifyCreated: async created => {
            if (operations && creationStarted) {
              const receipts = await createdFunctionOperations(functions, location, created, creationStarted);
              for (const name of created) operations.set(name, receipts.get(location + '/functions/' + name));
            }
            const deployed = await listDeployedFunctions(functions);
            const absent = created.filter(entryPoint => deployed.get(location + '/functions/' + entryPoint)?.state !== 'ACTIVE');
            if (absent.length) throw new Error('Nové Functions nevznikly nebo nejsou ACTIVE: ' + absent.join(', ') + '. Web se nenasadil.');
            for (const entryPoint of created) {
              const fn = deployed.get(location + '/functions/' + entryPoint);
              if (fn.buildConfig?.entryPoint !== entryPoint) throw new Error('Nová funkce má neočekávaný entryPoint.');
              if (operations) {
                await verifyFunctionRelease(location + '/functions/' + entryPoint, operations.get(entryPoint), fn, readRevision);
              } else if (!completed.has(entryPoint)) {
                // Option 3 retains its original CLI creation attestation.
                completed.set(entryPoint, fn.createTime && fn.createTime === fn.updateTime ? functionIdentity(fn) : undefined);
              }
            }
          },
          update: (targets, zip) => deployFunctions(functions, targets, zip, async (target, previous, result, operation) => {
            if (operations) {
              const proof = { previous, result, startedAt: operation.metadata?.createTime };
              await verifyFunctionRelease(target.name, proof, (await functions.get(target.name)).body, readRevision);
              operations.set(target.entryPoint, proof);
            } else {
              if (result.name !== target.name || result.state !== 'ACTIVE' || result.buildConfig?.entryPoint !== target.entryPoint
                || !result.updateTime || result.updateTime === target.updateTime) {
                throw new Error('Nelze potvrdit dokončenou aktualizaci ' + target.entryPoint + '.');
              }
              completed.set(target.entryPoint, updatedFunctionIdentity(previous, result));
            }
          }),
        });
        if (operations) {
          return await finishOption2({ functions, entryPoints, inventory, operations, plan, head, readRevision, publishHosting });
        }
        const planned = [...plan.existing.map(fn => fn.entryPoint), ...plan.missing];
        if (planned.some(name => !completed.has(name))) throw new Error('Chybí výsledek plánované operace Functions.');
        if (completed.size) {
          const after = await functionTargets(functions, entryPoints);
          finishFunctionRelease(inventory, completed, after, head);
        }
      }
      if (withRules) deploy(withStorageRules ? 'firestore:rules,storage' : 'firestore:rules');
      await publishHosting();
    } finally {
      removeArtifact(artifact.directory);
    }
  } finally {
    rl.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch(error => {
    console.error('Zastaveno: ' + error.message);
    process.exitCode = 1;
  });
}
