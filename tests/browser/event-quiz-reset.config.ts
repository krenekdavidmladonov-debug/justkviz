import { defineConfig } from '@playwright/test';

export default defineConfig({
  preserveOutput: 'never', testDir: '.', testMatch: 'event-quiz-reset.spec.mjs', workers: 1, timeout: 120000,
  expect: { timeout: 15000 },
  use: { actionTimeout: 15000, baseURL: 'http://127.0.0.1:5194',
    launchOptions: process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {} },
  outputDir: '../../.local-data/event-quiz-reset/results',
  webServer: {
    env: { VITE_FIREBASE_API_KEY: 'demo-api-key', VITE_FIREBASE_AUTH_DOMAIN: 'demo-filmovy-kviz-v2.firebaseapp.com',
      VITE_FIREBASE_PROJECT_ID: 'demo-filmovy-kviz-v2', VITE_FIREBASE_USE_EMULATORS: 'true',
      VITE_FIREBASE_STORAGE_BUCKET: 'demo-filmovy-kviz-v2.appspot.com', VITE_FIREBASE_MESSAGING_SENDER_ID: '123456789',
      VITE_FIREBASE_APP_ID: '1:123456789:web:demo' },
    cwd: process.cwd(), command: 'node apps/web/node_modules/vite/bin/vite.js apps/web --host 127.0.0.1 --port 5194 --strictPort',
    url: 'http://127.0.0.1:5194', reuseExistingServer: false,
  },
});
