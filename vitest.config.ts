/**
 * Test configuration and the coverage gates.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS SEPARATE FROM vite.config.ts
 * ---------------------------------------------------------------------------
 * The test setup had lived inside the Vite config, which meant the coverage
 * thresholds — the thing CI enforces — were buried in the file that describes
 * how the application is BUILT. They are now here, where someone looking for
 * them will find them, and `vite.config.ts` is about the bundle again.
 *
 * Vitest reads this file in preference to `vite.config.ts`, and `mergeConfig`
 * keeps the aliases and plugins in exactly one place.
 *
 * ---------------------------------------------------------------------------
 * THE THRESHOLDS ARE ENFORCED, NOT REPORTED
 * ---------------------------------------------------------------------------
 * `thresholds` fails the run. A coverage number that is only printed is a
 * number nobody reads, and the point of the tiered figures below is that the
 * modules where a mistake is most expensive are held to the highest standard:
 *
 *   95%  the pure domain — numbering, money, totals, everything in `shared/`.
 *        A defect here is wrong on an official document that has been sent.
 *   90%  services and Apps Script handlers. A defect here is a failed save or
 *        a bad row in the register, both recoverable, both visible.
 *   80%  everything else, which is mostly presentation.
 */

import { fileURLToPath, URL } from 'node:url';
import { mergeConfig, defineConfig } from 'vitest/config';

import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./vitest.setup.ts'],

      /*
       * A DOM only where a DOM is needed.
       *
       * Building a jsdom window costs a few hundred milliseconds per FILE, and
       * two thirds of the files here — the Apps Script suites, everything in
       * `shared/`, and the fake package — never touch one. Running those under
       * plain Node cut the wall clock by roughly a third with no change to what
       * they assert.
       *
       * `src/**` keeps jsdom: those are components, hooks and services that
       * genuinely render or read `sessionStorage`.
       */
      environmentMatchGlobs: [
        ['google-apps-script/**', 'node'],
        ['shared/**', 'node'],
        ['test/**', 'node'],
        ['scripts/**', 'node'],
      ],

      include: [
        'src/**/*.test.{ts,tsx}',
        'shared/**/*.test.ts',
        'google-apps-script/**/*.test.ts',
        'scripts/**/*.test.ts',
        'test/**/*.test.ts',
      ],

      /*
       * The suite has to be fast enough that people run it (Phase 13, Testing
       * Requirements: under 60 seconds). Anything slower than this per file is
       * a file doing too much, not a timeout that needs raising.
       */
      testTimeout: 30_000,
      hookTimeout: 90_000,

      coverage: {
        provider: 'v8',
        reporter: ['text-summary', 'html', 'lcov'],
        reportsDirectory: './coverage',

        include: ['src/**', 'shared/**', 'google-apps-script/src/**'],
        exclude: [
          '**/*.test.{ts,tsx}',
          '**/__fixtures__/**',
          '**/__tests__/**',
          // Entry points and declarations: nothing to cover but the import list.
          'src/main.tsx',
          'src/types/**',
          'src/**/*.d.ts',
          'google-apps-script/src/**/*.d.ts',
        ],

        /*
         * BRANCHES ARE HELD LOWER THAN THE OTHER THREE, ON PURPOSE.
         *
         * This codebase is written under `noUncheckedIndexedAccess` and
         * `exactOptionalPropertyTypes`, which means the idiomatic way to read
         * an element is `row[index] ?? ''`. Every one of those is a branch the
         * TYPE SYSTEM has already proved cannot be taken — the array was just
         * measured, the key was just checked — and the only way to cover it is
         * to construct a state the compiler says is impossible.
         *
         * Chasing branch coverage into those is exactly the hollow test the
         * phase brief warns against, so the branch floors below are set at the
         * measured level: high enough that a genuinely untested decision fails
         * the build, low enough that the defensive fallbacks are not counted
         * against the suite. The other three metrics carry the real gate.
         */
        thresholds: {
          // Everything else.
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,

          /*
           * Per-file (glob) overrides. A high average hides a module with none:
           * `shared/numbering.ts` at 40% would pass an 80% project average all
           * day, and it is the one file the whole system's integrity rests on.
           */
          'shared/**/*.ts': {
            statements: 95,
            branches: 92,
            functions: 95,
            lines: 95,
          },
          'google-apps-script/src/quotation-number/**/*.ts': {
            statements: 95,
            branches: 95,
            functions: 95,
            lines: 95,
          },
          'google-apps-script/src/{quotation,drive,sheets,auth,security,validation}/**/*.ts': {
            statements: 90,
            branches: 84,
            functions: 90,
            lines: 90,
          },
          'src/services/**/*.ts': {
            statements: 90,
            branches: 85,
            functions: 90,
            lines: 90,
          },
        },
      },
    },

    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
      },
    },
  }),
);
