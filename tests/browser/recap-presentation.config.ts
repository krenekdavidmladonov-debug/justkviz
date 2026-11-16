import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.', testMatch: 'recap-presentation.spec.ts', workers: 1,
  outputDir: '../../.local-data/recap-layout/browser-results',
  use: { baseURL: 'http://recap-layout.test', launchOptions: process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {} },
});
