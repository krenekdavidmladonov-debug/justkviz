'use strict';
// Preload only for the separately approved Functions phase. No standalone deploy.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const policy = require('./restart-deploy-policy.cjs');
const root = path.resolve(__dirname, '../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = file => fs.readFileSync(file);
const json = file => JSON.parse(read(file).toString('utf8'));
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
function unlinked(file) { assert(samePath(fs.realpathSync(file), path.resolve(file)), 'Linked input forbidden'); }
function ignored(file) {
  assert(path.isAbsolute(file));
  const relative = path.relative(root, file);
  assert(relative.startsWith('.local-data' + path.sep) && !relative.split(path.sep).includes('..'));
  unlinked(file);
  execFileSync('git', ['check-ignore', '--', file], { cwd: root, stdio: 'pipe' });
  return file;
}
function referenced(record) {
  assert(record && typeof record.path === 'string' && /^[a-f0-9]{64}$/u.test(record.sha256));
  const file = ignored(record.path); assert.equal(hash(read(file)), record.sha256, 'Evidence hash changed');
  return file;
}
assert.equal(process.versions.node.split('.')[0], '22');
for (const [key, value] of Object.entries(process.env)) {
  if (!value) continue;
  assert(!/EMULATOR|^(?:FIREBASE_CONFIG|FIREBASE_TOKEN|GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_CLOUD_QUOTA_PROJECT|NODE_OPTIONS|FIREBASE_CLI_EXPERIMENTS)$|(?:FIREBASE|CLOUD_RUN|EVENTARC|FIRESTORE|PUBSUB|STORAGE|IAM|COMPUTE).*_(?:URL|ORIGIN)$/u.test(key), `Unexpected override: ${key}`);
  if (['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'FIREBASE_PROJECT_ID'].includes(key)) assert.equal(value, policy.PROJECT);
}
const artifact = process.env.RESTART_ARTIFACT_DIR, envelopePath = process.env.RESTART_DEPLOY_EVIDENCE;
assert(artifact && envelopePath, 'RESTART_ARTIFACT_DIR and RESTART_DEPLOY_EVIDENCE paths required');
assert(samePath(artifact, path.join(root, '.local-data/restart-release', policy.RELEASE_SHA)));
unlinked(artifact);
const receiptBytes = read(path.join(artifact, 'receipt.json'));
assert.equal(hash(receiptBytes), policy.RECEIPT_SHA256, 'Exact frozen receipt required');
const receipt = JSON.parse(receiptBytes);
assert.equal(receipt.releaseSha, policy.RELEASE_SHA); assert.equal(receipt.projectId, policy.PROJECT);
assert.equal(receipt.mode, 'PREPARED_NOT_DEPLOYED'); assert.equal(receipt.cloudWritesApproved, false);
const expectedNames = json(path.join(root, 'tools/staging/restart-release-manifest.json')).functions;
assert.equal(expectedNames.length, 70); assert.equal(new Set(expectedNames).size, 70);
policy.namesEqual(receipt.functions, expectedNames);
const envelope = json(ignored(envelopePath));
policy.evidenceEnvelope(envelope);
const ciFile = referenced(envelope.ci), ci = json(ciFile);
const tree = execFileSync('git', ['rev-parse', policy.RELEASE_SHA + '^{tree}'], { cwd: root, encoding: 'utf8' }).trim();
assert.equal(ci.mode, 'REMOTE_SUCCESSOR_CI_VERIFIED_NOT_MERGED_OR_DEPLOYED');
assert.equal(ci.releaseSha, policy.RELEASE_SHA); assert.equal(ci.artifactReceiptSha256, policy.RECEIPT_SHA256);
assert.equal(ci.sourceTreeEqual, true); assert.equal(ci.actualCheckoutTree, tree); assert.match(ci.actualCheckoutSha, /^[a-f0-9]{40}$/u);
assert.equal(ci.project, 'krenekdavidmladonov-debug/filmovy-kviz-v2'); assert.equal(ci.pullRequest, 39);
assert.deepEqual(ci.jobs.map(j => j.workflow).sort(), ['CI', 'Operator owner takeover']);
for (const job of ci.jobs) {
  assert(job.steps.length > 0 && job.steps.every(step => step.conclusion === 'success'));
  assert(job.checkoutEvidence.length > 0 && job.checkoutEvidence.every(line => line.endsWith('Z ' + ci.actualCheckoutSha)));
  for (const [name, expected] of [[job.metadata, job.metadataSha256], [job.log, job.logSha256]]) {
    assert(typeof name === 'string' && path.basename(name) === name);
    assert.equal(hash(read(ignored(path.join(path.dirname(ciFile), name)))), expected);
  }
  assert(['.github/workflows/ci.yml', '.github/workflows/owner-takeover.yml'].includes(job.workflowFile));
  assert.equal(hash(execFileSync('git', ['show', policy.RELEASE_SHA + ':' + job.workflowFile], { cwd: root })), job.workflowSourceSha256);
  const metadata = json(path.join(path.dirname(ciFile), job.metadata));
  assert.equal(metadata.headSha, policy.RELEASE_SHA); assert.equal(metadata.status, 'completed'); assert.equal(metadata.conclusion, 'success');
}
const pauseFile = referenced(envelope.pause);
const pauseApprovalFile = referenced({ path: envelope.pause.approvalPath, sha256: envelope.pause.approvalSha256 });
const { pausePlan } = require('../access/pause-collaboration-core.mjs');
const pausePlanValue = pausePlan(json(pauseApprovalFile));
assert.equal(pausePlanValue.approval.projectId, policy.PROJECT); assert.equal(pausePlanValue.approval.releaseSha, policy.RELEASE_SHA);
const pauseLines = read(pauseFile).toString('utf8').trim().split(/\r?\n/u).map(line => JSON.parse(line));
const pause = pauseLines.at(-1);
assert(['APPLIED', 'ALREADY_APPLIED'].includes(pause.mode), 'Completed pause receipt required');
assert(pauseLines.every(row => row.projectId === policy.PROJECT && row.releaseSha === policy.RELEASE_SHA));
assert.equal(pause.planSha256, pausePlanValue.planSha256); assert.equal(pause.auditName, pausePlanValue.auditName);
const preflight = json(referenced(envelope.preflight));
assert(typeof pause.controlUpdateTime === 'string', 'Audited control updateTime required');
policy.freshPreflight(preflight, expectedNames, pausePlanValue.approval.expectedRevision, pause.controlUpdateTime);
assert(samePath(process.cwd(), artifact), 'CLI cwd must be exact frozen artifact');
const cliPath = require.resolve('firebase-tools/lib/bin/firebase.js');
assert(samePath(fs.realpathSync(process.argv[1]), fs.realpathSync(cliPath)));
assert.deepEqual(process.argv.slice(2), receipt.phases[0], 'Only exact receipt Functions phase accepted');
assert.equal(require('firebase-tools/package.json').version, '15.34.2', 'Pinned CLI required');
function checkArtifact() {
  assert.equal(hash(read(path.join(artifact, 'receipt.json'))), policy.RECEIPT_SHA256);
  const actual = {};
  function walk(directory, prefix = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (name === 'functions/node_modules' || name === 'receipt.json' || name === 'firebase-debug.log' || name === '.firebase') continue;
      assert(!entry.isSymbolicLink(), 'Artifact link forbidden');
      if (entry.isDirectory()) walk(path.join(directory, entry.name), name + '/');
      else actual[name] = hash(read(path.join(directory, entry.name)));
    }
  }
  walk(artifact); assert.deepEqual(actual, receipt.checksums, 'Artifact file set/hash changed');
}
checkArtifact();
const logFile = path.join(path.dirname(envelopePath), 'restart-deploy-' + Date.now() + '-' + require('node:crypto').randomUUID() + '.jsonl');
unlinked(path.dirname(logFile));
const fd = fs.openSync(logFile, 'wx');
const log = (event, details = {}) => { fs.writeSync(fd, JSON.stringify({ at: new Date().toISOString(), releaseSha: policy.RELEASE_SHA, receiptSha256: policy.RECEIPT_SHA256, event, ...details }) + '\n'); fs.fsyncSync(fd); };
log('guard-loaded', { projectId: policy.PROJECT, region: policy.REGION, functions: 70, evidenceSha256: hash(read(envelopePath)) });
const cli = name => require('firebase-tools/lib/' + name);
policy.install({ cli, names: expectedNames, checkArtifact, log, operatorEmail: pausePlanValue.approval.operatorEmail });
process.on('exit', code => { log('process-exit', { code }); fs.closeSync(fd); });
