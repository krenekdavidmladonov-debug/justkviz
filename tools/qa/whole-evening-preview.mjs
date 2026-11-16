import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';

export default async function setupWholeEveningPreview() {
  assert.match(process.env.GCLOUD_PROJECT ?? '', /^demo-/);
  const host = '127.0.0.1';
  const port = 5208;
  // Refuse to replace the current build while another preview is serving it.
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(port, host, () => probe.close(error => error ? reject(error) : resolve()));
  });

  const root = process.cwd();
  const baseline = process.env.WHOLE_EVENING_PHASE === 'baseline';
  const source = path.join(root, baseline ? '.local-data/whole-evening/baseline/apps/web' : 'apps/web');
  const outDir = path.join(root, '.local-data/whole-evening', baseline ? 'baseline-hosting' : 'current-hosting');
  const syntheticEnv = {
    VITE_FIREBASE_API_KEY: 'demo-api-key',
    VITE_FIREBASE_AUTH_DOMAIN: 'demo-filmovy-kviz-v2.firebaseapp.com',
    VITE_FIREBASE_PROJECT_ID: 'demo-filmovy-kviz-v2',
    VITE_FIREBASE_USE_EMULATORS: 'true',
    VITE_FIREBASE_STORAGE_BUCKET: 'demo-filmovy-kviz-v2.appspot.com',
    VITE_FIREBASE_MESSAGING_SENDER_ID: '000000000000',
    VITE_FIREBASE_APP_ID: '1:000000000000:web:demo',
    VITE_ENABLE_TEAM_EMAIL: 'false',
  };
  mkdirSync(outDir, { recursive: true });
  const vite = path.join(root, 'apps/web/node_modules/vite/bin/vite.js');
  const build = spawnSync(process.execPath, [vite, 'build', source, '--outDir', outDir, '--emptyOutDir'], {
    env: { ...process.env, ...syntheticEnv }, stdio: 'inherit', windowsHide: true, timeout: 60_000,
  });
  if (build.error) throw build.error;
  assert.equal(build.status, 0, `Whole-evening Vite build failed (status ${build.status}, signal ${build.signal}).`);

  // Vite's config and dotenv loading can set these variables in the runner.
  const keys = [...Object.keys(syntheticEnv), 'NODE_ENV', 'VITE_USER_NODE_ENV', 'BROWSER', 'BROWSER_ARGS'];
  const previousEnv = keys.map(key => [key, process.env[key]]);
  let server;
  try {
    Object.assign(process.env, syntheticEnv);
    const { preview } = await import('../../apps/web/node_modules/vite/dist/node/index.js');
    server = await preview({
      root: source,
      build: { outDir },
      preview: { host, port, strictPort: true, open: false },
      plugins: [{
        name: 'whole-evening-preview-lifecycle',
        enforce: 'pre',
        // Capture the server before listen so a startup failure can close it.
        configurePreviewServer(instance) { server = instance; },
      }],
    });
  } catch (error) {
    try {
      await server?.close();
    } catch (closeError) {
      throw new AggregateError([error, closeError], 'Whole-evening Vite preview startup and cleanup failed.', { cause: closeError });
    }
    throw error;
  } finally {
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  return async () => { await server.close(); };
}
