import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.', testMatch: 'editor-simplicity.spec.mjs', workers: 1,
  timeout: 600_000, expect: { timeout: 20_000 }, reporter: [['line']],
  outputDir: '../../.local-data/editor-simplicity/browser-results',
  use: { baseURL: 'http://127.0.0.1:5218', viewport: { width: 1440, height: 900 },
    trace: 'off', video: 'off', screenshot: 'off', actionTimeout: 20_000,
    launchOptions: process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {} },
  webServer: { cwd: process.cwd(), command: 'node tests/browser/editor-simplicity-preview.mjs',
    url: 'http://127.0.0.1:5218', reuseExistingServer: false },
});
