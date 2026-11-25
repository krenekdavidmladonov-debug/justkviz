import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const repository = 'krenekdavidmladonov-debug/justkviz';
const workflow = '.github/workflows/ci.yml';
const quickWorkflow = repository + '/.github/workflows/ci-quick.yml';
const shaPattern = /^[0-9a-f]{40}$/u;
const positiveId = n => Number.isSafeInteger(n) && n > 0;
const green = item => item?.status === 'completed' && item.conclusion === 'success';

export const fastJobs = ['CI plan', 'Quick checks / Build and unit tests', 'Dependency security',
  'D2 Linux lockEventQuiz', 'Synthetic email Windows protection and compiler environment'];
export const longJobs = ['Quality access and editor', 'Quality live and registration', 'Quality scoring and results',
  'Editor, owned media and event lifecycle acceptance',
  'SHOW MODE and whole evening acceptance', 'Isolated Windows persistence and recovery acceptance'];

export function attemptJobs(api, run) {
  assert(positiveId(run.id) && positiveId(run.run_attempt), 'Chybí číslo běhu nebo pokusu CI.');
  const result = api('actions/runs/' + run.id + '/attempts/' + run.run_attempt + '/jobs?per_page=100');
  assert(Array.isArray(result.jobs) && result.total_count === result.jobs.length, 'Neúplný seznam kontrol CI.');
  return result.jobs;
}

function job(jobs, run, name, expected = 'success') {
  const matches = jobs.filter(item => item.name === name);
  assert(matches.length === 1 && matches[0].run_id === run.id && matches[0].run_attempt === run.run_attempt
    && matches[0].head_sha === run.head_sha && matches[0].status === 'completed' && matches[0].conclusion === expected,
  'Kontrola „' + name + '“ v aktuálním pokusu CI nemá požadovaný výsledek.');
  return matches[0];
}

export function checkedRun(run, event, head) {
  return green(run) && positiveId(run.id) && positiveId(run.run_attempt) && run.event === event && run.head_sha === head
    && run.path === workflow && run.repository?.full_name === repository && run.head_repository?.full_name === repository;
}

function relatedPR(api, head) {
  const candidates = api('commits/' + head + '/pulls?per_page=100').filter(pr => pr.merged_at && pr.state === 'closed'
    && pr.merge_commit_sha === head && pr.base?.ref === 'main' && pr.base.repo?.full_name === repository
    && pr.head?.repo?.full_name === repository && shaPattern.test(pr.head.sha) && positiveId(pr.number));
  assert.equal(candidates.length, 1, 'Chybí jednoznačně sloučený PR do main.');
  return candidates[0];
}

// GitHub supplies the reusable workflow SHA. A PR run's head_sha alone identifies
// the branch tip, while actions/checkout actually tests refs/pull/<number>/merge.
export function verifiedPrTree(api, pr, tree) {
  assert(shaPattern.test(tree) && shaPattern.test(pr.head.sha));
  const latest = api('actions/workflows/ci.yml/runs?event=pull_request&head_sha=' + pr.head.sha + '&per_page=1').workflow_runs[0];
  assert(latest && positiveId(latest.id), 'Chybí plný běh PR.');
  const run = api('actions/runs/' + latest.id);
  assert(run.id === latest.id && checkedRun(run, 'pull_request', pr.head.sha), 'Poslední CI pro PR není úspěšné.');
  const refs = (run.referenced_workflows ?? []).filter(ref => ref.path.split('@')[0] === quickWorkflow);
  assert(refs.length === 1 && shaPattern.test(refs[0].sha), 'GitHub nepotvrdil commit spuštěného workflow PR.');
  const tested = refs[0].sha;
  assert(refs[0].ref === 'refs/pull/' + pr.number + '/merge' && refs[0].path === quickWorkflow + '@' + tested,
    'Rychlé workflow nepochází z testovacího sloučení tohoto PR.');
  const commit = api('git/commits/' + tested);
  assert(commit.sha === tested && commit.tree?.sha === tree && commit.parents?.length === 2
    && commit.parents[1].sha === pr.head.sha, 'Testovaný strom nebo rodič zkušebního sloučení PR se liší.');
  const jobs = attemptJobs(api, run);
  for (const name of [...fastJobs, ...longJobs]) job(jobs, run, name);
  const gate = job(jobs, run, 'Quality gate');
  const marker = 'Full PR ' + pr.number + ' at ' + tested;
  assert(gate.steps?.filter(step => step.name === marker && green(step)).length === 1, 'Quality gate nepotvrdila plnou sadu pro tento PR a checkout.');
  return 'PR ' + pr.number + ' run ' + run.id + ' attempt ' + run.run_attempt;
}

export function prEvidence(api, head, tree) {
  assert(shaPattern.test(head) && shaPattern.test(tree));
  return verifiedPrTree(api, relatedPR(api, head), tree);
}

export function verifyMainSuite(api, run, jobs, tree) {
  for (const name of fastJobs) job(jobs, run, name);
  const gate = job(jobs, run, 'Quality gate');
  const proofs = (gate.steps ?? []).filter(step => green(step) && (step.name === 'Full main suite' || step.name.startsWith('Reused PR ')));
  assert.equal(proofs.length, 1, 'Quality gate neobsahuje jednoznačný původ plné sady.');
  if (proofs[0].name === 'Full main suite') {
    for (const name of longJobs) job(jobs, run, name);
    return;
  }
  for (const name of longJobs) job(jobs, run, name, 'skipped');
  assert.equal(proofs[0].name, 'Reused ' + prEvidence(api, run.head_sha, tree), 'Nelze doložit stejný strom a stejný plný pokus PR.');
}

export function planMain(api, head, tree, log = console.log) {
  try {
    return { mode: 'reuse', evidence: prEvidence(api, head, tree) };
  } catch (error) {
    log('Na main se spustí plná sada. ' + error.message.split('\n')[0]);
    return { mode: 'full', evidence: '' };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const head = process.env.GITHUB_SHA;
  assert(process.env.GITHUB_EVENT_NAME === 'push' && process.env.GITHUB_REF === 'refs/heads/main' && shaPattern.test(head));
  const git = args => execFileSync('git', args, { encoding: 'utf8' }).trim();
  assert.equal(git(['rev-parse', 'HEAD']), head);
  const api = endpoint => JSON.parse(execFileSync('gh', ['api', '--hostname', 'github.com', 'repos/' + repository + '/' + endpoint],
    { encoding: 'utf8', timeout: 15000, maxBuffer: 4 * 1024 * 1024 }));
  const { mode, evidence } = planMain(api, head, git(['rev-parse', 'HEAD^{tree}']));
  console.log('Rozsah CI: ' + mode + (evidence ? ' (' + evidence + ')' : ''));
  appendFileSync(process.env.GITHUB_OUTPUT, 'mode=' + mode + '\nevidence=' + evidence + '\n');
}
