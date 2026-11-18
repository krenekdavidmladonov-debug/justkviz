import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.', testMatch: 'projector-motion.spec.mjs', workers: 1, timeout: 30000,
  outputDir: '../../.local-data/projector-motion/results', reporter: [['line']],
  webServer: { cwd: fileURLToPath(new URL('../..', import.meta.url)), command: 'pnpm --dir apps/web exec vite --config ../../tests/browser/projector-motion.vite.mjs', url: 'http://127.0.0.1:5574/tests/browser/projector-motion.fixture.html', reuseExistingServer: false },
  use: { baseURL: 'http://127.0.0.1:5574', viewport: { width: 960, height: 540 }, trace: 'retain-on-failure', video: 'on' },
});
