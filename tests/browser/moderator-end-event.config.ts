import { defineConfig } from '@playwright/test';
import base from './whole-evening-performance.config';
export default defineConfig({ ...base, testMatch: 'moderator-end-event.spec.mjs', timeout: 120_000,
  outputDir: '../../.local-data/moderator-end-event/browser' });
