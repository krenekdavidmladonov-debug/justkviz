import { defineConfig } from '@playwright/test';

const projectId = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT;
if (!projectId?.startsWith('demo-')) throw new Error('Mobile event layout requires a demo-* project.');
for (const key of ['FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST', 'FUNCTIONS_EMULATOR_HOST']) {
  const endpoint = /^(127\.0\.0\.1|localhost|\[::1\]):([1-9]\d{0,4})$/u.exec(process.env[key] ?? '');
  if (!endpoint || Number(endpoint[2]) > 65535) throw new Error(key + ' must be an explicit loopback emulator endpoint.');
}

export default defineConfig({
  testDir: '.',
  testMatch: 'mobile-event-layout.spec.mjs',
  workers: 1,
  timeout: 180000,
  expect: { timeout: 20000 },
  reporter: [['line']],
  outputDir: '../../.local-data/mobile-qa/browser-results',
  use: {
    baseURL: 'http://127.0.0.1:5198',
    actionTimeout: 20000,
    trace: 'off',
    video: 'off',
    screenshot: 'only-on-failure',
    launchOptions: process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {},
  },
  webServer: {
    cwd: process.cwd(),
    command: 'node tools/run-complete-editor-preview.mjs',
    url: 'http://127.0.0.1:5198',
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      VITE_FIREBASE_API_KEY: 'demo-api-key',
      VITE_FIREBASE_AUTH_DOMAIN: projectId + '.firebaseapp.com',
      VITE_FIREBASE_PROJECT_ID: projectId,
      VITE_FIREBASE_USE_EMULATORS: 'true',
      VITE_FIREBASE_STORAGE_BUCKET: projectId + '.appspot.com',
      VITE_FIREBASE_MESSAGING_SENDER_ID: '000000000000',
      VITE_FIREBASE_APP_ID: '1:000000000000:web:demo',
      VITE_ENABLE_TEAM_EMAIL: 'false',
    },
  },
});
