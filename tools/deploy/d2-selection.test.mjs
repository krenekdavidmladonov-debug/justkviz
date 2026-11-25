import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { releaseHistory, releaseSelection } from './d2-selection.mjs';
import { d2Names, exceptions } from './d2-functions.mjs';
import { resource, REGION_PATH, linuxProof } from './lock-release.mjs';

const head = 'a'.repeat(40);
const available = d2Names.filter(name => !exceptions[name]);
function fixture() {
  const saved = [], patched = [], completed = [], uploaded = [], phrases = [];
  const states = new Map(available.map(name => [resource(name), {
    name: resource(name), environment: 'GEN_2', state: 'ACTIVE', updateTime: '2026-11-01T01:00:00Z',
    buildConfig: { entryPoint: name, runtime: 'nodejs22', environmentVariables: { GOOGLE_NODE_RUN_SCRIPTS: 'gcp-build' },
      source: { storageSource: { bucket: 'source', object: name + '.zip', generation: '1' } } },
    serviceConfig: { revision: name.toLowerCase() + '-00001', service: REGION_PATH + '/services/' + name.toLowerCase() },
  }]));
  const client = {
    get: target => ({ body: structuredClone(states.get(target)) }),
    patch: (target, body, mask) => {
      const fn = states.get(target);
      const name = fn.buildConfig.entryPoint;
      assert.deepEqual(mask, { queryParams: { updateMask: 'buildConfig.source.storageSource' } });
      assert.deepEqual(body, { name: resource(name), buildConfig: { source: { storageSource: {
        bucket: 'source', object: name + '.zip', generation: '2' } } } });
      assert.deepEqual(saved.at(-1), [name, '1']);
      fn.buildConfig.source = body.buildConfig.source;
      fn.updateTime = '2026-11-02T02:00:00Z';
      fn.serviceConfig.revision = name.toLowerCase() + '-00002';
      patched.push(name);
      return { body: { target } };
    },
  };
  const options = { choice: 'vše', head, root: '.', client, log() {}, history: {
    origin: () => head, previous: (name, state) => saved.push([name, state.old.generation]),
    complete: name => completed.push(name) },
    analyze: () => ({ mode: 'partial', changed: ['readQuizMedia', 'createQuizSlide'] }),
    build: (_, name) => ({ bytes: Buffer.from(name) }),
    proof: name => ({ sha: head, size: name.length, digest: createHash('sha256').update(name).digest('hex') }),
    confirm: phrase => { phrases.push(phrase); return phrase; },
    upload: (_, bytes) => { const name = bytes.toString(); uploaded.push(name); return { bucket: 'source', object: name + '.zip', generation: '2' }; },
    wait: op => states.get(op.target) };
  return { options, patched, completed, uploaded, phrases, states };
}

test('one function and all changed D2 use individually confirmed source-only patches', async () => {
  for (const [choice, names] of [['readQuizMedia', ['readQuizMedia']], ['vše', ['readQuizMedia', 'createQuizSlide']]]) {
    const f = fixture();
    await releaseSelection({ ...f.options, choice });
    assert.deepEqual(f.patched, names);
    assert.deepEqual(f.completed, names);
    assert.deepEqual(f.phrases, names.map(name => 'NASADIT ' + name + ' ' + head.slice(0, 12)));
  }
});

test('one unknown baseline selects all eligible functions, an unchanged tree selects none', async () => {
  const f = fixture(); f.options.history.origin = name => name === 'lockEventQuiz' ? undefined : head;
  await releaseSelection(f.options);
  assert.deepEqual(f.patched, available);
  const empty = fixture(); empty.options.analyze = () => ({ mode: 'partial', changed: [] });
  await releaseSelection(empty.options);
  assert.deepEqual(empty.patched, []);
});

test('exceptions, bad names, or missing evidence for a later ZIP stop before the first upload', async () => {
  for (const choice of [...Object.keys(exceptions), 'saveEventScore', '../lockEventQuiz']) {
    const f = fixture();
    await assert.rejects(releaseSelection({ ...f.options, choice }));
    assert.deepEqual(f.uploaded, []);
  }
  const f = fixture();
  const proof = f.options.proof;
  f.options.proof = name => proof(name === 'createQuizSlide' ? 'readQuizMedia' : name);
  await assert.rejects(releaseSelection(f.options));
  assert.deepEqual(f.uploaded, []);
});

test('refusing a later confirmation leaves only the completed target recorded', async () => {
  const f = fixture();
  f.options.confirm = phrase => phrase.includes('createQuizSlide') ? '' : phrase;
  await assert.rejects(releaseSelection(f.options));
  assert.deepEqual(f.patched, ['readQuizMedia']);
  assert.deepEqual(f.completed, f.patched);
});

test('Linux evidence for another target cannot verify an archive', () => {
  const f = fixture(), record = f.options.proof('readQuizMedia');
  const job = { id: 11, name: 'D2 Linux packages', status: 'completed', conclusion: 'success', head_sha: head };
  const line = 'D2_VERIFIED readQuizMedia ' + head + ' ' + record.digest + ' ' + record.size;
  assert.deepEqual(linuxProof(head, [job], () => line, 'readQuizMedia'), record);
  assert.throws(() => linuxProof(head, [job], () => line, 'lockEventQuiz'));
});

test('local origin is specific to the function, immutable source, time and revision', t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'justkviz-d2-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const history = releaseHistory(directory);
  const name = 'readQuizMedia', state = { revision: 'rev', updateTime: 'time', old: { bucket: 'b', object: 'src', generation: '123' } };
  assert.equal(history.origin(name, state), undefined);
  history.previous(name, state, fixture().options.proof(name));
  assert.equal(history.origin(name, state), undefined);
  history.complete(name, state, fixture().options.proof(name));
  assert.equal(history.origin(name, state), head);
  assert.equal(history.origin('createQuizSlide', state), undefined);
  assert.equal(history.origin(name, { ...state, old: { ...state.old, generation: '124' } }), undefined);
});

test('the D2 inventory contains the twelve existing resources and only the native task is excluded', () => {
  assert.deepEqual([...d2Names].sort(), [
    'beginQuizMediaUpload', 'configureDriveMediaCompanion', 'createDriveMediaFolder', 'createQuizSlide',
    'driveMediaCompanion', 'lockEventQuiz', 'processDriveMediaImport', 'readDriveConnection',
    'readDriveMediaImport', 'readQuizMedia', 'requestDriveMediaImport', 'updateQuizSlide',
  ]);
  assert.deepEqual(Object.keys(exceptions), ['processDriveMediaImport']);
});
