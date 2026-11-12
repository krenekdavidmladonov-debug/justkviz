import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'whole-evening-performance.spec.mjs',
  workers: 1,
  timeout: 600000,
  expect: { timeout: 20000 },
  reporter: [['line']],
  outputDir: '../../.local-data/whole-evening/performance-browser',
  globalSetup: '../../tools/qa/whole-evening-preview.mjs',
  use: {
    baseURL: 'http://127.0.0.1:5208',
    viewport: { width: 1366, height: 768 },
    trace: 'off',
    video: 'off',
    screenshot: 'only-on-failure',
    actionTimeout: 20000,
    launchOptions: process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
      : {},
  },
});
