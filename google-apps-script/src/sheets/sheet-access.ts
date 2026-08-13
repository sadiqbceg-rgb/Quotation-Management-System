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
import type { PreparedCell } from './cell-escaping';

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

  if (SENSITIVE_SHEETS.indexOf(name) !== -1) hideSheet(sheet);

  return sheet;
}

/**
 * Sheets that must not be visible to someone opening the spreadsheet.
 *
 * `Users` holds password hashes, salts and iteration counts; `AuditLog` holds
 * who did what and when. Neither is business data anyone needs to browse, and
 * both are a gift to someone with read access who should not have had it
 * (§17.3, §19.9).
 */
export const SENSITIVE_SHEETS: readonly string[] = ['Users', 'AuditLog'];

/**
 * Hide a sheet, on a best-effort basis.
 *
 * Hiding is NOT access control — anyone with edit rights can unhide it — and
 * SECURITY.md says so. The real control is who the spreadsheet is shared with,
 * plus the protected ranges an owner applies by hand.
 *
 * Deliberately not done with `Protection`: `protect().removeEditors()` from a
 * script can lock the company out of its own spreadsheet, and a security
 * measure that risks losing the record system is not one worth taking
 * automatically.
 */
function hideSheet(sheet: GoogleAppsScript.Spreadsheet.Sheet): void {
  try {
    sheet.hideSheet();
  } catch {
    // A host that will not hide a sheet must not fail a quotation save.
  }
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

/**
 * Write a whole row in ONE call.
 *
 * Two reasons this exists rather than a loop of `setCell`:
 *
 * 1. **Atomicity.** A partially written row — a quotation number with no total,
 *    or a Drive link pointing at a folder whose row says nothing else — is
 *    worse than no row. One `setValues` cannot half-succeed.
 * 2. **Cost.** Apps Script charges a host round trip per call; seventeen of
 *    them per save is how an execution budget disappears.
 *
 * It takes `PreparedCell` and nothing else, so every value has provably been
 * through `cell-escaping`. That is what stops a client name reaching a cell as
 * a live formula (§19.5) — the compiler enforces it, not a convention.
 */
export function writeRow(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  rowNumber: number,
  cells: readonly PreparedCell[],
): void {
  if (cells.length === 0) return;
  sheet.getRange(rowNumber, 1, 1, cells.length).setValues([cells.slice()]);
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
