import assert from 'node:assert/strict';
import test from 'node:test';
import { validateAccessHotfix } from '../../tools/access/p1-hotfix-policy.mjs';

const hash = letter => letter.repeat(64);
const webPaths = ['apps/web/src/routes/admin/UsersAccessPage.tsx', 'apps/web/src/features/access/api.ts'];
function plan(hosting = false) {
  const baselineEntries = { 'lib/access/callables.js': hash('a'), 'lib/index.js': hash('b'), 'package.json': hash('c'), 'package-lock.json': hash('d'), 'vendor/domain.js': hash('e') };
  const value = { projectId: 'filmovy-kviz-v2-staging', region: 'europe-west1', site: 'justkviz-v2', functions: ['listAccessUsers', 'listAccessAudit'], baselineEntries, candidateEntries: { ...baselineEntries, 'lib/access/callables.js': hash('f') } };
  if (hosting) {
    const baseline = Object.fromEntries([...webPaths, 'apps/web/package.json', 'pnpm-lock.yaml', 'apps/web/src/app/router.tsx'].map(path => [path, hash('a')]));
    value.hostingSources = { baseline, candidate: { ...baseline, ...Object.fromEntries(webPaths.map(path => [path, hash('b')])) } };
  }
  return value;
}

test('accepts only the minimal callable content change without authorizing release', () => {
  const input = plan(), snapshot = structuredClone(input), result = validateAccessHotfix(input);
  assert.deepEqual(input, snapshot); assert.equal(result.approved, false); assert.equal(result.resources.hosting, false);
  assert.deepEqual(result.resources.functions, ['listAccessAudit', 'listAccessUsers']);
  assert.deepEqual(result.changes, { functions: ['lib/access/callables.js'], hosting: [] });
  for (const value of [result, result.target, result.resources, result.resources.functions, result.changes, result.changes.functions, result.changes.hosting]) assert(Object.isFrozen(value));
  assert.throws(() => { result.resources.functions.push('createAccessInvitation'); }, TypeError);
});

test('accepts the complete two-file hosting fix with all other source/dependency bytes unchanged', () => {
  const input = plan(true);
  input.hostingSources.baseline['apps/web/.env.example'] = hash('a'); input.hostingSources.candidate['apps/web/.env.example'] = hash('a');
  const result = validateAccessHotfix(input);
  assert.equal(result.resources.hosting, true); assert.deepEqual(result.changes.hosting, [...webPaths].sort());
  const nullMaps = plan(); nullMaps.baselineEntries = Object.assign(Object.create(null), nullMaps.baselineEntries);
  nullMaps.candidateEntries = Object.assign(Object.create(null), nullMaps.candidateEntries);
  assert.equal(validateAccessHotfix(nullMaps).approved, false);
});

test('rejects foreign project, region, site and unknown approval or deployment fields', () => {
  for (const patch of [{ projectId: 'production' }, { region: 'us-central1' }, { site: 'other' }, { approved: true }, { deploy: true }]) {
    assert.throws(() => validateAccessHotfix({ ...plan(), ...patch }), TypeError);
  }
});

test('rejects extra, missing, duplicate, sparse or malformed function inventories', () => {
  const sparse = Array(2); sparse[0] = 'listAccessAudit';
  for (const functions of [[], ['listAccessAudit'], ['listAccessAudit', 'listAccessUsers', 'createAccessInvitation'], ['listAccessAudit', 'listAccessAudit'], sparse, 'listAccessAudit,listAccessUsers', {}, null]) {
    assert.throws(() => validateAccessHotfix({ ...plan(), functions }), TypeError);
  }
});

test('rejects full-candidate backend changes, entrypoint/dependency/vendor changes and no-op fixes', () => {
  for (const path of ['lib/index.js', 'package.json', 'package-lock.json', 'vendor/domain.js']) {
    const input = plan(); input.candidateEntries[path] = hash('f'); assert.throws(() => validateAccessHotfix(input), TypeError);
  }
  const unchanged = plan(); unchanged.candidateEntries = { ...unchanged.baselineEntries };
  assert.throws(() => validateAccessHotfix(unchanged), TypeError);
});

