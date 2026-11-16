import { defineConfig } from '@playwright/test';
import latencyConfig from './live-latency.config';

export default defineConfig({
  ...latencyConfig,
  testMatch: 'live-latency-resilience.spec.ts',
  outputDir: '../../.local-data/live-latency/resilience-results',
});
