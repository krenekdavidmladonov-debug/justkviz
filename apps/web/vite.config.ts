import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { assertStagingEnvironment } from '../../tools/staging/guard.mjs';
import { offlineBuild } from './offlineBuild';

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  if (mode === 'staging') assertStagingEnvironment(env);
  else if (env.VITE_FIREBASE_PROJECT_ID && !env.VITE_FIREBASE_PROJECT_ID.startsWith('demo-')) {
    throw new Error('Cloud builds require explicit staging mode; production is not supported.');
  }
  const offlineEnabled = mode !== 'staging' && env.VITE_FIREBASE_USE_EMULATORS === 'true'
    && env.VITE_FIREBASE_PROJECT_ID === 'demo-filmovy-kviz-v2';
  return {
    plugins: [react(), ...(offlineEnabled ? [offlineBuild()] : [])],
    build: { rollupOptions: { input: {
      main: fileURLToPath(new URL('./index.html', import.meta.url)),
      ...(offlineEnabled ? { offline: fileURLToPath(new URL('./offline.html', import.meta.url)) } : {}),
    } } },
    server: { host: '127.0.0.1', port: 5173 },
  };
});
