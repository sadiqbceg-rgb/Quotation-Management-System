/**
 * Shared Google Sheets access.
 *
 * Every repository in every later phase goes through these helpers, so there is
 * one way to open the spreadsheet, one way to create a sheet, one way to read
 * rows and one way to write them. See IMPLEMENTATION_PLAN.md §17.
 *
 * Reads and writes are batched (`getValues` / `setValues`). Apps Script charges
 * a host round-trip per call, so a per-cell loop is what exhausts the execution
 * budget on a sheet of any size.
 */

import { escapeForSheet, unescapeFromSheet } from '@shared/validation-rules';
import { requireProperty } from '../config/properties';

export type CellValue = string | number | boolean;

export function openSpreadsheet(): GoogleAppsScript.Spreadsheet.Spreadsheet {
  return SpreadsheetApp.openById(requireProperty('TRACKING_SPREADSHEET_ID'));
}

/**
 * Get a sheet, creating it with the given headers when it does not exist.
 *
 * Idempotent: safe to call on every request. It never rewrites headers on an
 * existing sheet and never touches existing rows.
 */
export function getOrCreateSheet(
  name: string,
  headers: readonly string[],
): GoogleAppsScript.Spreadsheet.Sheet {
  const spreadsheet = openSpreadsheet();
  const existing = spreadsheet.getSheetByName(name);
  if (existing !== null) {
    return existing;
  }

  const sheet = spreadsheet.insertSheet(name);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers.slice()]);
  sheet.setFrozenRows(1);
  return sheet;
}

/** Every data row, excluding the header. Empty when the sheet has no data. */
export function readRows(sheet: GoogleAppsScript.Spreadsheet.Sheet): unknown[][] {
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow < 2 || lastColumn < 1) {
    return [];
  }
  return sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues();
}

/**
 * Append a row.
 *
 * Every string is passed through `escapeForSheet`, so a value beginning with
 * `=`, `+`, `-` or `@` lands as inert text instead of a live formula (§19.5).
 * This is applied here, at the single write site, rather than left to callers.
 */
export function appendRow(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  values: readonly CellValue[],
): void {
  const safe = values.map((value) => (typeof value === 'string' ? escapeForSheet(value) : value));
  sheet.appendRow(safe);
}

/** Overwrite one cell, escaping strings exactly as `appendRow` does. */
export function setCell(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  rowNumber: number,
  columnNumber: number,
  value: CellValue,
): void {
  const safe = typeof value === 'string' ? escapeForSheet(value) : value;
  sheet.getRange(rowNumber, columnNumber).setValue(safe);
}

export interface FoundRow {
  /** 1-based sheet row number, including the header row. */
  rowNumber: number;
  values: unknown[];
}

/** Find the first data row whose column (0-based) equals `value`, case-sensitively. */
export function findRow(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  columnIndex: number,
  value: string,
): FoundRow | null {
  const rows = readRows(sheet);
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (row === undefined) continue;
    if (asText(row[columnIndex]) === value) {
      return { rowNumber: index + 2, values: row };
    }
  }
  return null;
}

/**
 * Coerce a sheet cell to a trimmed string. Sheets returns Date and number too.
 *
 * Strings are un-escaped here, the mirror of the escaping `appendRow` and
 * `setCell` apply. Reading is the one boundary every stored value crosses, so
 * doing it anywhere else would mean some caller eventually printing the
 * apostrophe onto a client's quotation.
 */
export function asText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return unescapeFromSheet(value.trim());
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  // Anything else is not a value this system writes; treat it as empty rather
  // than letting "[object Object]" leak into a comparison or a document.
  return '';
}

export function asBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  const text = asText(value).toLowerCase();
  return text === 'true' || text === 'yes' || text === '1';
}

export function asInteger(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(asText(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
