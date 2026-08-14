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
 * The address the dev server binds to, and the one the tests ask for.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A CONSTANT AND WHY IT IS AN IP, NOT `localhost`
 * ---------------------------------------------------------------------------
 * Vite's dev server binds to `localhost` unless told otherwise, and Node ≥ 17
 * resolves names in `verbatim` order — whatever `/etc/hosts` lists first.
 *
 * On this machine `/etc/hosts` has only `127.0.0.1 localhost`, so Vite binds
 * IPv4 and everything agrees. A GitHub Actions runner also maps `::1 localhost`,
 * so there Vite binds `[::1]:5174` while Playwright polls `127.0.0.1:5174` —
 * refused, forever, until `Timed out waiting 120000ms from config.webServer`.
 * The server is healthy the whole time; nothing is listening at the address
 * being asked about.
 *
 * Passing `--host` explicitly removes the resolver from the question: the
 * address Vite binds and the address Playwright polls are the same string,
 * derived here once so the command, the probe URL and `baseURL` cannot drift
 * apart again.
 */
const HOST = '127.0.0.1';
const PORT = 5174;
const ORIGIN = `http://${HOST}:${String(PORT)}`;

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

  /*
   * `line` keeps the CI log short; `html` gives the failure something to upload.
   *
   * The workflow has always had an "upload the Playwright report" step, and it
   * has always warned "No files were found with the provided path" — because
   * `line` alone writes no report. A failure in CI was therefore inspectable
   * only through whatever survived in the log.
   *
   * `open: 'never'` matters: the default would try to open a browser on the
   * runner and hang the job after the tests have already finished.
   */
  reporter: process.env['CI'] !== undefined ? [['line'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: ORIGIN,
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
    // `--host` is not optional here — see the note on HOST above.
    command: `npx vite --host ${HOST} --port ${String(PORT)} --strictPort`,
    url: `${ORIGIN}/e2e/pdf-harness.html`,
    reuseExistingServer: process.env['CI'] === undefined,
    timeout: 120_000,

    /*
     * Show the server's own output.
     *
     * The default is to discard it, which is why the CI failure above arrived
     * as a bare 120-second timeout with not one line from Vite — the banner
     * naming the address it had actually bound would have identified the
     * mismatch immediately. A server whose startup cannot be read is a server
     * whose failures are guesswork.
     */
    stdout: 'pipe',
    stderr: 'pipe',
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
