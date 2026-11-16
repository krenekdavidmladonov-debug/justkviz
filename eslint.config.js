import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/lib/**',
      'functions/worker/**', // Generated, verified copy of tools/media-worker (linted at source).
      '**/node_modules/**',
      '**/.tools/**',
      '.local-data/**',
      'output/**', // Generated posters and other non-application deliverables.
      '.firebase/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['**/*.{js,mjs,cjs}', 'tools/staging/*.d.mts'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['functions/**/*.ts'],
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['packages/quiz-domain/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
      parserOptions: {
        project: './packages/quiz-domain/tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['tools/migration-v1/src/**/*.ts'],
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        project: './tools/migration-v1/tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['tests/**/*.{ts,tsx}', 'tools/migration-v1/test/**/*.ts', 'tools/event-night/**/*.ts', 'playwright.config.ts', 'vitest.config.ts', 'vitest.rules.config.ts', 'vitest.access-rules.config.ts'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
      parserOptions: {
        project: './tsconfig.tests.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['tools/**/*.mjs'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    // Firebase CLI guard must load synchronously through Node --require.
    files: ['tools/event-management/deploy-guard.cjs', 'tools/staging/restart-deploy-guard.cjs', 'tools/staging/restart-deploy-policy.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['tests/**/*.mjs'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['tests/**/*.tsx'],
    rules: {
      '@typescript-eslint/require-await': 'off',
    },
  },
);
