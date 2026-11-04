import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';
const { projectId } = requireFullEmulatorEnvironment(process.env, 'Events overview browser preview');
const root = process.cwd(), source = path.join(root, 'apps/web'), out = path.join(root, '.local-data/events-overview/hosting');
Object.assign(process.env, { VITE_APP_ENV: 'local', VITE_FIREBASE_API_KEY: 'demo-api-key', VITE_FIREBASE_AUTH_DOMAIN: projectId + '.firebaseapp.com', VITE_FIREBASE_PROJECT_ID: projectId, VITE_FIREBASE_USE_EMULATORS: 'true', VITE_FIREBASE_STORAGE_BUCKET: projectId + '.appspot.com', VITE_FIREBASE_MESSAGING_SENDER_ID: '000000000000', VITE_FIREBASE_APP_ID: '1:000000000000:web:demo', VITE_ENABLE_TEAM_EMAIL: 'false' });
const require = createRequire(path.join(source, 'package.json'));
const vite = await import(pathToFileURL(require.resolve('vite')).href);
await vite.build({ root: source, build: { outDir: out, emptyOutDir: false } });
// One process owns the HTTP server, so the runner can stop it cleanly on Windows.
const server = await vite.preview({ root: source, build: { outDir: out }, preview: { host: '127.0.0.1', port: 5222, strictPort: true } });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  server.httpServer.close(() => process.exit(0));
  server.httpServer.closeAllConnections();
});
