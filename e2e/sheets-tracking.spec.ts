/**
 * PRD §45.24–§45.26 — the register row, the Drive link in it, and changing a
 * status — driven from the browser.
 *
 * The register is what the company invoices from, so what matters is not that
 * a row appeared but that it carries the right number, the right client, the
 * right money and a link that works. Those are read from the in-memory sheet
 * the backend actually wrote, and from the screen that displays it.
 */

import { expect, test, type Page } from '@playwright/test';

import { useMockBackend, type MockBackend } from './support/backend';
import {
  createQuotation,
  fillCompleteQuotation,
  JOURNEY_SHEET_DATE,
  issuedNumber,
  openNewQuotation,
  signIn,
} from './support/journey';

const LIBRARY_TERMS = [
  { title: 'TEST_ONLY Working Hours', body: 'TEST_ONLY ten hours per day, six days a week.' },
];

/** Everything up to and including the Drive save. */
async function saveOneQuotation(page: Page, backend: MockBackend): Promise<string> {
  await openNewQuotation(page);
  await fillCompleteQuotation(page, {
    terms: ['TEST_ONLY Working Hours'],
    closing: 'TEST_ONLY closing paragraph.',
  });
  await createQuotation(page);

  const number = await issuedNumber(page);

  // Creating the quotation lands on its own preview — see the navigation in
  // src/pages/quotations/new.tsx.
  await page.getByRole('button', { name: /save to google drive/i }).click();

  await expect
    .poll(() => backend.env.spreadsheet.dataRows('Quotations').length, { timeout: 120_000 })
    .toBe(1);

  return number;
}

let backend: MockBackend;

test.beforeEach(async ({ page }) => {
  backend = await useMockBackend(page, { terms: LIBRARY_TERMS });
  await signIn(page);
});

/* -------------------------------------------------------------------------- */
/* §45.24 — the row                                                            */
/* -------------------------------------------------------------------------- */

test('adds the quotation to the register when it is saved', async ({ page }) => {
  const number = await saveOneQuotation(page, backend);
  const row = backend.env.spreadsheet.dataRows('Quotations')[0] ?? [];

  // PRD §31 columns A-E, in order.
  expect(row[0]).toBe(number);
  expect(row[1]).toBe(JOURNEY_SHEET_DATE);
  expect(row[2]).toBe('TEST_ONLY Contact Person');
  expect(row[3]).toBe('TEST_ONLY Client Company');
  expect(row[4]).toBe('TEST_ONLY Manpower Supply');
});

test('records the money the server computed, not what the browser sent', async ({ page }) => {
  await saveOneQuotation(page, backend);
  const row = backend.env.spreadsheet.dataRows('Quotations')[0] ?? [];

  // 40 h × 20.00 + 2 d × 350.00 + 10 × 18.50 = 1,685.00; +15% = 1,937.75.
  expect(row[10]).toBe(1_685);
  expect(row[11]).toBe(252.75);
  expect(row[5]).toBe(1_937.75);
});

test('starts every quotation at Pending', async ({ page }) => {
  await saveOneQuotation(page, backend);
  const row = backend.env.spreadsheet.dataRows('Quotations')[0] ?? [];
  expect(row[6]).toBe('Pending');
});

/* -------------------------------------------------------------------------- */
/* §45.25 — the Drive link                                                     */
/* -------------------------------------------------------------------------- */

test('puts a working Drive folder link in the register', async ({ page }) => {
  await saveOneQuotation(page, backend);
  const row = backend.env.spreadsheet.dataRows('Quotations')[0] ?? [];

  const cell = String(row[7]);
  expect(cell.startsWith('=HYPERLINK(')).toBe(true);
  expect(cell).toContain('https://drive.google.com/');
});

test('shows the Drive link on the Quotations screen', async ({ page }) => {
  await saveOneQuotation(page, backend);
  await page.goto('/quotations');

  const link = page.getByRole('link', { name: /open|folder|drive/i }).first();
  await expect(link).toBeVisible({ timeout: 20_000 });
  await expect(link).toHaveAttribute('href', /^https:\/\/drive\.google\.com\//);
});

/* -------------------------------------------------------------------------- */
/* §45.26 — the status                                                         */
/* -------------------------------------------------------------------------- */

test('changes a status from the register and keeps it', async ({ page }) => {
  const number = await saveOneQuotation(page, backend);
  await page.goto('/quotations');

  const status = page.getByLabel(`Status for ${number}`);
  await expect(status).toBeVisible({ timeout: 20_000 });
  await status.selectOption('Approved');

  await expect
    .poll(() => backend.env.spreadsheet.dataRows('Quotations')[0]?.[6], { timeout: 20_000 })
    .toBe('Approved');

  // And it survives a reload, because it was written rather than held in state.
  await page.reload();
  await expect(page.getByLabel(`Status for ${number}`)).toHaveValue('Approved');
});

test('offers exactly Pending, Approved and Rejected', async ({ page }) => {
  const number = await saveOneQuotation(page, backend);
  await page.goto('/quotations');

  const status = page.getByLabel(`Status for ${number}`);
  // The register loads its rows over the wire; reading the options before the
  // row renders returns an empty list and says nothing about the dropdown.
  await expect(status).toBeVisible({ timeout: 20_000 });

  const options = await status.locator('option').allTextContents();
  expect(options.map((option) => option.trim())).toEqual(['Pending', 'Approved', 'Rejected']);
});

/* -------------------------------------------------------------------------- */
/* §45.28 — nothing but real work                                              */
/* -------------------------------------------------------------------------- */

test('starts with an empty register — no sample rows anywhere', async ({ page }) => {
  await page.goto('/quotations');

  // PRD §34. A demo row in the register is a quotation the company never sent.
  expect(backend.env.spreadsheet.dataRows('Quotations')).toEqual([]);
  await expect(page.getByText(/SFC\/RUH\/QTN/)).toBeHidden();
});

test('holds exactly one row per quotation after two saves', async ({ page }) => {
  await saveOneQuotation(page, backend);

  await openNewQuotation(page);
  await fillCompleteQuotation(page, {
    client: {
      clientName: 'TEST_ONLY Second Contact',
      companyName: 'TEST_ONLY Second Company',
      address: 'TEST_ONLY Second Address, Riyadh',
    },
    quotationFor: 'TEST_ONLY Equipment Hire',
    closing: 'TEST_ONLY closing paragraph.',
  });
  await createQuotation(page);
  await expect(page.getByText('SFC/RUH/QTN/2026/002').first()).toBeVisible({ timeout: 15_000 });

  // Creating the quotation lands on its own preview — see the navigation in
  // src/pages/quotations/new.tsx.
  await page.getByRole('button', { name: /save to google drive/i }).click();

  await expect
    .poll(() => backend.env.spreadsheet.dataRows('Quotations').length, { timeout: 120_000 })
    .toBe(2);

  const numbers = backend.env.spreadsheet.dataRows('Quotations').map((row) => String(row[0]));
  expect(new Set(numbers).size).toBe(2);
});
