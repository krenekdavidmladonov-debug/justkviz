import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.', testMatch: 'projector-welcome.spec.ts', workers: 1,
  outputDir: '../../.local-data/projector-welcome/browser-results',
  use: {
    viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1,
    baseURL: 'http://127.0.0.1:5579',
    launchOptions: process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {},
  },
});
