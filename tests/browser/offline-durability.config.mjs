import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.', testMatch: 'offline-durability.spec.mjs', workers: 1, retries: 0,
  timeout: 180_000, expect: { timeout: 30_000 }, reporter: [['line']],
  outputDir: '../../.local-data/offline-v1/durability-browser-results',
  use: { serviceWorkers: 'allow', acceptDownloads: true, trace: 'off', screenshot: 'off' },
});
