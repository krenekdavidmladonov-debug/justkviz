import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { d2Names, exceptions } from './d2-functions.mjs';
import { buildLockZip, d2Trigger, d2Verification } from './lock-bundle.mjs';
import { FFPROBE_PIN, ffprobeFiles } from './ffprobe-runtime.mjs';

const nativeCache = path.join(process.cwd(), '.tools/d2-ffprobe', FFPROBE_PIN.archiveSha256 + '.tar.xz');

test('all twelve names have exactly the reviewed trigger including securedOnCall wrappers', () => {
  assert.equal(d2Names.length, 12);
  for (const name of d2Names) assert.equal(d2Trigger(name), name === 'processDriveMediaImport' ? 'taskQueueTrigger'
    : ['readQuizMedia', 'driveMediaCompanion'].includes(name) ? 'httpsTrigger' : 'callableTrigger');
  assert.throws(() => d2Trigger('anotherFunction'));
});

test('verification executes and rejects a changed trigger or additional root export', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'justkviz-d2-trigger-'));
  t.after(() => { assert.equal(path.dirname(root), tmpdir()); rmSync(root, { recursive: true, force: true }); });
  mkdirSync(path.join(root, 'lib'));
  const admin = path.join(root, 'node_modules/firebase-admin');
  mkdirSync(admin, { recursive: true });
  writeFileSync(path.join(admin, 'package.json'), JSON.stringify({ type: 'module', exports: { './app': './app.js' } }));
  writeFileSync(path.join(admin, 'app.js'), "export const getApp = () => ({ name: '[DEFAULT]' });");
  writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
  for (const name of ['readQuizMedia', 'lockEventQuiz', 'processDriveMediaImport']) {
    const trigger = d2Trigger(name);
    const endpoint = { platform: 'gcfv2', region: ['europe-west1'], [trigger]: {} };
    writeFileSync(path.join(root, 'verify.mjs'), d2Verification(name));
    const fixture = metadata => `export const ${name}=Object.assign(()=>{}, {__endpoint:${JSON.stringify(metadata)}});`;
    writeFileSync(path.join(root, 'lib/index.js'), fixture(endpoint));
    const run = () => execFileSync(process.execPath, ['verify.mjs'], { cwd: root, stdio: 'pipe' });
    assert.match(run().toString(), /Verified single Gen 2/u);
    writeFileSync(path.join(root, 'lib/index.js'), fixture({ ...endpoint, [trigger]: undefined, wrongTrigger: {} }));
    assert.throws(run);
    writeFileSync(path.join(root, 'lib/index.js'), fixture(endpoint) + '\nexport const unrelated=1;');
    assert.throws(run);
  }
});

test('native exception and unknown name fail before any attempt to read an artifact', async () => {
  assert.deepEqual(Object.keys(exceptions), ['processDriveMediaImport']);
  await assert.rejects(buildLockZip('a'.repeat(40), 'processDriveMediaImport'), /D2_NATIVE_LIMIT/u);
  await assert.rejects(buildLockZip('a'.repeat(40), 'notD2'), /Unknown D2/u);
});

test('native package independently verifies archive, binary ELF/hash and matching complete GPL license', { skip: !existsSync(nativeCache) }, async () => {
  const files = await ffprobeFiles(file => readFileSync(file, 'utf8'));
  const binary = files.get('worker/bin/ffprobe');
  assert.equal(binary.length, FFPROBE_PIN.binaryBytes);
  assert.equal(createHash('sha256').update(binary).digest('hex'), FFPROBE_PIN.binarySha256);
  assert.equal(binary.subarray(1, 4).toString(), 'ELF');
  assert(files.get('worker/licenses/ffprobe-LICENSE.txt').includes('END OF TERMS AND CONDITIONS'));
  const provenance = JSON.parse(files.get('worker/licenses/ffprobe-provenance.json'));
  assert.equal(provenance.assetId, 695397913);
  assert.equal(provenance.version, 'N-128227-g4811625b5f');
  const script = d2Verification('driveMediaCompanion', d2Trigger('driveMediaCompanion'), true);
  assert(script.includes(FFPROBE_PIN.binarySha256));
  assert(script.includes("assert.equal(process.platform, 'linux')"));
  assert(script.includes("await validateLocalOutput({ type: 'youtube', kind: 'video'"));
  assert(script.includes("assert.equal(checked.contentType, 'video/mp4')"));
});
