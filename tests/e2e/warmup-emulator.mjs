import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';

const env = requireFullEmulatorEnvironment(process.env, 'Warmup measurement');
const require = createRequire(new URL('../../functions/package.json', import.meta.url));
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const app = initializeApp({ projectId: env.projectId }, 'warmup-measurement');
const db = getFirestore(app);
const names = ['createEventLiveSession', 'previewInterimResults', 'generatePrintArtifact', 'readRefereeEvent', 'revealAnswer', 'saveEventScore'];
const origin = 'http://' + env.functionsEndpoint.host + ':' + env.functionsEndpoint.port;
async function ping(name, data = { warmup: true }) {
  const started = performance.now();
  const response = await fetch(origin + '/' + env.projectId + '/europe-west1/' + name, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(name === 'generatePrintArtifact' ? data : { data }),
    signal: AbortSignal.timeout(120000),
  });
  const body = await response.json();
  return { status: response.status, body: name === 'generatePrintArtifact' ? body : body.result, ms: Math.round((performance.now() - started) * 10) / 10 };
}
try {
  assert.equal((await db.listCollections()).length, 0, 'Measurement requires a fresh empty demo emulator; never clear an existing database.');
  const rows = [];
  for (const name of names) {
    const first = await ping(name);
    assert.equal(first.status, 200); assert.deepEqual(first.body, { warmup: true });
    const repeated = [];
    for (let index = 0; index < 5; index++) {
      const next = await ping(name);
      assert.equal(next.status, 200); assert.deepEqual(next.body, { warmup: true }); repeated.push(next.ms);
    }
    rows.push({ name, firstLocalInvocationMs: first.ms, repeatedLocalInvocationMedianMs: [...repeated].sort((a,b) => a-b)[2], repeatedLocalInvocationMs: repeated });
  }
  assert.equal((await db.listCollections()).length, 0, 'Pings must not create event, receipt, rate-limit or any other documents.');
  for (const name of names) {
    for (const data of [{ warmup: false }, { warmup: 'true' }, { warmup: true, eventId: 'synthetic' }, [true]]) {
      const denied = await ping(name, data);
      assert.notEqual(denied.status, 200, 'Malformed/mixed ping must retain ordinary validation and authorization: ' + name);
    }
  }
  assert.equal((await db.listCollections()).length, 0, 'Rejected anonymous requests must not write documents.');
  console.log(JSON.stringify({ projectId: env.projectId, functionsOrigin: origin, description: 'First versus repeated local emulator invocation. This does not measure production cold starts.', rows, databaseCollectionsAfter: 0 }, null, 2));
} finally { await deleteApp(app); }
