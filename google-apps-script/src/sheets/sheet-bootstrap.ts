/**
 * Creating the `Quotations` sheet and keeping its shape.
 *
 * ---------------------------------------------------------------------------
 * IDEMPOTENT, AND NEVER DESTRUCTIVE
 * ---------------------------------------------------------------------------
 * This runs on the save path, so it runs constantly. It may create the sheet,
 * write the header row into an EMPTY sheet, and apply formatting — and it may
 * do nothing else. It never rewrites headers on a populated sheet, never
 * reorders columns, and never touches a data row.
 *
 * That restraint is the point. Staff work in this sheet: they widen columns,
 * they add a filter, they colour a row. A bootstrap that "restored" the sheet
 * on every save would undo their work several times an hour.
 *
 * ---------------------------------------------------------------------------
 * NO SAMPLE ROW, EVER
 * ---------------------------------------------------------------------------
 * PRD §34: production starts with zero quotations. Bootstrap creates headers
 * and formatting only. Nothing here writes a row.
 */

import { getOrCreateSheet } from './sheet-access';
import {
  COLUMN_NUMBER,
  QUOTATIONS_SHEET_NAME,
  QUOTATION_HEADERS,
} from './quotations-sheet';
import {
  MONEY_NUMBER_FORMAT,
  TIMESTAMP_NUMBER_FORMAT,
  applyColumnFormats,
  applyDuplicateNumberRule,
  applyHeaderStyle,
  applyStatusValidation,
} from './sheet-formatting';

/** Column A, for the duplicate-highlight formula. */
const NUMBER_COLUMN_LETTER = 'A';

/**
 * Whether formatting has already been applied to this spreadsheet.
 *
 * Formatting is idempotent but not free — it is several host round trips — and
 * the save path calls this on every request. One pass per execution is enough;
 * Apps Script gives each request a fresh global scope, so this resets naturally
 * rather than growing stale.
 */
let formattedThisExecution = false;

/**
 * The `Quotations` sheet, ready to read or write.
 *
 * Returns the sheet whether or not formatting succeeded: the row is the
 * product, and a host that refuses a number format must not fail a save.
 */
export function bootstrapQuotationsSheet(): GoogleAppsScript.Spreadsheet.Sheet {
  const sheet = getOrCreateSheet(QUOTATIONS_SHEET_NAME, QUOTATION_HEADERS);

  if (formattedThisExecution) return sheet;
  formattedThisExecution = true;

  applyHeaderStyle(sheet, QUOTATION_HEADERS.length);

  applyColumnFormats(sheet, [
    { column: COLUMN_NUMBER.totalAmount, numberFormat: MONEY_NUMBER_FORMAT, alignment: 'right' },
    { column: COLUMN_NUMBER.subtotal, numberFormat: MONEY_NUMBER_FORMAT, alignment: 'right' },
    { column: COLUMN_NUMBER.vatAmount, numberFormat: MONEY_NUMBER_FORMAT, alignment: 'right' },
    // Dates and timestamps are stored as TEXT — `DD-MM-YYYY` matching the
    // document, and ISO 8601 for the audit columns. A date-typed cell would be
    // re-rendered in the viewer's locale, so two people would read a different
    // date for the same quotation.
    { column: COLUMN_NUMBER.date, numberFormat: TIMESTAMP_NUMBER_FORMAT },
    { column: COLUMN_NUMBER.createdAt, numberFormat: TIMESTAMP_NUMBER_FORMAT },
    { column: COLUMN_NUMBER.updatedAt, numberFormat: TIMESTAMP_NUMBER_FORMAT },
  ]);

  applyStatusValidation(sheet, COLUMN_NUMBER.status);
  applyDuplicateNumberRule(sheet, NUMBER_COLUMN_LETTER);

  return sheet;
}

/** Reset the once-per-execution guard. Test-only; Apps Script resets globals. */
export function TEST_ONLY_resetBootstrapState(): void {
  formattedThisExecution = false;
}
