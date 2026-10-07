import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/drizzle/**',
      'Branding Guildine/**',
      'infra/k6/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['apps/api/**/*.ts', 'packages/**/*.ts', 'scripts/**/*.mjs', 'load/**/*.mjs', '*.js'],
    languageOptions: { globals: globals.node },
  },
  {
    files: [
      'apps/api/src/db/migrate.ts',
      'apps/api/src/db/seed.ts',
      'apps/api/src/cli/**',
      'scripts/**',
      'load/**',
    ],
    rules: { 'no-console': 'off' },
  },
  {
    // k6 runs this in its own (Go) runtime: `__ENV` is its global, not Node's.
    files: ['load/**/*.js'],
    languageOptions: { globals: { __ENV: 'readonly' } },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
);
