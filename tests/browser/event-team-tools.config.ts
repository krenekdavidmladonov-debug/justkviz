import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.', testMatch: 'event-team-tools.spec.ts', workers: 1, timeout: 120000,
  expect: { timeout: 20000 },
  use: { actionTimeout:20000,trace:'off',video:'off',screenshot:'off',baseURL: 'http://127.0.0.1:5189', permissions: ['clipboard-read', 'clipboard-write'] },
  outputDir: '../../.local-data/event-team-tools/results',
  webServer: { cwd: process.cwd(), command: 'node apps/web/node_modules/vite/bin/vite.js apps/web --host 127.0.0.1 --port 5189 --strictPort', url: 'http://127.0.0.1:5189', reuseExistingServer: false },
});
