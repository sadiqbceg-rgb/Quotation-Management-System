import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests.
 *
 * Deliberately narrow: only what a browser can prove and Node cannot. The
 * document's correctness is asserted in the Vitest suite, which is faster and
 * gives better failure messages.
 *
 * Chromium only. The generator produces bytes with `pdf-lib` rather than the
 * browser's own PDF machinery, so a second engine would exercise the same code
 * for no additional coverage.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  fullyParallel: true,
  forbidOnly: process.env['CI'] !== undefined,
  retries: 0,
  reporter: process.env['CI'] !== undefined ? 'line' : 'list',

  use: {
    baseURL: 'http://127.0.0.1:5174',
    trace: 'off',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        /*
         * The Chromium that is already on this machine.
         *
         * `@playwright/test` pins a browser build per release and would
         * otherwise download its own. Pointing at the installed binary keeps
         * the suite runnable offline and avoids a several-hundred-megabyte
         * download on every clean checkout. Override with PLAYWRIGHT_CHROMIUM
         * if your environment puts it elsewhere.
         */
        launchOptions: {
          executablePath:
            process.env['PLAYWRIGHT_CHROMIUM'] ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
        },
      },
    },
  ],

  /*
   * The dev server, not a preview of the production build: the harness page is
   * a test artefact and must never be an entry point of a real build.
   */
  webServer: {
    command: 'npx vite --port 5174 --strictPort',
    url: 'http://127.0.0.1:5174/e2e/pdf-harness.html',
    reuseExistingServer: process.env['CI'] === undefined,
    timeout: 120_000,
  },
});
