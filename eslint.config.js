import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

export default tseslint.config(
  {
    ignores: [
      'dist',
      'dist-gas',
      'coverage',
      'node_modules',
      'src/assets/generated',
      // Whatever a test wrote — generated PDFs, DOCXs, and the synthetic
      // `dist/` directories `verify-build.test.ts` builds. Git-ignored, and
      // deliberately not written to a lint standard: a fixture that has to
      // satisfy `no-unused-vars` is a fixture that cannot represent a bundle.
      '.test-output',
    ],
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
      /*
       * `document.write` is `eval` for markup, and it is the one dangerous DOM
       * API the rules above do not cover.
       */
      'no-restricted-properties': [
        'error',
        { object: 'document', property: 'write', message: 'document.write is forbidden (§19.6).' },
        {
          object: 'document',
          property: 'writeln',
          message: 'document.write is forbidden (§19.6).',
        },
      ],

      /*
       * Type safety AT THE UNTRUSTED BOUNDARY.
       *
       * `no-unsafe-*` is what stops a parsed response being used as though it
       * were the type we hoped for. Every one of these is an error, not a
       * warning, and none is suppressed in application code — a suppressed
       * security rule is a rule that is not enforced (Phase 12).
       */
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',

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

  /*
   * The SPA never touches a Google API directly.
   *
   * All Drive and Sheets access runs inside Apps Script, as the deploying
   * account (PRD §33.3, §19.3). The browser has no Google credential and must
   * never acquire one — everything goes through `services/api/client.ts`.
   *
   * This used to be guaranteed by the Apps Script types simply not being in
   * scope for `src/`. They are now, because the integration tests drive the
   * real backend handlers (see tsconfig.json), so the rule is stated here where
   * it fails with a reason instead of a "cannot find name".
   */
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/__tests__/**'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...[
          'DriveApp',
          'SpreadsheetApp',
          'LockService',
          'CacheService',
          'PropertiesService',
          'ContentService',
          'Utilities',
          'Drive',
          'Session',
          'ScriptApp',
        ].map((name) => ({
          name,
          message: `${name} is an Apps Script API. The browser has no Google credential — call the backend through services/api/client.ts (§19.3).`,
        })),
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

      /* The backend runs as the company's Google identity. Same rules apply. */
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',

      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',

      /*
       * Fixtures fake the whole Apps Script host, so nothing under
       * `__fixtures__` may be reachable from deployed code (§20.4). esbuild
       * bundles from `main.ts`, so this is belt and braces — but the braces are
       * what turn "we would have noticed" into "it cannot happen".
       */
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/__fixtures__/**'],
              message:
                'Test fixtures may only be imported from test files. See IMPLEMENTATION_PLAN.md §20.4.',
            },
          ],
        },
      ],
    },
  },

  /* ------------------------------------------------------------------- tests */
  {
    files: [
      '**/*.test.{ts,tsx}',
      '**/*.spec.ts',
      '**/__fixtures__/**/*.{ts,tsx}',
      'test/**/*.{ts,tsx}',
      'vitest.setup.ts',
    ],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',

      /*
       * No focused and no disabled tests, anywhere (§Lint Requirements, Phase 13).
       *
       * `.only` silently reduces the suite to one test while still reporting
       * green, and `.skip` leaves a requirement uncovered with nothing to show
       * for it. Both are the kind of thing that gets committed at 6pm and found
       * six weeks later, so they are an error rather than a convention.
       */
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "MemberExpression[object.name=/^(describe|it|test|suite|bench)$/][property.name='only']",
          message: 'A focused test hides the rest of the suite. Remove .only before committing.',
        },
        {
          selector:
            "MemberExpression[object.name=/^(describe|it|test|suite|bench)$/][property.name=/^(skip|todo|fails)$/]",
          message:
            'A disabled test covers nothing. Fix it, delete it, or gate it on a runtime condition with .skipIf.',
        },
        {
          selector: "CallExpression[callee.name='fdescribe'], CallExpression[callee.name='fit']",
          message: 'A focused test hides the rest of the suite.',
        },
      ],
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
