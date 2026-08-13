/**
 * PRD §45 — all 28 success criteria, in one uninterrupted journey.
 *
 * ---------------------------------------------------------------------------
 * WHY ONE LONG TEST
 * ---------------------------------------------------------------------------
 * The other specs cover the criteria in groups, which is the right shape for
 * diagnosing a failure: a short test tells you what broke. But §45 is written
 * as a single sentence — "the application will be considered successful when a
 * user CAN…" — and a user does not get to restart the browser between step 11
 * and step 12. State carried wrongly from one step to the next is invisible to
 * any suite that sets up freshly each time.
 *
 * So this walks the whole thing once, in order, from an empty system to two
 * filed quotations, and each criterion is checked at the point it is reached.
 *
 * `TEST_REPORT.md` maps every numbered criterion to where it is covered.
 */

import { expect, test } from '@playwright/test';

import { useMockBackend, type MockBackend } from './support/backend';
import {
  addCategory,
  addItem,
  createQuotation,
  fillQuotationHeader,
  JOURNEY_ARCHIVE_PREFIX,
  issuedNumber,
  openNewQuotation,
  selectSignatory,
  selectTerm,
  setClosingParagraph,
  signIn,
} from './support/journey';

const LIBRARY_TERMS = [
  { title: 'TEST_ONLY Working Hours', body: 'TEST_ONLY ten hours per day, six days a week.' },
  { title: 'TEST_ONLY Payment Terms', body: 'TEST_ONLY payment within thirty days of invoice.' },
];

let backend: MockBackend;

test.beforeEach(async ({ page }) => {
  backend = await useMockBackend(page, { terms: LIBRARY_TERMS });
});

// One journey, many steps, and a real PDF and DOCX generated along the way.
test.describe.configure({ timeout: 300_000 });

