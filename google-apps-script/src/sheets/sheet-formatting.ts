/**
 * How the tracking sheet looks and what it will accept.
 *
 * Everything here is idempotent and applied to the SHEET, not to rows: number
 * formats, the Status dropdown, and a conditional-format rule that highlights a
 * duplicate quotation number. Re-applying it must never touch a value.
 *
 * ---------------------------------------------------------------------------
 * WHY FORMATTING IS PART OF THE CONTRACT
 * ---------------------------------------------------------------------------
 * The Sheet is not a report — it is the V1 tracking system, and staff work in it
 * directly (PRD §31, §7). So the dropdown is what stops someone typing
 * `Aproved`, and the number format is what makes `Total Amount` sortable and
 * summable rather than a column of strings.
 *
 * The Apps Script formatting APIs are optional on some hosts and absent from
 * older runtimes; each step is guarded so a host that lacks one leaves the sheet
 * usable rather than failing a save. Formatting is cosmetic; the row is not.
 */

import { QUOTATION_STATUSES } from '@shared/types';

/** Two decimal places, thousands separated — SAR, as the document prints it. */
export const MONEY_NUMBER_FORMAT = '#,##0.00';

/** ISO 8601, so a timestamp sorts as text and reads unambiguously. */
export const TIMESTAMP_NUMBER_FORMAT = '@';

/** The date column matches the document: `DD-MM-YYYY` (PRD §31). */
export const DATE_TEXT_FORMAT = '@';

interface RangeLike {
  setNumberFormat?: (format: string) => unknown;
  setDataValidation?: (rule: unknown) => unknown;
  setHorizontalAlignment?: (alignment: string) => unknown;
  setFontWeight?: (weight: string) => unknown;
}

interface SheetLike {
  getRange?: (row: number, column: number, numRows: number, numColumns: number) => RangeLike;
  getMaxRows?: () => number;
  setFrozenRows?: (rows: number) => unknown;
  setConditionalFormatRules?: (rules: unknown[]) => unknown;
  getConditionalFormatRules?: () => unknown[];
}

/** The largest sheet this will format. Beyond it, rules apply to what exists. */
const DEFAULT_ROW_COUNT = 1_000;

function rowCount(sheet: SheetLike): number {
  const max = sheet.getMaxRows?.();
  return typeof max === 'number' && max > 1 ? max : DEFAULT_ROW_COUNT;
}

/**
 * Run a formatting step, ignoring a host that does not support it.
 *
 * Deliberately swallows: a missing `setDataValidation` must not turn into a
 * failed quotation save. The row is the product; the dropdown is a convenience.
 */
function attempt(step: () => void): void {
  try {
    step();
  } catch {
    // Cosmetic only. Nothing here affects a stored value.
  }
}

export interface ColumnFormatting {
  /** 1-based column number. */
  column: number;
  numberFormat?: string;
  alignment?: 'left' | 'right' | 'center';
}

/** Apply per-column formats from the header row down. */
export function applyColumnFormats(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  columns: readonly ColumnFormatting[],
): void {
  const target = sheet as unknown as SheetLike;
  const rows = rowCount(target);

  for (const column of columns) {
    attempt(() => {
      const range = target.getRange?.(2, column.column, Math.max(1, rows - 1), 1);
      if (range === undefined) return;

      if (column.numberFormat !== undefined) range.setNumberFormat?.(column.numberFormat);
      if (column.alignment !== undefined) range.setHorizontalAlignment?.(column.alignment);
    });
  }
}

/** Bold the header row and freeze it, so the sheet is usable at 500 rows. */
export function applyHeaderStyle(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  columnCount: number,
): void {
  const target = sheet as unknown as SheetLike;

  attempt(() => {
    target.getRange?.(1, 1, 1, columnCount)?.setFontWeight?.('bold');
  });
  attempt(() => {
    target.setFrozenRows?.(1);
  });
}

/**
 * The Status dropdown: exactly `Pending`, `Approved`, `Rejected`.
 *
 * `setAllowInvalid(false)` is the point — a warning-only rule still lets a typo
 * be saved, and the app narrows this column on read, so an unexpected value is
 * a typed error rather than something to silently coerce.
 */
export function applyStatusValidation(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  statusColumn: number,
): void {
  const target = sheet as unknown as SheetLike;

  attempt(() => {
    const builder = SpreadsheetApp.newDataValidation?.();
    if (builder === undefined) return;

    const rule = builder
      .requireValueInList(QUOTATION_STATUSES.slice(), true)
      .setAllowInvalid(false)
      .build();

    target.getRange?.(2, statusColumn, Math.max(1, rowCount(target) - 1), 1)?.setDataValidation?.(rule);
  });
}

/**
 * Highlight a quotation number that appears twice.
 *
 * The third uniqueness layer (§17.4). The counter is the only issuer and the
 * pre-append scan rejects a collision, but neither can stop someone pasting a
 * row by hand — and a duplicated quotation number in the register is the one
 * error nobody notices until two clients hold the same reference.
 */
export function applyDuplicateNumberRule(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  numberColumnLetter: string,
): void {
  const target = sheet as unknown as SheetLike;

  attempt(() => {
    /*
     * Only when the sheet has no rules at all. Apps Script gives no way to
     * identify a rule as "ours", so re-adding it on every bootstrap would grow
     * an unbounded pile of identical rules — and bootstrap runs on every save.
     */
    const existing = target.getConditionalFormatRules?.() ?? [];
    if (existing.length > 0) return;

    const range = target.getRange?.(2, 1, Math.max(1, rowCount(target) - 1), 1);
    if (range === undefined) return;

    const rule = SpreadsheetApp.newConditionalFormatRule?.()
      .whenFormulaSatisfied(
        `=AND(LEN($${numberColumnLetter}2)>0,COUNTIF($${numberColumnLetter}:$${numberColumnLetter},$${numberColumnLetter}2)>1)`,
      )
      .setBackground('#f8c9c9')
      .setRanges([range as unknown as GoogleAppsScript.Spreadsheet.Range])
      .build();

    if (rule === undefined) return;
    target.setConditionalFormatRules?.([rule]);
  });
}
