import { defineConfig } from '@playwright/test';

const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;

export default defineConfig({
  testDir: './tests/browser',
  // These opt-in suites require their own exact demo emulator setup.
  testIgnore: ['**/live-latency-resilience.spec.ts', '**/live-event-preflight.spec.mjs', '**/local-media-backup.spec.mjs', '**/local-media-failover.spec.mjs', '**/local-image-backup.spec.mjs'],
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [['line']],
  use: {
    baseURL: process.env.BROWSER_E2E_BASE_URL ?? 'http://localhost:5000',
    headless: true,
    launchOptions: executablePath ? { executablePath } : {},
    // Registration responses/CTAs contain bearer capabilities, including on failure.
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
});
