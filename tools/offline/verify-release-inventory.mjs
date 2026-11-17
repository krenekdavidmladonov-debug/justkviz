import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sanitizedEnvironment } from '../event-night/restart-acceptance.mjs';
import { STAGING_PROJECT } from '../staging/guard.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const json = file => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
const inventory = json('tools/offline/deployment-manifest.json');
const hosting = json(inventory.hostingConfig);
const names = [...inventory.newCallableFunctions, ...inventory.existingFunctionsToUpdate];
const allNames = [...names, ...inventory.compatibleMediaPrerequisitesIfMissing, ...inventory.compatibleDeletionRegistryIfMissing];
const key = 'JUSTKVIZ_OFFLINE_SIGNING_KEY';
const driveKeys = ['DRIVE_OAUTH_CLIENT_SECRET', 'DRIVE_TOKEN_KEYRING'];
const args = process.argv.slice(2).filter(argument => argument !== '--inspect');
assert(args.length === 0 || (args.length === 2 && args[0] === '--package'));
const bundle = args.length ? realpathSync(args[1]) : undefined;
if (bundle) {
  const parent = realpathSync(path.join(root, '.local-data/offline-release'));
  assert.equal(path.dirname(bundle), parent);
  assert(/^[a-f0-9]{40}-(?:disabled|enabled|recovery)(?:-synthetic)?$/u.test(path.basename(bundle)));
}

assert.equal(inventory.projectId, STAGING_PROJECT);
assert.equal(inventory.hostingSite, 'justkviz-v2');
assert.deepEqual(inventory.origins, ['https://justkviz.cz', 'https://justkviz-v2.web.app']);
assert.deepEqual(Object.keys(hosting), ['hosting']);
assert.equal(hosting.hosting.site, inventory.hostingSite);
assert.equal(hosting.hosting.public, 'apps/web/dist');
const indexExclusions = hosting.hosting.headers.flatMap(rule => rule.headers
  .filter(header => header.key.toLowerCase() === 'x-robots-tag')
  .map(header => ({ source: rule.source, value: header.value })));
assert.deepEqual(indexExclusions, [{
  source: '/{admin,admin/**,projector,projector/**,referee,referee/**,account,invite,invite/**,events/*/registration/**,offline.html}',
  value: 'noindex, nofollow',
}]);
assert.equal(new Set(names).size, 6);
assert.equal(inventory.default, 'disabled');

if (process.argv[2] === '--inspect') {
  assert.equal(process.env.EVENT_NIGHT_RESTART_NETWORK_GUARD, '1');
  const sdk = await import(pathToFileURL(path.join(bundle ?? root, 'functions/lib/index.js')));
  const expected = bundle ? json(path.relative(root, path.join(bundle, 'receipt.json'))).exports : allNames;
  assert.deepEqual([...expected].sort(), [...allNames].filter(name => !bundle || bundle.endsWith('-synthetic')
    || !inventory.compatibleMediaPrerequisitesIfMissing.includes(name)).sort());
  if (bundle) assert.deepEqual(Object.keys(sdk).sort(), [...expected].sort());
  const endpoints = Object.fromEntries(expected.map(name => {
    const entry = sdk[name]?.__endpoint;
    assert(entry, 'Missing SDK endpoint: ' + name);
    assert.deepEqual(entry.region, [inventory.region]);
    assert.equal(entry.platform, 'gcfv2');
    if (name === 'readQuizMedia') assert(entry.httpsTrigger);
    else assert(entry.callableTrigger);
    return [name, (entry.secretEnvironmentVariables ?? []).map(secret => secret.key)];
  }));
  console.log(JSON.stringify(endpoints));
} else {
  const proof = {};
  for (const mode of ['disabled', 'enabled', 'recovery', 'enabled-all', 'recovery-all']) for (const drive of ['false', 'true']) {
    const env = sanitizedEnvironment(path.join(root, '.local-data'), STAGING_PROJECT, process.env);
    for (const name of Object.keys(env)) {
      if (name.endsWith('_EMULATOR_HOST') || name.startsWith('JUSTKVIZ_OFFLINE_')) delete env[name];
    }
    Object.assign(env, {
      GCLOUD_PROJECT: STAGING_PROJECT,
      GOOGLE_CLOUD_PROJECT: STAGING_PROJECT,
      FIREBASE_CONFIG: JSON.stringify({ projectId: STAGING_PROJECT, storageBucket: STAGING_PROJECT + '.firebasestorage.app' }),
      DRIVE_CONNECTION_ENABLED: drive,
      JUSTKVIZ_OFFLINE_ENABLED: mode === 'disabled' ? 'false' : 'true',
      JUSTKVIZ_OFFLINE_RECOVERY_ONLY: mode.startsWith('recovery') ? 'true' : 'false',
      ...(mode.endsWith('-all') ? { JUSTKVIZ_OFFLINE_ALL_ELIGIBLE_EVENTS: 'true' }
        : { JUSTKVIZ_OFFLINE_EVENT_IDS: 'synthetic-discovery-only' }),
    });
    const bindings = JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--inspect', ...args],
      { cwd: root, env, encoding: 'utf8', windowsHide: true }));
    for (const name of Object.keys(bindings)) {
      const expected = name === 'readQuizMedia' && drive === 'true' ? driveKeys :
        mode.startsWith('enabled') && ['readOfflineTrust', 'prepareOfflineEvent'].includes(name) ? [key] : [];
      assert.deepEqual(bindings[name], expected, name + ' ' + mode + ' Drive ' + drive);
    }
    proof[mode + '-drive-' + drive] = bindings;
  }
  console.log((bundle ? 'OFFLINE_PACKAGED_SDK_DISCOVERY_PASS ' : 'OFFLINE_SDK_DISCOVERY_PASS ') + JSON.stringify(proof));
}
