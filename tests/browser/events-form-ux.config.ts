import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.', testMatch: 'events-form-ux.spec.ts', workers: 1,
  use: { timezoneId: 'America/Los_Angeles', baseURL: 'http://127.0.0.1:5188', launchOptions: process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {} },
  outputDir: '../../.local-data/events-form-ux/results',
  webServer: { cwd: process.cwd(), command: 'node apps/web/node_modules/vite/bin/vite.js --config apps/web/events-form-ux.vite.mjs', url: 'http://127.0.0.1:5188/admin/events/new', reuseExistingServer: false },
});
