import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd(), phase = process.env.EDITOR_SIMPLICITY_PHASE || 'current';
assert.match(process.env.GCLOUD_PROJECT || '', /^demo-/);
assert.ok(['baseline', 'current'].includes(phase));
const source = phase === 'baseline' ? path.join(root, '.local-data/editor-simplicity/baseline/apps/web') : path.join(root, 'apps/web');
if (phase === 'baseline') for (const relative of ['node_modules', 'apps/web/node_modules']) {
  const target = path.join(root, '.local-data/editor-simplicity/baseline', relative);
  if (!existsSync(target)) symlinkSync(path.join(root, relative), target, 'junction');
}
const out = path.join(root, '.local-data/editor-simplicity', phase + '-hosting');
mkdirSync(out, { recursive: true });
const env = { ...process.env, VITE_FIREBASE_API_KEY: 'demo-api-key', VITE_FIREBASE_AUTH_DOMAIN: 'demo-editor-simplicity.firebaseapp.com', VITE_FIREBASE_PROJECT_ID: 'demo-editor-simplicity', VITE_FIREBASE_USE_EMULATORS: 'true', VITE_FIREBASE_STORAGE_BUCKET: 'demo-editor-simplicity.appspot.com', VITE_FIREBASE_MESSAGING_SENDER_ID: '000000000000', VITE_FIREBASE_APP_ID: '1:000000000000:web:demo', VITE_ENABLE_TEAM_EMAIL: 'false' };
const vite = path.join(root, 'apps/web/node_modules/vite/bin/vite.js');
const built = spawnSync(process.execPath, [vite, 'build', source, '--outDir', out, '--emptyOutDir'], { env, stdio: 'inherit', windowsHide: true });
if (built.status !== 0) process.exit(built.status || 1);
const child = spawn(process.execPath, [vite, 'preview', source, '--outDir', out, '--host', '127.0.0.1', '--port', '5218', '--strictPort'], { env, stdio: 'inherit', windowsHide: true });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => { process.exitCode = code || 0; });
