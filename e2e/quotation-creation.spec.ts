/**
 * PRD §45.2–§45.17 — creating a quotation, in a real browser.
 *
 * These are the criteria a user would demonstrate at a desk: enter a client,
 * add items across all three categories, watch the totals, pick terms, choose
 * who signs, and get a quotation number. Nothing is asserted from application
 * state — every check reads what is on the screen.
 */

import { expect, test } from '@playwright/test';

import { useMockBackend, type MockBackend } from './support/backend';
import {
  addCategory,
  addItem,
  createQuotation,
  fillCompleteQuotation,
  fillQuotationHeader,
  openNewQuotation,
  selectSignatory,
  selectTerm,
  signIn,
  TEST_ONLY_CLIENT,
} from './support/journey';

const LIBRARY_TERMS = [
  { title: 'TEST_ONLY Working Hours', body: 'TEST_ONLY ten hours per day, six days a week.' },
  { title: 'TEST_ONLY Payment Terms', body: 'TEST_ONLY payment within thirty days of invoice.' },
];

let backend: MockBackend;

test.beforeEach(async ({ page }) => {
  // One installation per test. Calling this twice would register a second
  // route and reinstall the fakes underneath the session already signed in.
  backend = await useMockBackend(page, { terms: LIBRARY_TERMS });
  await signIn(page);
});

/* -------------------------------------------------------------------------- */
/* §45.2, §45.5, §45.28 — opening the page costs nothing                       */
/* -------------------------------------------------------------------------- */

test('opening New Quotation creates nothing and reserves no number', async ({ page }) => {
  await openNewQuotation(page);

  // PRD §35 and §45.28: no quotation exists until the user asks for one. A
  // mount effect that reserved a number would leave permanent gaps in the
  // company's official sequence, one per page view.
  expect(backend.actions).not.toContain('quotation.save');
  expect(backend.env.spreadsheet.dataRows('Counters')).toEqual([]);
  expect(backend.env.spreadsheet.dataRows('Idempotency')).toEqual([]);
});

test('shows no quotation number before the quotation is created', async ({ page }) => {
  await openNewQuotation(page);
  await expect(page.getByText(/SFC\/RUH\/QTN/)).toBeHidden();
});

/* -------------------------------------------------------------------------- */
/* §45.3–§45.11 — the form                                                     */
/* -------------------------------------------------------------------------- */

test('accepts a client, a scope, and items in all three categories', async ({ page }) => {
  await openNewQuotation(page);
  await fillCompleteQuotation(page, { closing: 'TEST_ONLY closing paragraph.' });

  await expect(page.getByRole('heading', { name: 'Manpower', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Equipment', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Materials', exact: true })).toBeVisible();
});

test('computes the line amount as the user types, with no Save in between', async ({ page }) => {
  await openNewQuotation(page);
  await fillQuotationHeader(page, TEST_ONLY_CLIENT, 'TEST_ONLY Manpower Supply');
  await addCategory(page, 'Manpower');
  await addItem(page, {
    category: 'Manpower',
    description: 'TEST_ONLY General Labour',
    quantity: '40',
    unit: 'Hour',
    price: '20',
  });

  // 40 × 20.00 = 800.00, on screen, immediately (§45.12).
  await expect(page.getByText('800.00').first()).toBeVisible();
});

test('adds VAT at 15% and shows a grand total a client could check', async ({ page }) => {
  await openNewQuotation(page);
  await fillQuotationHeader(page, TEST_ONLY_CLIENT, 'TEST_ONLY Manpower Supply');
  await addCategory(page, 'Manpower');
  await addItem(page, {
    category: 'Manpower',
    description: 'TEST_ONLY General Labour',
    quantity: '40',
    unit: 'Hour',
    price: '20',
  });

  // 800.00 + 15% = 920.00. Both figures are printed, so the arithmetic is
  // visible rather than asserted.
  await expect(page.getByText('120.00').first()).toBeVisible();
  await expect(page.getByText('920.00').first()).toBeVisible();
});

test('updates the totals when a quantity changes', async ({ page }) => {
  await openNewQuotation(page);
  await fillQuotationHeader(page, TEST_ONLY_CLIENT, 'TEST_ONLY Manpower Supply');
  await addCategory(page, 'Manpower');
  await addItem(page, {
    category: 'Manpower',
    description: 'TEST_ONLY General Labour',
    quantity: '40',
    unit: 'Hour',
    price: '20',
  });
  await expect(page.getByText('920.00').first()).toBeVisible();

  await page.getByLabel('Quantity 1').first().fill('80');

  await expect(page.getByText('1,840.00').first()).toBeVisible();
});

