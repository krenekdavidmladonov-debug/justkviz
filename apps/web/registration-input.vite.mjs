import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const mocks = fileURLToPath(new URL('../../tests/browser/registration-input.mocks.ts', import.meta.url));

export default defineConfig({
  root,
  optimizeDeps: { entries: ['tests/browser/registration-input.harness.html'] },
  plugins: [react(), {
    name: 'registration-input-synthetic-fixture',
    enforce: 'pre',
    resolveId(source) {
      if (source.endsWith('events/registrationApi') || source.endsWith('events/eventRepository')) return mocks;
    },
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url?.startsWith('/events/')) req.url = '/tests/browser/registration-input.harness.html';
        next();
      });
    },
  }],
  server: { host: '127.0.0.1', port: 5196, strictPort: true },
});
