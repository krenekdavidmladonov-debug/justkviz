import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@filmovy-kviz/quiz-domain': fileURLToPath(new URL('../packages/quiz-domain/src/index.ts', import.meta.url)) } },
  test: { environment: 'node', include: ['tests/offline*.test.ts', 'tests/offlineWizard.test.tsx'] },
});
