import { defineConfig } from '@playwright/test';
const projectId = process.env.GCLOUD_PROJECT;
if (!projectId?.startsWith('demo-') || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9399'
  || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8380' || process.env.FUNCTIONS_EMULATOR_HOST !== '127.0.0.1:5301') {
  throw new Error('Warmup browser test requires its isolated +300 loopback demo emulators.');
}
export default defineConfig({
  testDir: '.', testMatch: 'warmup.spec.ts', workers: 1, timeout: 120000, expect: { timeout: 20000 },
  use: { baseURL: 'http://127.0.0.1:5488', launchOptions: process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {} },
  outputDir: '../../.local-data/warmup/results',
  webServer: {
    env: { VITE_FIREBASE_API_KEY: 'demo-api-key', VITE_FIREBASE_AUTH_DOMAIN: projectId + '.firebaseapp.com', VITE_FIREBASE_PROJECT_ID: projectId,
      VITE_FIREBASE_STORAGE_BUCKET: projectId + '.appspot.com', VITE_FIREBASE_MESSAGING_SENDER_ID: '000000000000', VITE_FIREBASE_APP_ID: '1:000000000000:web:demo',
      VITE_FIREBASE_USE_EMULATORS: 'true', VITE_FIREBASE_EMULATOR_HOST: '127.0.0.1', VITE_FIREBASE_AUTH_EMULATOR_PORT: '9399',
      VITE_FIREBASE_FIRESTORE_EMULATOR_PORT: '8380', VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT: '5301', VITE_FIREBASE_STORAGE_EMULATOR_PORT: '9499' },
    cwd: process.cwd(), command: 'node apps/web/node_modules/vite/bin/vite.js apps/web --host 127.0.0.1 --port 5488 --strictPort',
    url: 'http://127.0.0.1:5488', reuseExistingServer: false,
  },
});
