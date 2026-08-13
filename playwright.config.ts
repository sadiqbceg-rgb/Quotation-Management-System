import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

/**
 * The Chromium to launch.
 *
 * This machine already has one, and `@playwright/test` would otherwise download
 * its own — several hundred megabytes on every clean checkout, and impossible
 * offline. So the installed binary is used when it is there.
 *
 * A GitHub runner has no such binary; it runs `playwright install` instead. The
 * existence check is what lets one config serve both, and it fails towards
 * Playwright's own browser rather than towards a path that is not there.
 */
function chromiumLaunchOptions(): { executablePath?: string } {
  const configured =
    process.env['PLAYWRIGHT_CHROMIUM'] ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

  return configured.length > 0 && existsSync(configured) ? { executablePath: configured } : {};
}

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
        launchOptions: chromiumLaunchOptions(),
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
    /*
     * The endpoint the built app is pointed at for the journey specs.
     *
     * Not a real deployment — `e2e/support/backend.ts` intercepts every request
     * to it and answers from the real Apps Script router running in-process.
     * Setting it here rather than in a committed `.env` keeps the value out of
     * anything a developer might accidentally build against, and means CI needs
     * no secret to run E2E (it must never point at production).
     */
    env: {
      VITE_GAS_ENDPOINT: 'https://script.google.com/macros/s/TEST_ONLY-e2e-deployment/exec',
      VITE_APP_ENV: 'development',
    },
  },
});
