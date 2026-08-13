import { expect, test } from '@playwright/test';

/**
 * The DOCX generator, in a real browser.
 *
 * The Vitest suite proves the DOCUMENT is right: it builds real packages from
 * the real assets and asserts against the OOXML inside them. What it cannot
 * prove is that the code runs in a browser — it executes under jsdom with
 * file-system reads.
 *
 * This covers exactly that gap: images fetched over HTTP, and `docx` producing
 * a ZIP in a DOM environment with no Node `Buffer` and no `zlib`. Everything
 * else is asserted in the unit suite, where it is faster and the failure
 * messages are better.
 */

interface HarnessResult {
  ok: boolean;
  message?: string;
  filename?: string;
  byteLength?: number;
  manyByteLength?: number;
  magic?: number[];
  watermarkBytes?: number;
  sealBytes?: number;
  estimatedPageCount?: number;
}

async function runHarness(page: import('@playwright/test').Page): Promise<HarnessResult> {
  await page.goto('/e2e/docx-harness.html');
  // The harness sets the title when it finishes, pass or fail.
  await expect(page).toHaveTitle('done', { timeout: 60_000 });

  const text = await page.locator('#result').textContent();
  return JSON.parse(text ?? '{}') as HarnessResult;
}

test('generates a real DOCX in the browser', async ({ page }) => {
  const result = await runHarness(page);

  expect(result.message ?? '').toBe('');
  expect(result.ok).toBe(true);
});

test('the output is a ZIP of a plausible size', async ({ page }) => {
  const result = await runHarness(page);

  // `PK\x03\x04` — the OOXML package is a ZIP.
  expect(result.magic).toEqual([0x50, 0x4b, 0x03, 0x04]);
  expect(result.byteLength ?? 0).toBeGreaterThan(10_000);
  expect(result.byteLength ?? 0).toBeLessThan(10_000_000);
});

test('fetches the letterhead images over HTTP and embeds them', async ({ page }) => {
  const result = await runHarness(page);

  // The whole rebuild depends on these arriving intact through the browser's
  // asset pipeline, not merely existing on disk.
  expect(result.watermarkBytes ?? 0).toBeGreaterThan(1_000);
  expect(result.sealBytes ?? 0).toBeGreaterThan(1_000);
});

test('names the download from the canonical quotation number', async ({ page }) => {
  const result = await runHarness(page);

  expect(result.filename).toBe('SFC-RUH-QTN-2026-004.docx');
});

test('handles a quotation long enough to break across pages', async ({ page }) => {
  const result = await runHarness(page);

  expect(result.estimatedPageCount ?? 0).toBeGreaterThan(1);
  // A 60-row quotation carries more rows, so it must be the larger package.
  expect(result.manyByteLength ?? 0).toBeGreaterThan(result.byteLength ?? 0);
});
