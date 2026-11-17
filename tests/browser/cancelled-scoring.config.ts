import { defineConfig } from '@playwright/test';
import base from './whole-evening-performance.config';
export default defineConfig({
  ...base,
  testMatch: 'cancelled-scoring.spec.mjs',
  timeout: 120_000,
  outputDir: '../../.local-data/cancelled-scoring/browser',
});