test('a user can do all 28 things PRD §45 asks for', async ({ page }) => {
  /* ---- §45.28 — the system starts with nothing in it ---------------------- */

  expect(backend.env.spreadsheet.dataRows('Quotations')).toEqual([]);

  // No quotation document anywhere. (The archive is not literally empty: the
  // seeded signature lives under `_assets/signatures`, which is company data,
  // not a quotation.)
  expect(
    backend.env.drive.files().filter((file) => /\.(pdf|docx)$/.test(file.name)),
  ).toEqual([]);

  /* ---- §45.1 — Login ------------------------------------------------------ */

  await signIn(page);
  await expect(page.getByRole('navigation')).toBeVisible();

  /* ---- §45.2 — New Quotation ---------------------------------------------- */

  await openNewQuotation(page);

  // §45.5, negative half: nothing is issued merely by arriving (PRD §35).
  await expect(page.getByText(/SFC\/RUH\/QTN/)).toBeHidden();

  /* ---- §45.3, §45.4 — the client and the subject --------------------------- */

  await fillQuotationHeader(
    page,
    {
      clientName: 'TEST_ONLY Contact Person',
      companyName: 'TEST_ONLY Client Company',
      address: 'TEST_ONLY Address, Riyadh',
    },
    'TEST_ONLY Manpower Supply',
  );

  /* ---- §45.6-§45.11 — the three categories, and every column on a row ------ */

  await addCategory(page, 'Manpower');
  await addItem(page, {
    category: 'Manpower',
    description: 'TEST_ONLY General Labour',
    quantity: '40',
    unit: 'Hour',
    price: '20',
    // §45.11 — optional remarks.
    remarks: 'TEST_ONLY day shift',
  });

  await addCategory(page, 'Equipment');
  await addItem(page, {
    category: 'Equipment',
    description: 'TEST_ONLY Scissor Lift',
    quantity: '2',
    unit: 'Day',
    price: '350',
  });

  await addCategory(page, 'Materials');
  await addItem(page, {
    category: 'Materials',
    description: 'TEST_ONLY Cement Bags',
    quantity: '10',
    unit: 'Nos.',
    price: '18.5',
  });

  /* ---- §45.12 — the totals, without pressing anything ---------------------- */

  // 800.00 + 700.00 + 185.00 = 1,685.00, +15% VAT = 1,937.75.
  await expect(page.getByText('1,685.00').first()).toBeVisible();
  await expect(page.getByText('1,937.75').first()).toBeVisible();

  /* ---- §45.13, §45.14 — terms from the library, and a new one -------------- */

  await selectTerm(page, 'TEST_ONLY Working Hours');
  await selectTerm(page, 'TEST_ONLY Payment Terms');

  await page.getByRole('button', { name: '+ Create New Term' }).click();
  await page.getByLabel('Term name').fill('TEST_ONLY Mobilisation');
  await page.getByLabel('Term content').fill('TEST_ONLY mobilisation within five days.');
  await page.getByRole('button', { name: 'Add term' }).click();
  await expect(page.getByText('TEST_ONLY Mobilisation').first()).toBeVisible();

  /* ---- §45.15 — the closing paragraph -------------------------------------- */

  await setClosingParagraph(page, 'TEST_ONLY closing. Please issue the purchase order.');

  /* ---- §45.16, §45.17 — who signs, and their details appearing ------------- */

  await selectSignatory(page, 'TEST_ONLY_Signatory');
  const details = page.getByRole('definition');
  await expect(details.filter({ hasText: 'TEST_ONLY Designation' })).toBeVisible();

  /* ---- §45.5 — the number, issued now and not before ----------------------- */

  await createQuotation(page);

  const first = await issuedNumber(page);
  expect(first).toBe('SFC/RUH/QTN/2026/001');
  const firstFileSafe = first.split('/').join('-');

  /* ---- §45.19 — Preview ---------------------------------------------------- */

  // Creating the quotation lands on its own preview — see the navigation in
  // src/pages/quotations/new.tsx.
  await expect(page.getByRole('button', { name: 'Save as PDF' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(first).first()).toBeVisible();
  await expect(page.getByText('TEST_ONLY Client Company').first()).toBeVisible();

  /* ---- §45.18 — the seal, on the right ------------------------------------- */

  const seal = page.getByRole('img', { name: /seal/i }).first();
  await expect(seal).toBeVisible();

  const sealBox = await seal.boundingBox();
  const detailsBox = await page.getByText('TEST_ONLY Designation').last().boundingBox();
  if (sealBox === null || detailsBox === null) throw new Error('Could not measure the block.');
  expect(sealBox.x).toBeGreaterThan(detailsBox.x + detailsBox.width);

  /* ---- §45.20 — the PDF ---------------------------------------------------- */

  const pdfDownload = page.waitForEvent('download', { timeout: 120_000 });
  await page.getByRole('button', { name: 'Save as PDF' }).click();
  expect((await pdfDownload).suggestedFilename()).toBe(`${firstFileSafe}.pdf`);

  /* ---- §45.21 — the Word document ------------------------------------------ */

  const docxDownload = page.waitForEvent('download', { timeout: 120_000 });
  await page.getByRole('button', { name: 'Save as Word' }).click();
  expect((await docxDownload).suggestedFilename()).toBe(`${firstFileSafe}.docx`);

  /* ---- §45.22, §45.23 — both to Drive, under Year / Month / Number --------- */

  await page.getByRole('button', { name: /save to google drive/i }).click();
  await expect
    .poll(() => backend.env.spreadsheet.dataRows('Quotations').length, { timeout: 180_000 })
    .toBe(1);

  expect(backend.env.drive.folderPaths()).toContain(`${JOURNEY_ARCHIVE_PREFIX}/${firstFileSafe}`);
  expect(
    backend.env.drive
      .filesIn(`${JOURNEY_ARCHIVE_PREFIX}/${firstFileSafe}`)
      .map((file) => file.name)
      .sort(),
  ).toEqual([`${firstFileSafe}.docx`, `${firstFileSafe}.pdf`]);

  /* ---- §45.24, §45.25 — the register row and its Drive link ---------------- */

  const row = backend.env.spreadsheet.dataRows('Quotations')[0] ?? [];
  expect(row[0]).toBe(first);
  expect(row[2]).toBe('TEST_ONLY Contact Person');
  expect(row[5]).toBe(1_937.75);
  expect(String(row[7])).toContain('https://drive.google.com/');

  /* ---- §45.26 — the status ------------------------------------------------- */

  await page.goto('/quotations');
  const status = page.getByLabel(`Status for ${first}`);
  await expect(status).toBeVisible({ timeout: 30_000 });
  await status.selectOption('Approved');

  await expect
    .poll(() => backend.env.spreadsheet.dataRows('Quotations')[0]?.[6], { timeout: 30_000 })
    .toBe('Approved');

  /* ---- §45.27 — a second quotation, with no duplicate numbering ------------ */

  await openNewQuotation(page);
  await fillQuotationHeader(
    page,
    {
      clientName: 'TEST_ONLY Second Contact',
      companyName: 'TEST_ONLY Second Company',
      address: 'TEST_ONLY Second Address, Riyadh',
    },
    'TEST_ONLY Equipment Hire',
  );
  await addCategory(page, 'Equipment');
  await addItem(page, {
    category: 'Equipment',
    description: 'TEST_ONLY Telehandler',
    quantity: '5',
    unit: 'Day',
    price: '600',
  });
  await setClosingParagraph(page, 'TEST_ONLY closing paragraph.');
  await selectSignatory(page, 'TEST_ONLY_Signatory');
  await createQuotation(page);

  const second = await issuedNumber(page);
  expect(second).toBe('SFC/RUH/QTN/2026/002');
  expect(second).not.toBe(first);

  /* ---- §45.28 — nothing in the system that a user did not create ----------- */

  const numbers = backend.env.spreadsheet
    .dataRows('Idempotency')
    .map((ledgerRow) => String(ledgerRow[1]));

  expect(numbers).toEqual([first, second]);
  expect(new Set(numbers).size).toBe(numbers.length);

  // Every folder in the archive belongs to one of the two quotations that were
  // actually created — no demo folder, no sample file, no placeholder row.
  for (const path of backend.env.drive.folderPaths()) {
    expect(path).toMatch(/^2026(\/August(\/SFC-RUH-QTN-2026-00[12])?)?$|^_assets(\/signatures)?$/);
  }
});
