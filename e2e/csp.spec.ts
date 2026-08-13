import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * The app under its production Content-Security-Policy.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS TEST EXISTS
 * ---------------------------------------------------------------------------
 * A CSP that breaks the application gets switched off in production, and then
 * there is no CSP at all — which is strictly worse than never having written
 * one. So the policy has to be verified against the real app in a real browser,
 * not just asserted as a string in a config file.
 *
 * The policy is read from `public/_headers`, the same file the host serves, and
 * injected into every response here. If someone tightens the policy and breaks
 * the app, this fails; if someone loosens it, the unit suite fails.
 */

/** The CSP exactly as the static host will send it. */
function productionCsp(): string {
  const headers = readFileSync('public/_headers', 'utf8');
  const line = /Content-Security-Policy:(.*)/.exec(headers)?.[1];

  if (line === undefined) throw new Error('public/_headers has no Content-Security-Policy.');
  return line.trim();
}

interface Violation {
  text: string;
}

/**
 * Load a page with the production CSP applied, collecting anything the browser
 * refuses.
 *
 * Vite's dev server is what Playwright serves here, and dev builds use inline
 * module scripts that a production build does not — so the harness pages, which
 * are plain static HTML with an external module, are what the policy is applied
 * to. The unit suite covers the policy's text; this covers the browser's
 * reaction to it.
 */
async function loadUnderCsp(page: Page, url: string): Promise<Violation[]> {
  const violations: Violation[] = [];

  page.on('console', (message) => {
    const text = message.text();
    if (/content security policy|refused to/i.test(text)) violations.push({ text });
  });
  page.on('pageerror', (error) => {
    violations.push({ text: error.message });
  });

  await page.route('**/*', async (route) => {
    const response = await route.fetch();
    const headers = { ...response.headers(), 'content-security-policy': productionCsp() };
    const type = response.headers()['content-type'] ?? '';

    if (!type.includes('text/html')) {
      await route.fulfill({ response, headers });
      return;
    }

    /*
     * Strip INLINE scripts from the HTML before applying the policy.
     *
     * Playwright serves the Vite DEV server, and the React plugin injects an
     * inline refresh preamble that a production build does not contain — so
     * without this the test would report a violation caused by the test
     * harness rather than by the application.
     *
     * External scripts are left exactly as they are, which is what the app
     * actually ships. `deployment-security.test.ts` asserts separately that the
     * BUILT `index.html` carries no inline script at all, so the two together
     * cover what this one alone cannot.
     */
    const html = (await response.text()).replace(
      /<script(?![^>]*\ssrc=)[^>]*>[\s\S]*?<\/script>/gi,
      '',
    );

    await route.fulfill({ headers, body: html, contentType: type, status: response.status() });
  });

  await page.goto(url);
  return violations;
}

test('the policy names both Apps Script hosts', () => {
  const csp = productionCsp();

  // A Web App call is 302-redirected from one to the other. Omitting the second
  // breaks every request the application makes.
  expect(csp).toContain('https://script.google.com');
  expect(csp).toContain('https://script.googleusercontent.com');
});

test('PDF generation runs under the production CSP', async ({ page }) => {
  const violations = await loadUnderCsp(page, '/e2e/pdf-harness.html');
  await expect(page).toHaveTitle('done', { timeout: 60_000 });

  const result = JSON.parse((await page.locator('#result').textContent()) ?? '{}') as {
    ok?: boolean;
    message?: string;
  };

  // Fonts fetched over HTTP, the letterhead embedded, bytes produced — all of
  // it inside `script-src 'self'` with no `unsafe-eval`.
  expect(result.message ?? '').toBe('');
  expect(result.ok).toBe(true);
  expect(violations.map((violation) => violation.text)).toEqual([]);
});

test('DOCX generation runs under the production CSP', async ({ page }) => {
  const violations = await loadUnderCsp(page, '/e2e/docx-harness.html');
  await expect(page).toHaveTitle('done', { timeout: 60_000 });

  const result = JSON.parse((await page.locator('#result').textContent()) ?? '{}') as {
    ok?: boolean;
    message?: string;
  };

  expect(result.message ?? '').toBe('');
  expect(result.ok).toBe(true);
  expect(violations.map((violation) => violation.text)).toEqual([]);
});
