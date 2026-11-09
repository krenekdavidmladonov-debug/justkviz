import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.', testMatch: 'offline-event.spec.mjs', workers: 1, retries: 0,
  timeout: 300_000, expect: { timeout: 30_000 }, reporter: [['line']],
  outputDir: '../../.local-data/offline-v1/browser-results',
  use: { baseURL: 'http://127.0.0.1:5000', serviceWorkers: 'allow', acceptDownloads: true,
    trace: 'retain-on-failure', screenshot: 'only-on-failure', actionTimeout: 20_000 },
});
