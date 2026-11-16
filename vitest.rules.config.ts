import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    include: ['tests/firestore.rules.test.ts', 'tests/driveConnection.rules.test.ts', 'tests/driveImportStore.rules.test.ts'],
    hookTimeout: 20_000,
    testTimeout: 10_000,
  },
});
