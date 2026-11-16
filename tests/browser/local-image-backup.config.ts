import { defineConfig } from '@playwright/test';
import latencyConfig from './live-latency.config';

export default defineConfig({
  ...latencyConfig,
  testMatch: 'local-image-backup.spec.mjs',
  timeout: 180_000,
  outputDir: '../../.local-data/local-image-backup/browser-results',
  use: { ...latencyConfig.use, acceptDownloads: true, serviceWorkers: 'block' },
});
