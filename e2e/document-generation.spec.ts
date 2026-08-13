/**
 * PRD §45.18–§45.21 — preview, seal, PDF, Word — in a real browser.
 *
 * The document suites in Vitest generate real files and re-parse them, which is
 * where the geometry and the content are proved. What only a browser can show
 * is that the same code runs THERE: fonts fetched over HTTP, the letterhead
 * embedded from a real response, the download offered to the user, and all of
 * it under the application's own bundle rather than a Node harness.
 */

import { expect, test } from '@playwright/test';

import { useMockBackend } from './support/backend';
import {
  createQuotation,
  fillCompleteQuotation,
  issuedNumber,
  openNewQuotation,
  signIn,
} from './support/journey';

const LIBRARY_TERMS = [
  { title: 'TEST_ONLY Working Hours', body: 'TEST_ONLY ten hours per day, six days a week.' },
  { title: 'TEST_ONLY Payment Terms', body: 'TEST_ONLY payment within thirty days of invoice.' },
];

/** Sign in, fill the form, finalize, and land on the preview. */
async function reachPreview(page: import('@playwright/test').Page): Promise<string> {
  await openNewQuotation(page);
  await fillCompleteQuotation(page, {
    terms: ['TEST_ONLY Working Hours', 'TEST_ONLY Payment Terms'],
    closing: 'TEST_ONLY closing paragraph. Please issue the purchase order.',
  });
  await createQuotation(page);

  const number = await issuedNumber(page);

  // Creating the quotation lands on its own preview — see the navigation in
  // src/pages/quotations/new.tsx.
  await expect(page.getByRole('button', { name: 'Save as PDF' })).toBeVisible({ timeout: 20_000 });

  return number;
}

test.beforeEach(async ({ page }) => {
  await useMockBackend(page, { terms: LIBRARY_TERMS });
  await signIn(page);
});

/* -------------------------------------------------------------------------- */
/* §45.19 — Preview                                                            */
/* -------------------------------------------------------------------------- */

test('previews the quotation with its number, client and terms on screen', async ({ page }) => {
  const number = await reachPreview(page);

  await expect(page.getByText(number).first()).toBeVisible();
  await expect(page.getByText('TEST_ONLY Client Company').first()).toBeVisible();
  await expect(page.getByText('TEST_ONLY Working Hours').first()).toBeVisible();
  await expect(page.getByText(/purchase order/i).first()).toBeVisible();
});

test('prints all three category tables in the preview', async ({ page }) => {
  await reachPreview(page);

  await expect(page.getByText('TEST_ONLY General Labour').first()).toBeVisible();
  await expect(page.getByText('TEST_ONLY Scissor Lift').first()).toBeVisible();
  await expect(page.getByText('TEST_ONLY Cement Bags').first()).toBeVisible();
});

/* -------------------------------------------------------------------------- */
/* §45.18 — the seal on the right                                              */
/* -------------------------------------------------------------------------- */

test('shows the company seal to the RIGHT of the signature details', async ({ page }) => {
  await reachPreview(page);

  const seal = page.getByRole('img', { name: /seal/i }).first();
  await expect(seal).toBeVisible();

  const sealBox = await seal.boundingBox();
  const details = await page.getByText('TEST_ONLY Designation').first().boundingBox();

  if (sealBox === null || details === null)
    throw new Error('Could not measure the signature block.');

  // PRD §25 and §45.18: on the right, and clear of the text — not overlapping
  // it, which is the failure a screenshot would not catch.
  expect(sealBox.x).toBeGreaterThan(details.x + details.width);
});

/* -------------------------------------------------------------------------- */
/* §45.20–§45.21 — the two documents                                           */
/* -------------------------------------------------------------------------- */

test('generates a real PDF in the browser and offers it for download', async ({ page }) => {
  const number = await reachPreview(page);
  const fileSafe = number.split('/').join('-');

  const download = page.waitForEvent('download', { timeout: 90_000 });
  await page.getByRole('button', { name: 'Save as PDF' }).click();
  const file = await download;

  // Named from the issued number, in its file-safe form (§7.8).
  expect(file.suggestedFilename()).toBe(`${fileSafe}.pdf`);
});

test('generates a real Word document and offers it for download', async ({ page }) => {
  const number = await reachPreview(page);
  const fileSafe = number.split('/').join('-');

  const download = page.waitForEvent('download', { timeout: 90_000 });
  await page.getByRole('button', { name: 'Save as Word' }).click();
  const file = await download;

  expect(file.suggestedFilename()).toBe(`${fileSafe}.docx`);
});

test('names both downloads after the same quotation number', async ({ page }) => {
  const number = await reachPreview(page);
  const fileSafe = number.split('/').join('-');

  const pdfDownload = page.waitForEvent('download', { timeout: 90_000 });
  await page.getByRole('button', { name: 'Save as PDF' }).click();
  const pdf = await pdfDownload;

  const docxDownload = page.waitForEvent('download', { timeout: 90_000 });
  await page.getByRole('button', { name: 'Save as Word' }).click();
  const docx = await docxDownload;

  // One quotation, one number, two files — the propagation the Vitest suite
  // asserts against the file bytes, seen here at the point of download.
  expect(pdf.suggestedFilename()).toBe(`${fileSafe}.pdf`);
  expect(docx.suggestedFilename()).toBe(`${fileSafe}.docx`);
});

test('produces a PDF with no console error and no failed request', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  page.on('requestfailed', (request) => {
    problems.push(`${request.method()} ${request.url()} failed`);
  });

  await reachPreview(page);

  const download = page.waitForEvent('download', { timeout: 90_000 });
  await page.getByRole('button', { name: 'Save as PDF' }).click();
  await download;

  // The fonts and the letterhead are fetched over HTTP at generation time; a
  // 404 on either would produce a document that is quietly wrong.
  expect(problems).toEqual([]);
});
