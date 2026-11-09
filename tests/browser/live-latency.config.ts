import { defineConfig } from '@playwright/test';

// The Hosting emulator serves the production bundle built with the demo config.
const baseURL = 'http://127.0.0.1:5000';
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;

export default defineConfig({
  testDir: '.',
  testMatch: 'live-latency.spec.ts',
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['line']],
  outputDir: '../../.local-data/live-latency/browser-results',
  use: {
    baseURL,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    launchOptions: executablePath ? { executablePath } : {},
  },
});