test('rejects missing mandatory bundle files and any added or removed manifest entry', () => {
  for (const required of ['lib/access/callables.js', 'lib/index.js', 'package.json', 'package-lock.json']) {
    const input = plan(); delete input.baselineEntries[required]; delete input.candidateEntries[required];
    assert.throws(() => validateAccessHotfix(input), TypeError);
  }
  const added = plan(); added.candidateEntries['lib/unrelated.js'] = hash('a'); assert.throws(() => validateAccessHotfix(added), TypeError);
  const removed = plan(); delete removed.candidateEntries['vendor/domain.js']; assert.throws(() => validateAccessHotfix(removed), TypeError);
});

test('rejects unrelated hosting source, config/dependency changes, partial fixes and inventory drift', () => {
  for (const path of ['apps/web/package.json', 'pnpm-lock.yaml', 'apps/web/src/app/router.tsx', ...webPaths]) {
    const input = plan(true);
    input.hostingSources.candidate[path] = webPaths.includes(path) ? hash('a') : hash('f');
    assert.throws(() => validateAccessHotfix(input), TypeError);
  }
  const added = plan(true); added.hostingSources.candidate['firebase.json'] = hash('a'); assert.throws(() => validateAccessHotfix(added), TypeError);
  const removed = plan(true); delete removed.hostingSources.candidate['pnpm-lock.yaml']; assert.throws(() => validateAccessHotfix(removed), TypeError);
  const extra = plan(true); extra.hostingSources.approved = true; assert.throws(() => validateAccessHotfix(extra), TypeError);
});

test('rejects malformed hashes, noncanonical paths, traversal, aliases and reserved prototype keys', () => {
  for (const path of ['../escape.js', '/absolute.js', 'C:/absolute.js', 'lib\\index.js', './lib/index.js', 'lib/../index.js', 'lib//index.js', 'lib/./index.js', '__proto__', 'constructor', 'prototype']) {
    const input = plan(); Object.defineProperty(input.baselineEntries, path, { value: hash('a'), enumerable: true });
    Object.defineProperty(input.candidateEntries, path, { value: hash('a'), enumerable: true });
    assert.throws(() => validateAccessHotfix(input), TypeError);
  }
  const duplicate = plan(); duplicate.baselineEntries['LIB/index.js'] = hash('a'); duplicate.candidateEntries['LIB/index.js'] = hash('a');
  assert.throws(() => validateAccessHotfix(duplicate), TypeError);
  for (const value of ['a'.repeat(63), 'A'.repeat(64), 'z'.repeat(64), 42, null, {}]) {
    const input = plan(); input.candidateEntries['lib/access/callables.js'] = value;
    assert.throws(() => validateAccessHotfix(input), TypeError);
  }
});

test('rejects arrays, missing fields, inherited values, accessors and hidden/symbol properties without invoking accessors', () => {
  for (const value of [null, [], {}, Object.create(plan()), { ...plan(), baselineEntries: [] }, { ...plan(), candidateEntries: {} }, { ...plan(), hostingSources: null }]) {
    assert.throws(() => validateAccessHotfix(value), TypeError);
  }
  const inherited = plan(); inherited.baselineEntries = Object.assign(Object.create({ unexpected: hash('a') }), inherited.baselineEntries);
  assert.throws(() => validateAccessHotfix(inherited), TypeError);
  let invoked = false;
  for (const target of ['plan', 'manifest', 'functions0', 'functions1']) {
    const input = plan(); const object = target === 'plan' ? input : target === 'manifest' ? input.candidateEntries : input.functions;
    const key = target === 'plan' ? 'projectId' : target === 'manifest' ? 'lib/access/callables.js' : target === 'functions0' ? '0' : '1';
    Object.defineProperty(object, key, { get: () => { invoked = true; return 'unsafe'; }, enumerable: true });
    assert.throws(() => validateAccessHotfix(input), TypeError);
  }
  assert.equal(invoked, false);
  for (const key of ['hidden', Symbol('unexpected')]) {
    const input = plan(); Object.defineProperty(input, key, { value: true }); assert.throws(() => validateAccessHotfix(input), TypeError);
  }
});
