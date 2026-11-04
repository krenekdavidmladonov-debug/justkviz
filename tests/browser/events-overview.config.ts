import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: '.', testMatch: 'events-overview.spec.mjs', workers: 1, timeout: 180_000, expect: { timeout: 30_000 }, reporter: [['line']], outputDir: '../../.local-data/events-overview/browser-results',
  use: { baseURL: 'http://127.0.0.1:5222', viewport: { width: 1440, height: 1000 }, trace: 'off', video: 'off', screenshot: 'off', actionTimeout: 30_000,
    launchOptions: process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {} },
  webServer: { cwd: process.cwd(), command: 'node tests/browser/events-overview-preview.mjs', url: 'http://127.0.0.1:5222', reuseExistingServer: false } });
