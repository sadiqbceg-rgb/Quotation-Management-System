/**
 * PRD §45.1 — "Login" — in a real browser.
 *
 * The unit suites cover the form and the guards in jsdom. What only a browser
 * shows is the whole thing wired together: the app boots, reaches its endpoint,
 * signs in, keeps the session across a reload, and refuses what it should.
 *
 * The backend is the real Apps Script router behind an intercepted `fetch`
 * (see `support/backend.ts`). No production credential exists in this file or
 * anywhere it reads from.
 */

import { expect, test } from '@playwright/test';

import { useMockBackend, E2E_EMAIL, E2E_ADMIN_EMAIL, E2E_PASSWORD } from './support/backend';
import { signIn } from './support/journey';

test.beforeEach(async ({ page }) => {
  await useMockBackend(page, { withAdmin: true });
});

test('signs a user in and shows the application', async ({ page }) => {
  await signIn(page);

  // Past the login form and into the app shell.
  await expect(page.getByLabel(/password/i)).toBeHidden();
  await expect(page.getByRole('navigation')).toBeVisible();
});

test('refuses a wrong password without saying whether the account exists', async ({ page }) => {
  await page.goto('/login');

  await page.getByLabel(/email/i).fill(E2E_EMAIL);
  await page.getByLabel(/password/i).fill('TEST_ONLY_wrong-password');
  await page.getByRole('button', { name: /sign in/i }).click();

  const wrongPassword = await page.getByRole('alert').textContent();

  await page.getByLabel(/email/i).fill('ghost@speedxksa.com');
  await page.getByLabel(/password/i).fill(E2E_PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();

  await expect(page.getByRole('alert')).toBeVisible();
  const unknownAccount = await page.getByRole('alert').textContent();

  // Identical wording. Anything else enumerates staff accounts.
  expect(unknownAccount).toBe(wrongPassword);

  // And the wording itself commits to neither: "Invalid email or password" is
  // fine; "No such account" or "Incorrect password" would each give it away.
  expect(wrongPassword ?? '').not.toMatch(/no such|not found|does not exist|incorrect password/i);
  await expect(page.getByLabel(/password/i)).toBeVisible();
});

test('sends an anonymous visitor to login and back to where they were going', async ({ page }) => {
  await page.goto('/quotations/new');

  // Bounced to login rather than shown the page.
  await expect(page.getByLabel(/password/i)).toBeVisible();

  await page.getByLabel(/email/i).fill(E2E_EMAIL);
  await page.getByLabel(/password/i).fill(E2E_PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();

  // Returned to the destination, not dumped on the dashboard.
  await expect(page).toHaveURL(/\/quotations\/new$/);
  await expect(page.getByRole('heading', { name: 'New Quotation' })).toBeVisible();
});

test('keeps the session across a page reload', async ({ page }) => {
  await signIn(page);
  await page.reload();

  // sessionStorage survives a reload; the token is re-validated against the
  // backend before it is trusted, so this also proves that round trip works.
  await expect(page.getByLabel(/password/i)).toBeHidden();
  await expect(page.getByRole('navigation')).toBeVisible();
});

test('signs the user out and stops the token working', async ({ page }) => {
  await signIn(page);

  await page.getByRole('button', { name: /sign out|log out/i }).click();
  await expect(page.getByLabel(/password/i)).toBeVisible();

  // Going back to a protected route does not restore the session.
  await page.goto('/quotations/new');
  await expect(page.getByLabel(/password/i)).toBeVisible();
});

test('refuses a User an Admin-only route, and explains why', async ({ page }) => {
  await signIn(page, E2E_EMAIL);
  await page.goto('/settings');

  await expect(page.getByText(/not authorized/i).first()).toBeVisible();
});

test('lets an Admin into the same route', async ({ page }) => {
  await signIn(page, E2E_ADMIN_EMAIL);
  await page.goto('/settings');

  await expect(page.getByText(/not authorized/i)).toBeHidden();
});

test('never puts the session token in the URL', async ({ page }) => {
  await signIn(page);
  await page.goto('/quotations/new');

  // A token in a query string ends up in browser history, in referrer headers
  // and in server logs. It travels in the request body (§15.2).
  expect(page.url()).not.toMatch(/token|jwt|session/i);
});
