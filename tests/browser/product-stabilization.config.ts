import { defineConfig } from '@playwright/test';
import base from './whole-evening-performance.config';

export default defineConfig({
  ...base,
  // Native PDF guests require full Chromium's new headless mode, rather than
  // Playwright's default headless shell. Keep the same PDF assertions in CI.
  use: { ...base.use, channel: 'chromium', trace: 'off', video: 'off', screenshot: 'off' },
  testMatch: 'product-stabilization.spec.mjs',
  outputDir: process.env.PRODUCT_QA_OUTPUT ? `${process.env.PRODUCT_QA_OUTPUT}/browser` : '../../.local-data/product-stabilization/integration/browser',
  timeout: 420000,
});
