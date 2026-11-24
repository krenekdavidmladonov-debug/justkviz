import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const mocks = fileURLToPath(new URL('../../tests/browser/events-form-ux.mocks.ts', import.meta.url));
export default defineConfig({
  optimizeDeps: { entries: ['tests/browser/events-form-ux.harness.html'] },
  root, plugins: [react(), {
    name: 'event-form-isolated-fixtures',
    enforce: 'pre',
    resolveId(source, importer) {
      if (['auth/AuthProvider', 'events/eventApi', 'events/eventRepository', 'quizzes/quizRepository', 'editor/editorRepository'].some((name) => source.endsWith(name))) return mocks;
      if (['./eventApi', './eventRepository'].includes(source) && importer?.replaceAll('\\', '/').includes('/features/events/')) return mocks;
      if (source === './api' && importer?.replaceAll('\\', '/').endsWith('/features/referee/RefereeAccessPanel.tsx')) return mocks;
    },
    configureServer(server) { server.middlewares.use((req, res, next) => {
      if (req.url?.startsWith('/admin/events/')) req.url = '/tests/browser/events-form-ux.harness.html';
      next();
    }); },
  }],
  define: Object.fromEntries(Object.entries({ VITE_APP_ENV: 'staging', VITE_FIREBASE_API_KEY: 'demo-api-key', VITE_FIREBASE_AUTH_DOMAIN: 'demo-filmovy-kviz-v2.firebaseapp.com', VITE_FIREBASE_PROJECT_ID: 'demo-filmovy-kviz-v2', VITE_FIREBASE_STORAGE_BUCKET: 'demo-filmovy-kviz-v2.appspot.com', VITE_FIREBASE_MESSAGING_SENDER_ID: '123', VITE_FIREBASE_APP_ID: '1:123:web:demo', VITE_FIREBASE_USE_EMULATORS: 'true' }).map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)])),
  server: { host: '127.0.0.1', port: 5188, strictPort: true, watch: null, hmr: false },
});
