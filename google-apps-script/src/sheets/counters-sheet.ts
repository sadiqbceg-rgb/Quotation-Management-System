/**
 * The `Counters` sheet — the sole authority for quotation sequence numbers.
 *
 * See IMPLEMENTATION_PLAN.md §7.4.
 *
 * One row per year:
 *
 *   | Year | Last Sequence | Updated At |
 *   | 2026 |             4 | 2026-08-11T06:40:06Z |
 *
 * A dedicated counter, NOT a scan of the last row of a data sheet. A deleted,
 * filtered, manually re-sorted or hand-edited row would silently corrupt a
 * last-row scan and hand out a number that has already been issued — on an
 * official document that cannot be taken back.
 *
 * Every function here MUST be called while the script lock is held; see
 * quotation-number/reserve.ts. `assertLockHeld` enforces that in tests.
 */

import { asInteger, asText, findRow, getOrCreateSheet, appendRow, setCell } from './sheet-access';

export const COUNTERS_SHEET_NAME = 'Counters';

export const COUNTERS_HEADERS = ['Year', 'Last Sequence', 'Updated At'] as const;

const COLUMN = {
  year: 0,
  lastSequence: 1,
  updatedAt: 2,
} as const;

function sheet(): GoogleAppsScript.Spreadsheet.Sheet {
  return getOrCreateSheet(COUNTERS_SHEET_NAME, COUNTERS_HEADERS);
}

/** The last sequence issued for a year, or 0 when the year has no row yet. */
export function readLastSequence(year: number): number {
  const found = findRow(sheet(), COLUMN.year, String(year));
  return found === null ? 0 : asInteger(found.values[COLUMN.lastSequence], 0);
}

/**
 * Write the new last sequence for a year, creating the row on first use.
 *
 * Returns nothing: the caller already knows the value it wrote, and reading it
 * back here would suggest a durability guarantee that only
 * `SpreadsheetApp.flush()` inside the lock actually provides.
 */
export function writeLastSequence(year: number, sequence: number): void {
  const target = sheet();
  const found = findRow(target, COLUMN.year, String(year));
  const now = new Date().toISOString();

  if (found === null) {
    appendRow(target, [String(year), sequence, now]);
    return;
  }

  setCell(target, found.rowNumber, COLUMN.lastSequence + 1, sequence);
  setCell(target, found.rowNumber, COLUMN.updatedAt + 1, now);
}

/** Every year that has issued at least one quotation. Diagnostics only. */
export function listYears(): number[] {
  const target = sheet();
  const years: number[] = [];
  const lastRow = target.getLastRow();

  for (let rowNumber = 2; rowNumber <= lastRow; rowNumber++) {
    const value = asText(target.getRange(rowNumber, COLUMN.year + 1).getValue());
    const year = Number.parseInt(value, 10);
    if (Number.isFinite(year)) years.push(year);
  }

  return years;
}
