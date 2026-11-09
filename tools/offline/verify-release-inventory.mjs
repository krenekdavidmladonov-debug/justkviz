import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sanitizedEnvironment } from '../event-night/restart-acceptance.mjs';
import { STAGING_PROJECT } from '../staging/guard.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const json = file => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
const inventory = json('tools/offline/deployment-manifest.json');
const hosting = json(inventory.hostingConfig);
const names = [...inventory.newCallableFunctions, ...inventory.existingFunctionsToUpdate];
const key = 'JUSTKVIZ_OFFLINE_SIGNING_KEY';

assert.equal(inventory.projectId, STAGING_PROJECT);
assert.equal(inventory.hostingSite, 'justkviz-v2');
assert.equal(inventory.origin, 'https://justkviz-v2.web.app');
assert.deepEqual(Object.keys(hosting), ['hosting']);
assert.equal(hosting.hosting.site, inventory.hostingSite);
assert.equal(hosting.hosting.public, 'apps/web/dist');
assert.equal(new Set(names).size, 6);
assert.equal(inventory.default, 'disabled');

if (process.argv[2] === '--inspect') {
  assert.equal(process.env.EVENT_NIGHT_RESTART_NETWORK_GUARD, '1');
  const sdk = await import(pathToFileURL(path.join(root, 'functions/lib/index.js')));
  const endpoints = Object.fromEntries(names.map(name => {
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
  for (const mode of ['disabled', 'enabled', 'recovery']) {
    const env = sanitizedEnvironment(path.join(root, '.local-data'), STAGING_PROJECT, process.env);
    for (const name of Object.keys(env)) {
      if (name.endsWith('_EMULATOR_HOST') || name.startsWith('JUSTKVIZ_OFFLINE_')) delete env[name];
    }
    Object.assign(env, {
      GCLOUD_PROJECT: STAGING_PROJECT,
      GOOGLE_CLOUD_PROJECT: STAGING_PROJECT,
      FIREBASE_CONFIG: JSON.stringify({ projectId: STAGING_PROJECT, storageBucket: STAGING_PROJECT + '.firebasestorage.app' }),
      JUSTKVIZ_OFFLINE_ENABLED: mode === 'disabled' ? 'false' : 'true',
      JUSTKVIZ_OFFLINE_EVENT_IDS: 'synthetic-discovery-only',
      JUSTKVIZ_OFFLINE_RECOVERY_ONLY: mode === 'recovery' ? 'true' : 'false',
    });
    const bindings = JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--inspect'],
      { cwd: root, env, encoding: 'utf8', windowsHide: true }));
    for (const name of names) assert.deepEqual(bindings[name],
      mode === 'enabled' && ['readOfflineTrust', 'prepareOfflineEvent'].includes(name) ? [key] : [], name + ' ' + mode);
    proof[mode] = bindings;
  }
  console.log('OFFLINE_SDK_DISCOVERY_PASS ' + JSON.stringify(proof));
}
