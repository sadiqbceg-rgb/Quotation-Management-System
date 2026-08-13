/**
 * TEST ONLY — the steps of PRD §45, as functions.
 *
 * The 28 success criteria are one journey, and several specs walk overlapping
 * parts of it. Written inline in each spec, the selectors would be copied six
 * times and would rot five of those places at once. Written here, a change to
 * a label is one edit.
 *
 * The selectors are the ones a USER navigates by — labels, roles, headings —
 * never a CSS class or a test id, so a test that passes is evidence the screen
 * is usable and not merely that the markup is unchanged.
 *
 * Every helper waits for the state it establishes before returning, so a caller
 * never has to guess whether the previous step landed.
 */

import { expect, type Locator, type Page } from '@playwright/test';

import { E2E_EMAIL, E2E_PASSWORD } from './backend';

/** PRD §45.1 — Login. */
export async function signIn(page: Page, email = E2E_EMAIL): Promise<void> {
  await page.goto('/login');

  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(E2E_PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();

  await expect(page.getByLabel(/password/i)).toBeHidden();
}

/** PRD §45.2 — Click New Quotation. */
export async function openNewQuotation(page: Page): Promise<void> {
  await page.goto('/quotations/new');
  await expect(page.getByRole('heading', { name: 'New Quotation' })).toBeVisible();
}

export interface ClientDetails {
  clientName: string;
  companyName: string;
  address: string;
}

/**
 * The quotation date every journey uses.
 *
 * Pinned, not left at the form's default of today. The date decides the year
 * counter and the Year/Month archive folders, so a suite that accepted today's
 * date would assert `2026/August` in August and fail in September — a test that
 * breaks on a date nobody changed is exactly the flakiness this phase forbids.
 */
export const JOURNEY_QUOTATION_DATE = '2026-08-11';

/** The same date as the register prints it (PRD §31). */
export const JOURNEY_SHEET_DATE = '11-08-2026';

/** The archive folders it belongs in. */
export const JOURNEY_ARCHIVE_PREFIX = '2026/August';

/** PRD §45.3–§45.4 — the date, the client, and what the quotation is for. */
export async function fillQuotationHeader(
  page: Page,
  client: ClientDetails,
  quotationFor: string,
  quotationDate = JOURNEY_QUOTATION_DATE,
): Promise<void> {
  await page.getByLabel('Quotation Date*').fill(quotationDate);
  await page.getByLabel('Quotation For*').fill(quotationFor);
  await page.getByLabel('Client Name*').fill(client.clientName);
  await page.getByLabel('Company Name*').fill(client.companyName);
  await page.getByLabel('Address*').fill(client.address);
}

export type Category = 'Manpower' | 'Equipment' | 'Materials';

export interface ItemRow {
  category: Category;
  description: string;
  /** As typed: the form takes decimals. */
  quantity: string;
  unit: string;
  price: string;
  remarks?: string;
}

/**
 * The one category's table.
 *
 * Scoped by the table's own accessible name — each renders a screen-reader
 * caption of "<Category> items" — because the row labels ("Quantity 1") repeat
 * across the three tables and would otherwise be ambiguous.
 */
function categoryTable(page: Page, category: Category): Locator {
  return page.getByRole('table', { name: `${category} items` });
}

/**
 * The label the description column carries, which differs by category.
 *
 * Manpower quotes people, Equipment quotes machines and Materials quotes goods,
 * so the approved document names the column differently in each — see
 * `CATEGORY_COLUMNS` in src/config/units.ts.
 */
const DESCRIPTION_LABEL: Record<Category, string> = {
  Manpower: 'Designation',
  Equipment: 'Equipment Description',
  Materials: 'Material Description',
};

const PRICE_LABEL: Record<Category, string> = {
  Manpower: 'Unit Price',
  Equipment: 'Rate',
  Materials: 'Unit Price',
};

/** PRD §45.6 — add one of the three category tables. */
export async function addCategory(page: Page, category: Category): Promise<void> {
  await page.getByRole('button', { name: `+ ${category}` }).click();
  await expect(page.getByRole('heading', { name: category, exact: true })).toBeVisible();
}

/**
 * PRD §45.7–§45.11 — add a row and fill every column of it.
 *
 * `rowIndex` is 1-based within the category's own table, matching the labels
 * the table gives its inputs ("Designation 1", "Quantity 1", …).
 */
export async function addItem(page: Page, item: ItemRow, rowIndex = 1): Promise<void> {
  const table = categoryTable(page, item.category);
  const section = page.locator('section').filter({ has: table });

  if (rowIndex > 1) {
    await section.getByRole('button', { name: 'Add row' }).click();
  }

  const row = String(rowIndex);
  await table.getByLabel(`${DESCRIPTION_LABEL[item.category]} ${row}`).fill(item.description);
  await table.getByLabel(`Quantity ${row}`).fill(item.quantity);
  await table
    .getByLabel('Unit', { exact: true })
    .nth(rowIndex - 1)
    .selectOption(item.unit);
  await table.getByLabel(`${PRICE_LABEL[item.category]} ${row}`).fill(item.price);

  if (item.remarks !== undefined) {
    // PRD §45.11. The column is off until asked for — see the comment on the
    // toggle in QuotationItemsSection.
    const toggle = page.getByLabel('Remarks column');
    if (!(await toggle.isChecked())) await toggle.check();

    await table.getByLabel(`Remarks ${row}`).fill(item.remarks);
  }
}

/** PRD §45.13 — tick a term from the library. */
export async function selectTerm(page: Page, title: string): Promise<void> {
  await page.getByLabel(title, { exact: true }).check();
}

/** PRD §45.15 — the closing paragraph. */
export async function setClosingParagraph(page: Page, text: string): Promise<void> {
  await page.getByLabel('Closing paragraph*').fill(text);
}

/** PRD §45.16 — select the person who signs. */
export async function selectSignatory(page: Page, name: string): Promise<void> {
  const selector = page.getByLabel('Authorized person*');
  const options = await selector.locator('option').allTextContents();
  const match = options.find((option) => option.includes(name));

  if (match === undefined) {
    throw new Error(
      `No authorized person matching "${name}". Options were: ${options.join(' | ') || '(none)'}`,
    );
  }
  await selector.selectOption({ label: match });
}

/** PRD §45.5 — finalize, which is the only thing that issues a number. */
export async function createQuotation(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Create quotation' }).click();
}

/** The canonical number in a string, or '' — never the sentence around it. */
export function canonicalIn(text: string): string {
  return /SFC\/RUH\/QTN\/\d{4}\/\d{3,}/.exec(text)?.[0] ?? '';
}

/**
 * Wait for a quotation number to appear anywhere on screen, and return it.
 *
 * Extracted with a regex rather than read whole: the first thing to announce
 * the number is the success toast, whose text is "Quotation SFC/… created." —
 * so `textContent()` alone returns the sentence, not the number.
 */
export async function issuedNumber(page: Page, timeout = 20_000): Promise<string> {
  const announcement = page.getByText(/SFC\/RUH\/QTN\/\d{4}\/\d{3,}/).first();
  await expect(announcement).toBeVisible({ timeout });

  const number = canonicalIn((await announcement.textContent()) ?? '');
  if (number === '') throw new Error('A quotation number appeared but could not be read.');

  return number;
}

/** A complete quotation, entered through the screen, ready to finalize. */
export interface CompleteQuotationOptions {
  client?: ClientDetails;
  quotationFor?: string;
  items?: ItemRow[];
  terms?: string[];
  closing?: string;
  signatory?: string;
}

export const TEST_ONLY_CLIENT: ClientDetails = {
  clientName: 'TEST_ONLY Contact Person',
  companyName: 'TEST_ONLY Client Company',
  address: 'TEST_ONLY Address, Riyadh',
};

export const TEST_ONLY_ITEMS: ItemRow[] = [
  {
    category: 'Manpower',
    description: 'TEST_ONLY General Labour',
    quantity: '40',
    unit: 'Hour',
    price: '20',
    remarks: 'TEST_ONLY day shift',
  },
  {
    category: 'Equipment',
    description: 'TEST_ONLY Scissor Lift',
    quantity: '2',
    unit: 'Day',
    price: '350',
  },
  {
    category: 'Materials',
    description: 'TEST_ONLY Cement Bags',
    quantity: '10',
    unit: 'Nos.',
    price: '18.5',
  },
];

/** Fill the whole form, without finalizing. */
export async function fillCompleteQuotation(
  page: Page,
  options: CompleteQuotationOptions = {},
): Promise<void> {
  const items = options.items ?? TEST_ONLY_ITEMS;

  await fillQuotationHeader(
    page,
    options.client ?? TEST_ONLY_CLIENT,
    options.quotationFor ?? 'TEST_ONLY Manpower Supply',
  );

  const seen = new Map<Category, number>();
  for (const item of items) {
    const index = (seen.get(item.category) ?? 0) + 1;
    if (index === 1) await addCategory(page, item.category);
    seen.set(item.category, index);

    await addItem(page, item, index);
  }

  for (const term of options.terms ?? []) await selectTerm(page, term);

  if (options.closing !== undefined) await setClosingParagraph(page, options.closing);

  await selectSignatory(page, options.signatory ?? 'TEST_ONLY_Signatory');
}
