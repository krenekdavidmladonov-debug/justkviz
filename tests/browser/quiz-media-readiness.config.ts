import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.', testMatch: 'quiz-media-readiness.spec.mjs', workers: 1, retries: 0,
  timeout: 180_000, expect: { timeout: 20_000 }, reporter: [['line']],
  outputDir: '../../.local-data/a5-readiness/browser-results',
  use: { baseURL: 'http://127.0.0.1:5698', trace: 'off', screenshot: 'off', video: 'off',
    launchOptions: process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {} },
  webServer: { cwd: process.cwd(), command: 'node apps/web/node_modules/vite/bin/vite.js apps/web --host 127.0.0.1 --port 5698 --strictPort',
    url: 'http://127.0.0.1:5698', reuseExistingServer: false,
    env: { VITE_FIREBASE_API_KEY: 'demo-api-key', VITE_FIREBASE_AUTH_DOMAIN: 'demo-filmovy-kviz-v2.firebaseapp.com',
      VITE_FIREBASE_PROJECT_ID: 'demo-filmovy-kviz-v2', VITE_FIREBASE_USE_EMULATORS: 'true', VITE_FIREBASE_STORAGE_BUCKET: 'demo-filmovy-kviz-v2.appspot.com',
      VITE_FIREBASE_MESSAGING_SENDER_ID: '000000000000', VITE_FIREBASE_APP_ID: '1:000000000000:web:demo',
      VITE_FIREBASE_EMULATOR_HOST: '127.0.0.1', VITE_FIREBASE_AUTH_EMULATOR_PORT: '9599', VITE_FIREBASE_FIRESTORE_EMULATOR_PORT: '8580',
      VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT: '5501', VITE_FIREBASE_STORAGE_EMULATOR_PORT: '9699' } },
});
