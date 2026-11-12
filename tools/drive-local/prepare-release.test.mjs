import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { releaseEntry, releaseGuard, TARGETS } from './prepare-release.mjs';

const manifest = JSON.parse(readFileSync(new URL('./deployment-manifest.json', import.meta.url), 'utf8'));
test('local companion release limits deployment package exports to two new and four updated V2 functions', () => {
  assert.deepEqual(TARGETS, ['configureDriveMediaCompanion', 'driveMediaCompanion', 'requestDriveMediaImport',
    'readDriveMediaImport', 'processDriveMediaImport', 'readDriveConnection']);
  assert.deepEqual(manifest.functions, TARGETS);
  assert.deepEqual([...manifest.newFunctions, ...manifest.updatedFunctions], TARGETS);
  assert.equal(manifest.projectId, 'filmovy-kviz-v2-staging');
  assert.equal(manifest.hostingSite, 'justkviz-v2');
  assert.equal(manifest.mediaImportEnabledByDefault, false);
  assert.equal(manifest.firestoreRulesChanged, false);
  assert.equal(manifest.storageRulesChanged, false);
  assert.deepEqual(manifest.newConfiguration, ['DRIVE_MEDIA_LOCAL_ENABLED']);
});
test('builder refuses dirty or unrelated source, branch and node runtime', () => {
  const state = { sha: 'a'.repeat(40), head: 'a'.repeat(40), branch: 'codex/local-drive-companion', status: '', node: '22.23.2' };
  assert.doesNotThrow(() => releaseGuard(state));
  for (const patch of [{ branch: 'main' }, { head: 'b'.repeat(40) }, { status: ' M file.ts' }, { node: '24.0.0' }]) {
    assert.throws(() => releaseGuard({ ...state, ...patch }));
  }
});
test('release entry has exact reviewed endpoints, no unrelated deployed functions', () => {
  const source = readFileSync(new URL('../../functions/src/index.ts', import.meta.url), 'utf8');
  const entry = releaseEntry(source, TARGETS);
  assert.match(entry, /^import '\.\/bootstrap-admin.js';/u);
  assert.ok(!entry.includes('deliverEmailTask') && !entry.includes('createQuizSlide') && !entry.includes('health'));
  assert.throws(() => releaseEntry(source.replace('configureDriveMediaCompanion,', ''), TARGETS));
  assert.throws(() => releaseEntry(source, [...TARGETS, 'health']));
});
