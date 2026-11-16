import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.', testMatch: 'registration-input.spec.ts', workers: 1,
  timeout: 20_000, expect: { timeout: 3000 },
  use: {
    baseURL: 'http://127.0.0.1:5196',
    launchOptions: process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {},
    trace: 'off', video: 'off', screenshot: 'off',
  },
  projects: [
    { name: 'desktop-chromium', use: { browserName: 'chromium', viewport: { width: 1280, height: 900 } } },
    { name: 'android-chromium', use: { ...devices['Pixel 7'], browserName: 'chromium' } },
  ],
  outputDir: '../../.local-data/registration-input/results',
  webServer: {
    cwd: process.cwd(),
    command: 'node apps/web/node_modules/vite/bin/vite.js --config apps/web/registration-input.vite.mjs',
    url: 'http://127.0.0.1:5196/events/synthetic-event', reuseExistingServer: false,
  },
});
