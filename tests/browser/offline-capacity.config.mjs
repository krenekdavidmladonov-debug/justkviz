import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.', testMatch: 'offline-capacity.spec.mjs', workers: 1, retries: 0,
  timeout: 1_800_000, expect: { timeout: 180_000 }, reporter: [['line']],
  outputDir: '../../.local-data/offline-v1/capacity-browser-results',
  use: { baseURL: 'http://127.0.0.1:5000', serviceWorkers: 'allow', acceptDownloads: true,
    trace: 'off', screenshot: 'off', actionTimeout: 30_000 },
});
