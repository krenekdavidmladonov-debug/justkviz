import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { stagingClient, stagingWebConfig } from '../staging/cloud.mjs';
import { STAGING_PROJECT as PROJECT } from '../staging/guard.mjs';
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
const gh = endpoint => JSON.parse(execFileSync('gh', ['api', '--hostname', 'github.com', 'repos/' + REPO + '/' + endpoint],
  { cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 45_000 }));

export function verifyMain(readGit, readGitHub) {
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
  if (run?.head_sha !== head || run.head_branch !== 'main' || run.event !== 'push' ||
      run.status !== 'completed' || run.conclusion !== 'success' ||
      !Number.isSafeInteger(run.id) || !Number.isSafeInteger(run.run_attempt)) {
    throw new Error('CI pro přesný push na main nemá výsledek success.');
  }
  const jobs = readGitHub('actions/runs/' + run.id + '/attempts/' + run.run_attempt + '/jobs?per_page=100').jobs;
  if (!jobs?.some(job => job.name === 'Quality gate' && job.status === 'completed' && job.conclusion === 'success')) {
    throw new Error('Quality gate pro aktuální běh CI není zelená.');
  }
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

export async function functionTargets(client, entryPoints) {
  const deployed = await listDeployedFunctions(client);
  const existing = [];
  const missing = [];
  const special = [];
  for (const entryPoint of entryPoints) {
    const name = location + '/functions/' + entryPoint;
    const fn = deployed.get(name);
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
    existing.push({ name, entryPoint, updateTime: fn.updateTime });
  }
  const expected = new Set(entryPoints.map(entryPoint => location + '/functions/' + entryPoint));
  const extra = [...deployed.keys()].filter(name => !expected.has(name)).map(name => name.split('/').at(-1)).sort();
  return { existing, missing, extra, special };
}

export async function deployFunctionPlan(plan, artifact, { prepare = prepareFunctionCreation, deploy, update, verifyCreated }) {
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

async function deployFunctions(client, targets, zip) {
  const { body: { uploadUrl, storageSource } } = await client.post(location + '/functions:generateUploadUrl');
  const url = new URL(uploadUrl);
  if (url.origin !== 'https://storage.googleapis.com' || url.username || url.password || url.hash ||
      !storageSource?.bucket || !storageSource.object) throw new Error('Neočekávaná adresa úložiště zdrojů Functions.');
  const pathFromSource = '/' + storageSource.bucket + '/' + storageSource.object;
  if (decodeURIComponent(url.pathname) !== pathFromSource) throw new Error('Podepsaná adresa neodpovídá zdroji Functions.');
  const archive = readFileSync(zip);
  if (!archive.length || archive.length > 104857600) throw new Error('Neplatná velikost archivu Functions.');
  const upload = await fetch(url, {
    method: 'PUT', redirect: 'error', signal: AbortSignal.timeout(120_000),
    headers: { 'content-type': 'application/zip' }, body: archive,
  });
  if (!upload.ok) throw new Error('Nahrání zdroje Functions selhalo (HTTP ' + upload.status + ').');
  const generation = upload.headers.get('x-goog-generation');
  if (generation && /^\d+$/u.test(generation)) storageSource.generation = generation;
  const { pollOperation } = require('firebase-tools/lib/operation-poller');
  for (let offset = 0; offset < targets.length; offset += FUNCTION_BATCH_SIZE) {
    const batch = await Promise.allSettled(targets.slice(offset, offset + FUNCTION_BATCH_SIZE).map(async target => {
      const { body } = await client.get(target.name);
      if (body.state !== 'ACTIVE' || body.updateTime !== target.updateTime) {
        throw new Error('Funkce ' + target.entryPoint + ' se od náhledu změnila.');
      }
      const { body: operation } = await client.patch(target.name, functionSourcePatch(target.name, storageSource),
        { queryParams: { updateMask: 'buildConfig.source.storageSource' } });
      if (!operation.name?.startsWith(location + '/operations/') &&
          !operation.name?.startsWith('projects/177615774316/locations/' + REGION + '/operations/')) throw new Error('Neočekávaná operace pro ' + target.entryPoint);
      await pollOperation({ apiOrigin: functionsOrigin, apiVersion: 'v2', operationResourceName: operation.name, masterTimeout: 900_000 });
      console.log('Functions hotovo: ' + target.entryPoint);
    }));
    const failure = batch.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
  }
}

function checklist() {
  console.log('\nKontrola po nasazení:');
  console.log('- Titulní stránka ' + LIVE_URL + '/');
  console.log('- Detail existující veřejné akce ' + LIVE_URL + '/events/<id>');
  console.log('- Přihlášení do administrace ' + LIVE_URL + '/admin/login');
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  if (process.versions.node.split('.')[0] !== '22') throw new Error('Použijte Node.js 22.');
  const head = verifyMain(git, gh);
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Vyžaduje se interaktivní terminál.');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const selection = options.mode === '--rollback' ? undefined : await rl.question(
      'PRODUKCE ' + LIVE_URL + '\n1) Jen web\n2) Web + Functions\n3) Web + Functions + Rules\nVolba: ');
    if (selection !== undefined && !['1', '2', '3'].includes(selection)) throw new Error('Neplatná volba.');
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
    const { Client } = require('firebase-tools/lib/apiv2');
    const functions = withFunctions ? new Client({ urlPrefix: functionsOrigin, apiVersion: 'v2' }) : undefined;
    const withStorageRules = withRules && await storageBucketExists(
      new Client({ urlPrefix: 'https://storage.googleapis.com', apiVersion: 'storage/v1' }));
    const entryPoints = withFunctions ? exportedFunctions(head) : [];
    const plan = functions ? await functionTargets(functions, entryPoints) : { existing: [], missing: [], extra: [], special: [] };
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
      console.log('Functions s vlastním sestavením (media worker) – ponechají se beze změny: ' + (plan.special.join(', ') || '(žádné)'));
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

    const artifact = await prepareArtifact(ROOT, head, await stagingWebConfig(), { withFunctions, withRules, withStorageRules });
    const deploy = (only, message) => {
      const args = [artifact.cli, 'deploy', '--non-interactive', '--project', PROJECT, '--config', artifact.configName, '--only', only];
      if (message) args.push('--message', message);
      execFileSync(process.execPath, args, { cwd: artifact.source, env: artifact.env, stdio: 'inherit', windowsHide: true });
    };
    try {
      await recheck();
      if (functions) {
        if (!isDeepStrictEqual(await functionTargets(functions, entryPoints), plan)) throw new Error('Inventář Functions se od náhledu změnil.');
        await deployFunctionPlan(plan, artifact, {
          deploy,
          verifyCreated: async created => {
            const deployed = await listDeployedFunctions(functions);
            const absent = created.filter(entryPoint => deployed.get(location + '/functions/' + entryPoint)?.state !== 'ACTIVE');
            if (absent.length) throw new Error('Nové Functions nevznikly nebo nejsou ACTIVE: ' + absent.join(', ') + '. Web se nenasadil.');
          },
          update: (targets, zip) => deployFunctions(functions, targets, zip),
        });
      }
      if (withRules) deploy(withStorageRules ? 'firestore:rules,storage' : 'firestore:rules');
      if (!isDeepStrictEqual(await current(), prior)) throw new Error('Aktivní Hosting se během nasazení změnil.');
      deploy('hosting', messagePrefix + head);
      const deployed = await current();
      if (deployed.commit !== head || deployed.id === prior.id) throw new Error('Nové vydání Hostingu se nepodařilo potvrdit.');
      showRelease(deployed);
      checklist();
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
