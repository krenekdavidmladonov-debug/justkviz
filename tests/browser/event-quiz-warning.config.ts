import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'.', testMatch:'event-quiz-warning.spec.ts', workers:1, reporter:[['line']],
  outputDir:'../../.local-data/event-quiz-warning/browser',
  use:{ baseURL:'http://127.0.0.1:5788', launchOptions:process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {} },
  webServer:{ cwd:process.cwd(), command:'node apps/web/node_modules/vite/bin/vite.js --config apps/web/event-quiz-warning.vite.mjs', url:'http://127.0.0.1:5788/admin/events', reuseExistingServer:false },
});