test('keeps a decimal quantity rather than rounding it away', async ({ page }) => {
  await openNewQuotation(page);
  await fillQuotationHeader(page, TEST_ONLY_CLIENT, 'TEST_ONLY Manpower Supply');
  await addCategory(page, 'Materials');
  await addItem(page, {
    category: 'Materials',
    description: 'TEST_ONLY Sand',
    quantity: '2.5',
    unit: 'Ton',
    price: '120',
  });

  await expect(page.getByText('300.00').first()).toBeVisible();
});

/* -------------------------------------------------------------------------- */
/* §45.13–§45.14 — terms                                                       */
/* -------------------------------------------------------------------------- */

test('offers the Terms & Conditions library and records what is ticked', async ({ page }) => {
  await openNewQuotation(page);

  await expect(page.getByLabel('TEST_ONLY Working Hours', { exact: true })).toBeVisible();
  await selectTerm(page, 'TEST_ONLY Working Hours');

  await expect(page.getByLabel('TEST_ONLY Working Hours', { exact: true })).toBeChecked();
});

test('creates a new term without leaving the quotation', async ({ page }) => {
  await openNewQuotation(page);

  await page.getByRole('button', { name: '+ Create New Term' }).click();
  await page.getByLabel('Term name').fill('TEST_ONLY Mobilisation');
  await page.getByLabel('Term content').fill('TEST_ONLY mobilisation within five days.');
  await page.getByRole('button', { name: 'Add term' }).click();

  // The new term joins the list on this quotation, which is the point of
  // creating it here rather than in the library screen (§45.14).
  await expect(page.getByText('TEST_ONLY Mobilisation').first()).toBeVisible();
});

/* -------------------------------------------------------------------------- */
/* §45.16–§45.17 — who signs                                                   */
/* -------------------------------------------------------------------------- */

test('fills in the signatory details as soon as one is selected', async ({ page }) => {
  await openNewQuotation(page);
  await selectSignatory(page, 'TEST_ONLY_Signatory');

  // Their details, without the user retyping any of it (§45.17). Read from the
  // details list, not from the <select> — the option text mentions them too.
  const details = page.getByRole('definition');
  await expect(details.filter({ hasText: 'TEST_ONLY Designation' })).toBeVisible();
  await expect(details.filter({ hasText: '+966 50 000 0000' })).toBeVisible();
});

/* -------------------------------------------------------------------------- */
/* §45.5 — the number                                                          */
/* -------------------------------------------------------------------------- */

test('issues a quotation number only when Create quotation is pressed', async ({ page }) => {
  await openNewQuotation(page);
  await fillCompleteQuotation(page, {
    terms: ['TEST_ONLY Working Hours'],
    closing: 'TEST_ONLY closing paragraph.',
  });

  await expect(page.getByText(/SFC\/RUH\/QTN/)).toBeHidden();
  await createQuotation(page);

  await expect(page.getByText('SFC/RUH/QTN/2026/001').first()).toBeVisible({ timeout: 15_000 });
});

test('refuses to create a quotation that is missing a required field', async ({ page }) => {
  await openNewQuotation(page);

  // No client, no items, nobody to sign it.
  await createQuotation(page);

  await expect(page.getByText(/SFC\/RUH\/QTN/)).toBeHidden();
  await expect(page.getByText(/required|select an authorized person/i).first()).toBeVisible();
});

test('burns no number when creation is refused', async ({ page }) => {
  await openNewQuotation(page);

  await createQuotation(page);
  await page.waitForTimeout(500);

  expect(backend.env.spreadsheet.dataRows('Idempotency')).toEqual([]);
});

/* -------------------------------------------------------------------------- */
/* §45.27 — a second quotation                                                 */
/* -------------------------------------------------------------------------- */

test('gives a second quotation the next number, never a duplicate', async ({ page }) => {
  await openNewQuotation(page);
  await fillCompleteQuotation(page, { closing: 'TEST_ONLY closing paragraph.' });
  await createQuotation(page);
  await expect(page.getByText('SFC/RUH/QTN/2026/001').first()).toBeVisible({ timeout: 15_000 });

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
});
