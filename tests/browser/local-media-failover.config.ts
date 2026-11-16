import { defineConfig } from '@playwright/test';
import latencyConfig from './live-latency.config';

export default defineConfig({
  ...latencyConfig,
  testMatch: 'local-media-failover.spec.mjs',
  outputDir: '../../.local-data/local-media-failover/browser-results',
  use: { ...latencyConfig.use, acceptDownloads: true, serviceWorkers: 'block' },
});
