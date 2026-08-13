/**
 * PRD §45.22–§45.23 — "Save both to Google Drive" and the Year / Month /
 * Quotation Number folders — driven from the browser.
 *
 * The Drive assertions read the in-memory Drive the backend actually wrote to,
 * so what is checked is where the files ended up, not what the screen claimed.
 * No real Drive is reachable from this suite.
 */

import { expect, test, type Page } from '@playwright/test';

import { useMockBackend, type MockBackend } from './support/backend';
import {
  createQuotation,
  fillCompleteQuotation,
  JOURNEY_ARCHIVE_PREFIX,
  issuedNumber,
  openNewQuotation,
  signIn,
} from './support/journey';

const LIBRARY_TERMS = [
  { title: 'TEST_ONLY Working Hours', body: 'TEST_ONLY ten hours per day, six days a week.' },
];

/** Create a quotation and land on its preview, ready to save. */
async function reachPreview(page: Page): Promise<string> {
  await openNewQuotation(page);
  await fillCompleteQuotation(page, {
    terms: ['TEST_ONLY Working Hours'],
    closing: 'TEST_ONLY closing paragraph.',
  });
  await createQuotation(page);

  const number = await issuedNumber(page);

  // Creating the quotation lands on its own preview — see the navigation in
  // src/pages/quotations/new.tsx.
  await expect(page.getByRole('button', { name: /save to google drive/i })).toBeVisible({
    timeout: 20_000,
  });

  return number;
}

async function saveToDrive(page: Page): Promise<void> {
  await page.getByRole('button', { name: /save to google drive/i }).click();
}

let backend: MockBackend;

test.beforeEach(async ({ page }) => {
  backend = await useMockBackend(page, { terms: LIBRARY_TERMS });
  await signIn(page);
});

/* -------------------------------------------------------------------------- */
/* §45.22 — both documents reach Drive                                         */
/* -------------------------------------------------------------------------- */

test('saves both documents and reports where they went', async ({ page }) => {
  const number = await reachPreview(page);
  const fileSafe = number.split('/').join('-');

  await saveToDrive(page);

  // The screen names the archive path it filed them under.
  await expect(page.getByText(new RegExp(fileSafe)).first()).toBeVisible({ timeout: 120_000 });

  const folder = `${JOURNEY_ARCHIVE_PREFIX}/${fileSafe}`;
  expect(
    backend.env.drive
      .filesIn(folder)
      .map((file) => file.name)
      .sort(),
  ).toEqual([`${fileSafe}.docx`, `${fileSafe}.pdf`]);
});

/* -------------------------------------------------------------------------- */
/* §45.23 — Year → Month → Quotation Number                                    */
/* -------------------------------------------------------------------------- */

test('creates the Year, Month and Quotation Number folders', async ({ page }) => {
  const number = await reachPreview(page);
  const fileSafe = number.split('/').join('-');

  await saveToDrive(page);
  await expect(page.getByText(new RegExp(fileSafe)).first()).toBeVisible({ timeout: 120_000 });

  const paths = backend.env.drive.folderPaths();
  expect(paths).toContain('2026');
  expect(paths).toContain(JOURNEY_ARCHIVE_PREFIX);
  expect(paths).toContain(`${JOURNEY_ARCHIVE_PREFIX}/${fileSafe}`);
});

test('offers a working link to the folder it created', async ({ page }) => {
  await reachPreview(page);
  await saveToDrive(page);

  const link = page.getByRole('link', { name: /folder|drive/i }).first();
  await expect(link).toBeVisible({ timeout: 120_000 });
  await expect(link).toHaveAttribute('href', /^https:\/\/drive\.google\.com\//);
});

/* -------------------------------------------------------------------------- */
/* PRD §37 — a failure, and the retry                                          */
/* -------------------------------------------------------------------------- */

test('does not report a Drive failure as a successful save', async ({ page }) => {
  const number = await reachPreview(page);
  backend.failNextDriveWrite();

  await saveToDrive(page);

  // The PRD's own wording, and nothing that reads as success.
  await expect(page.getByText(/saving to google drive failed/i).first()).toBeVisible({
    timeout: 120_000,
  });

  // Nothing filed under the quotation. (The archive is not empty: the seeded
  // signature lives in `_assets/signatures`, which is not this quotation's.)
  expect(backend.env.drive.filesIn(`${JOURNEY_ARCHIVE_PREFIX}/${number.split('/').join('-')}`)).toEqual([]);
  expect(backend.env.spreadsheet.dataRows('Quotations')).toEqual([]);
});

test('offers a Retry that completes the save without duplicating anything', async ({ page }) => {
  const number = await reachPreview(page);
  const fileSafe = number.split('/').join('-');

  backend.failNextDriveWrite();
  await saveToDrive(page);
  await expect(page.getByText(/saving to google drive failed/i).first()).toBeVisible({
    timeout: 120_000,
  });

  await page.getByRole('button', { name: /retry/i }).first().click();
  await expect(page.getByText(new RegExp(fileSafe)).first()).toBeVisible({ timeout: 120_000 });

  // Two files, one folder — the retry finished the job rather than doing it
  // again (§37: "must not create duplicate files unnecessarily when retrying").
  expect(backend.env.drive.filesIn(`${JOURNEY_ARCHIVE_PREFIX}/${fileSafe}`)).toHaveLength(2);
  expect(backend.env.drive.folderPaths().filter((path) => path.endsWith(fileSafe))).toHaveLength(1);
});

/* -------------------------------------------------------------------------- */
/* Security                                                                    */
/* -------------------------------------------------------------------------- */

test('never makes a saved quotation shareable', async ({ page }) => {
  const number = await reachPreview(page);
  await saveToDrive(page);
  await expect(page.getByText(new RegExp(number.split('/').join('-'))).first()).toBeVisible({
    timeout: 120_000,
  });

  // A single sharing call would put a client's pricing on a public URL (§16.5).
  expect(backend.env.drive.sharingCalls()).toEqual([]);
});
