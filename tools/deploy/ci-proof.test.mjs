import test from 'node:test';
import assert from 'node:assert/strict';
import { attemptJobs, fastJobs, longJobs, planMain, repository, verifyMainSuite } from './ci-proof.mjs';

const main = '1'.repeat(40), head = '2'.repeat(40), merge = '3'.repeat(40), tree = '4'.repeat(40);
const evidence = 'PR 81 run 30 attempt 2';
const pr = { number: 81, state: 'closed', merged_at: '2026-11-25T10:00:00Z', merge_commit_sha: main,
  head: { sha: head, repo: { full_name: repository } }, base: { ref: 'main', repo: { full_name: repository } } };
const run = { id: 30, run_attempt: 2, status: 'completed', conclusion: 'success', event: 'pull_request', head_sha: head,
  path: '.github/workflows/ci.yml', repository: { full_name: repository }, head_repository: { full_name: repository },
  referenced_workflows: [{ path: repository + '/.github/workflows/ci-quick.yml@refs/pull/81/merge', sha: merge }] };
const push = { ...run, id: 90, event: 'push', head_sha: main };
const step = name => ({ name, status: 'completed', conclusion: 'success' });

function jobsFor(run, mode) {
  const jobs = [...fastJobs, ...longJobs, 'Quality gate'].map(name => ({ name, run_id: run.id, run_attempt: run.run_attempt,
    head_sha: run.head_sha, status: 'completed', conclusion: mode === 'reuse' && longJobs.includes(name) ? 'skipped' : 'success' }));
  jobs.at(-1).steps = [step(run.event === 'pull_request' ? 'Full PR 81 at ' + merge : mode === 'full' ? 'Full main suite' : 'Reused ' + evidence)];
  return jobs;
}

function setup() {
  const tested = { sha: merge, tree: { sha: tree }, parents: [{ sha: '5'.repeat(40) }, { sha: head }] };
  const jobs = jobsFor(run, 'full');
  const urls = {
    pulls: 'commits/' + main + '/pulls?per_page=100',
    candidates: 'actions/workflows/ci.yml/runs?event=pull_request&head_sha=' + head + '&per_page=1',
    prRun: 'actions/runs/30', tested: 'git/commits/' + merge, jobs: 'actions/runs/30/attempts/2/jobs?per_page=100',
  };
  const data = structuredClone({ [urls.pulls]: [pr], [urls.candidates]: { workflow_runs: [run] }, [urls.prRun]: run,
    [urls.tested]: tested, [urls.jobs]: { total_count: jobs.length, jobs } });
  const api = path => { assert(Object.hasOwn(data, path), 'Unexpected GitHub API call ' + path); return data[path]; };
  return { api, data, urls, jobs: data[urls.jobs].jobs, pr: data[urls.pulls][0], run: data[urls.prRun], tested: data[urls.tested] };
}

test('reuses a merged PR whose tested merge and final main SHA differ but whose immutable trees match', () => {
  const s = setup();
  assert.deepEqual(planMain(s.api, main, tree), { mode: 'reuse', evidence });
  verifyMainSuite(s.api, push, jobsFor(push, 'reuse'), tree);
});

test('main can independently pass the full suite without access to any PR', () => {
  verifyMainSuite(() => assert.fail('unnecessary PR lookup'), push, jobsFor(push, 'full'), tree);
});

const variants = [
  ['different main tree', s => { s.tested.tree.sha = head; }],
  ['wrong tested parent', s => { s.tested.parents[1].sha = main; }],
  ['wrong commit from API', s => { s.tested.sha = head; }],
  ['missing GitHub workflow SHA', s => { s.run.referenced_workflows = []; }],
  ['incorrect PR marker', s => { s.jobs.at(-1).steps = [step('Full PR 82 at ' + merge)]; }],
  ['closed but unmerged PR', s => { s.pr.merged_at = null; }],
  ['another base branch', s => { s.pr.base.ref = 'stage'; }],
  ['fork PR', s => { s.pr.head.repo.full_name = 'another/repo'; }],
  ['wrong merged commit', s => { s.pr.merge_commit_sha = head; }],
  ['more than one associated merged PR', s => { s.data[s.urls.pulls].push(s.pr); }],
  ['different workflow file', s => { s.run.path = '.github/workflows/other.yml'; }],
  ['wrong event', s => { s.run.event = 'push'; }],
  ['different head', s => { s.run.head_sha = main; }],
  ['unsuccessful PR run', s => { s.run.conclusion = 'failure'; }],
  ['new attempt in progress', s => { s.run.status = 'in_progress'; }],
  ['skipped PR test', s => { s.jobs[fastJobs.length].conclusion = 'skipped'; }],
  ['cancelled PR test', s => { s.jobs[0].conclusion = 'cancelled'; }],
  ['job in a previous attempt', s => { s.jobs[0].run_attempt = 1; }],
  ['job in another run', s => { s.jobs[0].run_id = push.id; }],
  ['duplicate job', s => { s.jobs.push(s.jobs[0]); s.data[s.urls.jobs].total_count++; }],
  ['incomplete job page', s => { s.data[s.urls.jobs].total_count++; }],
  ['unavailable GitHub API', s => { s.api = () => { throw new Error('HTTP 503'); }; }],
];
for (const [reason, change] of variants) {
  test(reason + ' selects full main CI and refuses deployment of a reused result', () => {
    const s = setup(); change(s);
    assert.deepEqual(planMain(s.api, main, tree, () => {}), { mode: 'full', evidence: '' });
    assert.throws(() => verifyMainSuite(s.api, push, jobsFor(push, 'reuse'), tree));
  });
}

test('a successful gate cannot cover missing fresh jobs, a skipped full test or ambiguous proof', () => {
  for (const mode of ['full', 'reuse']) {
    for (const name of fastJobs) {
      const jobs = jobsFor(push, mode);
      jobs.find(j => j.name === name).conclusion = 'skipped';
      assert.throws(() => verifyMainSuite(setup().api, push, jobs, tree));
    }
    const jobs = jobsFor(push, mode);
    jobs.at(-1).steps.push(step('Full main suite'));
    assert.throws(() => verifyMainSuite(setup().api, push, jobs, tree));
  }
  const jobs = jobsFor(push, 'full');
  jobs.find(j => j.name === 'Quality core').conclusion = 'skipped';
  assert.throws(() => verifyMainSuite(setup().api, push, jobs, tree));
  const reused = jobsFor(push, 'reuse');
  reused.at(-1).steps = [step('Reused PR 81 run 30 attempt 1')];
  assert.throws(() => verifyMainSuite(setup().api, push, reused, tree));
  assert.throws(() => attemptJobs(() => ({}), push));
});
