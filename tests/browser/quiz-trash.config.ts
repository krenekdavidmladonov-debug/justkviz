import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.', testMatch: 'quiz-trash.spec.ts', workers: 1,
  outputDir: '../../.local-data/quiz-trash/browser-results',
  use: { baseURL: 'http://quiz-trash.test', launchOptions: process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {} },
});
