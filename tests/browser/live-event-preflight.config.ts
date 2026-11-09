import { defineConfig } from '@playwright/test';
import latencyConfig from './live-latency.config';

export default defineConfig({
  ...latencyConfig,
  testMatch: 'live-event-preflight.spec.mjs',
  outputDir: '../../.local-data/live-event-preflight/browser-results',
  use: { ...latencyConfig.use, serviceWorkers: 'block' },
});
