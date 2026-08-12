import { expect, test } from '@playwright/test';

/**
 * The PDF generator, in a real browser.
 *
 * The Vitest suite proves the DOCUMENT is right: it generates real PDFs from
 * the real assets and re-parses them. What it cannot prove is that the code
 * runs in a browser — it executes under jsdom with file-system reads.
 *
 * This covers exactly that gap: assets fetched over HTTP, fontkit parsing a TTF
 * without Node's Buffer, and pdf-lib producing bytes in a DOM environment.
 * Everything else is asserted in the unit suite, where it is faster and the
 * failure messages are better.
 */

interface HarnessResult {
  ok: boolean;
  message?: string;
  pageCount?: number;
  manyPageCount?: number;
  filename?: string;
  byteLength?: number;
  magic?: string;
  letterheadBytes?: number;
}

async function runHarness(page: import('@playwright/test').Page): Promise<HarnessResult> {
  await page.goto('/e2e/pdf-harness.html');
  // The harness sets the title when it finishes, pass or fail.
  await expect(page).toHaveTitle('done', { timeout: 60_000 });

  const text = await page.locator('#result').textContent();
  return JSON.parse(text ?? '{}') as HarnessResult;
}

test('generates a real PDF in the browser', async ({ page }) => {
  const result = await runHarness(page);

  expect(result.message ?? '').toBe('');
  expect(result.ok).toBe(true);
});

test('the output is a PDF of a plausible size', async ({ page }) => {
  const result = await runHarness(page);

  expect(result.magic).toBe('%PDF-');
  // Big enough to contain the embedded letterhead; small enough to email.
  expect(result.byteLength ?? 0).toBeGreaterThan(20_000);
  expect(result.byteLength ?? 0).toBeLessThan(2_000_000);
});

test('fetches the letterhead over HTTP and embeds it', async ({ page }) => {
  const result = await runHarness(page);

  // The whole approach depends on this file arriving intact through the
  // browser's asset pipeline, not merely existing on disk.
  expect(result.letterheadBytes ?? 0).toBeGreaterThan(100_000);
});

test('names the download from the canonical quotation number', async ({ page }) => {
  const result = await runHarness(page);

  expect(result.filename).toBe('SFC-RUH-QTN-2026-004.pdf');
});

test('paginates a long quotation across pages', async ({ page }) => {
  const result = await runHarness(page);

  // The short quotation is one page; sixty rows must split. Both come from the
  // same generator, so this exercises the flow controller in the browser.
  expect(result.pageCount).toBe(1);
  expect(result.manyPageCount ?? 0).toBeGreaterThan(1);
});
