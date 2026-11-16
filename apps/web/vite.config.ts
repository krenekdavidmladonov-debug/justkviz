import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { assertStagingEnvironment } from '../../tools/staging/guard.mjs';
import { offlineBuild } from './offlineBuild';

const publicV2Variables = new Set([
  'VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID', 'VITE_FIREBASE_APP_ID', 'VITE_FIREBASE_USE_EMULATORS', 'VITE_FIREBASE_ALLOW_NON_DEMO_PROJECT',
  'VITE_APP_ENV', 'VITE_ENABLE_TEAM_EMAIL', 'VITE_JUSTKVIZ_OFFLINE',
]);

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  if (mode === 'staging') {
    assertStagingEnvironment(env);
    const unexpected = Object.keys(env).filter(key => key.startsWith('VITE_') && !publicV2Variables.has(key));
    if (unexpected.length) throw new Error('Unexpected public V2 build variables: ' + unexpected.sort().join(', '));
  }
  else if (env.VITE_FIREBASE_PROJECT_ID && !env.VITE_FIREBASE_PROJECT_ID.startsWith('demo-')) {
    throw new Error('Cloud builds require explicit staging mode; production is not supported.');
  }
  const offlineRelease = env.VITE_JUSTKVIZ_OFFLINE;
  if (offlineRelease && offlineRelease !== 'false'
    && (mode !== 'staging' || !['true', 'recovery'].includes(offlineRelease))) {
    throw new Error('Offline release requires the exact staging configuration and an explicit supported mode.');
  }
  const offlineEnabled = mode === 'staging' ? offlineRelease === 'true' || offlineRelease === 'recovery'
    : env.VITE_FIREBASE_USE_EMULATORS === 'true' && env.VITE_FIREBASE_PROJECT_ID === 'demo-filmovy-kviz-v2';
  return {
    plugins: [react(), ...(offlineEnabled ? [offlineBuild()] : [])],
    build: { rollupOptions: { input: {
      main: fileURLToPath(new URL('./index.html', import.meta.url)),
      ...(offlineEnabled ? { offline: fileURLToPath(new URL('./offline.html', import.meta.url)) } : {}),
    } } },
    server: { host: '127.0.0.1', port: 5173 },
  };
});
