import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

export default tseslint.config(
  {
    ignores: ['dist', 'dist-gas', 'coverage', 'node_modules', 'src/assets/generated'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  /* ---------------------------------------------------------------- frontend */
  {
    files: ['src/**/*.{ts,tsx}', 'shared/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,

      /*
       * `role` is a legitimate prop name on our own components (RequireRole),
       * and it is not the ARIA attribute. ignoreNonDOM keeps the rule pointed
       * at real DOM elements, where it matters.
       */
      'jsx-a11y/aria-role': ['error', { ignoreNonDOM: true }],

      /* Security — see IMPLEMENTATION_PLAN.md §19.6. These are errors, not warnings. */
      'react/no-danger': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',

      /* Type safety */
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      /* Test fixtures must never be reachable from application code (§20.4). */
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/__fixtures__/**', '@/__fixtures__/**'],
              message:
                'Test fixtures may only be imported from test files. See IMPLEMENTATION_PLAN.md §20.4.',
            },
          ],
        },
      ],
    },
  },

  /* `shared/` must stay platform-free: no browser and no Apps Script APIs. */
  {
    files: ['shared/**/*.ts'],
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'shared/ must remain platform-agnostic.' },
        { name: 'document', message: 'shared/ must remain platform-agnostic.' },
        { name: 'localStorage', message: 'shared/ must remain platform-agnostic.' },
        { name: 'sessionStorage', message: 'shared/ must remain platform-agnostic.' },
      ],
    },
  },

  /* ------------------------------------------------------- Google Apps Script */
  {
    files: ['google-apps-script/**/*.ts'],
    // projectService (set globally above) resolves each file against the
    // nearest tsconfig.json, which for these files is
    // google-apps-script/tsconfig.json. Setting `project` as well is an error.
    languageOptions: {
      ecmaVersion: 2019,
      globals: {},
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-eval': 'error',
      'no-new-func': 'error',
    },
  },

  /* ------------------------------------------------------------------- tests */
  {
    files: ['**/*.test.{ts,tsx}', '**/__fixtures__/**/*.{ts,tsx}', 'vitest.setup.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },

  /* ------------------------------------------------------- node-side tooling */
  {
    files: ['*.config.{ts,js,mjs}', 'google-apps-script/esbuild.config.mjs', 'scripts/**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },

  {
    files: ['**/*.mjs', '**/*.js'],
    ...tseslint.configs.disableTypeChecked,
  },
);
