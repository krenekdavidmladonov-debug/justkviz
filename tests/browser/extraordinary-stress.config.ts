import { defineConfig } from '@playwright/test';
import path from 'node:path';
import base from './whole-evening-performance.config';
export default defineConfig({ ...base, testMatch: ['extraordinary-stress.spec.mjs', 'extraordinary-scope.spec.mjs'], timeout: 600000,
  outputDir: process.env.JUSTKVIZ_QA_OUTPUT_ROOT ? path.resolve(process.env.JUSTKVIZ_QA_OUTPUT_ROOT, 'stress-browser') : '../../.local-data/qa/stress-browser', use: { ...base.use, screenshot: 'off', trace: 'off', video: 'off' } });
