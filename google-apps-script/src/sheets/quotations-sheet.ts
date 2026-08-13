/**
 * The `Quotations` sheet — the V1 quotation register.
 *
 * See IMPLEMENTATION_PLAN.md §17.2 and PRD §31.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS SHEET IS FOR
 * ---------------------------------------------------------------------------
 * Staff read and work in it directly. Columns A–H are exactly PRD §31, in the
 * PRD's order, because that is the table the company asked for. Columns I–Q are
 * this architecture's own: the Drive links, the server-computed money, and the
 * `Draft ID` that makes a re-save update a row instead of appending a second
 * one. They may be hidden; they carry no business meaning.
 *
 * It is NOT the payload store. `QuotationRecords` holds the full JSON needed to
 * reload a quotation for editing (a 500-line quotation does not fit in these
 * columns). This sheet holds what a person needs to see.
 *
 * ---------------------------------------------------------------------------
 * THE COLUMN MAP IS DERIVED
 * ---------------------------------------------------------------------------
 * Indices come from `HEADERS.indexOf(...)`, not from hand-written numbers. Add
 * a column in the wrong place with hard-coded indices and every read below it
 * silently shifts — the rows still load, the totals are just wrong.
 */

import { QUOTATION_STATUSES, type QuotationStatus } from '@shared/types';
import { isValidQuotationNumber, type QuotationCodes } from '@shared/numbering';
import { asText, findRow, getOrCreateSheet, readRows, writeRow } from './sheet-access';
import { driveHyperlink, safeNumber, safeText, type PreparedCell } from './cell-escaping';

export const QUOTATIONS_SHEET_NAME = 'Quotations';

/**
 * A–H are PRD §31 verbatim. I–Q are system columns (§17.2).
 *
 * The order is part of the contract with the company: do not reorder, do not
 * omit, and do not insert a business column without agreement.
 */
export const QUOTATION_HEADERS = [
  'Quotation No.',
  'Date',
  'Client Name',
  'Company Name',
  'Quotation For',
  'Total Amount',
  'Status',
  'Drive Folder',
  'PDF URL',
  'DOCX URL',
  'Subtotal',
  'VAT Amount',
  'Authorized Person',
  'Created By',
  'Created At',
  'Updated At',
  'Draft ID',
] as const;

export type QuotationHeader = (typeof QUOTATION_HEADERS)[number];

/** 0-based index of a header. Throws at module load if a name is misspelled. */
function indexOf(header: QuotationHeader): number {
  const index = QUOTATION_HEADERS.indexOf(header);
  if (index < 0) throw new Error(`Unknown Quotations column: ${header}`);
  return index;
}

export const COLUMN = {
  quotationNumber: indexOf('Quotation No.'),
  date: indexOf('Date'),
  clientName: indexOf('Client Name'),
  companyName: indexOf('Company Name'),
  quotationFor: indexOf('Quotation For'),
  totalAmount: indexOf('Total Amount'),
  status: indexOf('Status'),
  driveFolder: indexOf('Drive Folder'),
  pdfUrl: indexOf('PDF URL'),
  docxUrl: indexOf('DOCX URL'),
  subtotal: indexOf('Subtotal'),
  vatAmount: indexOf('VAT Amount'),
  authorizedPerson: indexOf('Authorized Person'),
  createdBy: indexOf('Created By'),
  createdAt: indexOf('Created At'),
  updatedAt: indexOf('Updated At'),
  draftId: indexOf('Draft ID'),
} as const;

/** 1-based, for the formatting helpers and range calls. */
export const COLUMN_NUMBER = {
  quotationNumber: COLUMN.quotationNumber + 1,
  date: COLUMN.date + 1,
  totalAmount: COLUMN.totalAmount + 1,
  status: COLUMN.status + 1,
  subtotal: COLUMN.subtotal + 1,
  vatAmount: COLUMN.vatAmount + 1,
  createdAt: COLUMN.createdAt + 1,
  updatedAt: COLUMN.updatedAt + 1,
} as const;

/* -------------------------------------------------------------------------- */
/* The row model                                                              */
/* -------------------------------------------------------------------------- */

/** What the register holds for one quotation. All money in SAR, not halalas. */
export interface QuotationRow {
  quotationNumber: string;
  /** `DD-MM-YYYY`, matching the document (PRD §31). */
  date: string;
  clientName: string;
  companyName: string;
  quotationFor: string;
  totalAmount: number;
  status: QuotationStatus;
  driveFolderUrl: string;
  pdfUrl: string;
  docxUrl: string;
  subtotal: number;
  vatAmount: number;
  authorizedPerson: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  draftId: string;
  /** 1-based sheet row, header included. Never returned to a client. */
  rowNumber: number;
}

export class QuotationSheetError extends Error {
  public override readonly name = 'QuotationSheetError';
}

/**
 * Narrow the Status cell to the union.
 *
 * A value outside the three is a typed error rather than a silent coercion to
 * `Pending`: staff edit this column by hand, and quietly turning `Aproved` into
 * `Pending` would reverse a commercial decision without telling anyone.
 */
export function parseStatus(value: unknown): QuotationStatus {
  const text = asText(value);
  if ((QUOTATION_STATUSES as readonly string[]).includes(text)) {
    return text as QuotationStatus;
  }
  throw new QuotationSheetError(
    `"${text}" is not a valid status. Expected ${QUOTATION_STATUSES.join(', ')}.`,
  );
}

function asNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number.parseFloat(asText(value).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Read the URL out of a `Drive Folder` cell.
 *
 * The cell is a `HYPERLINK` formula, so a plain read yields either the formula
 * or the rendered label depending on how the range was fetched. Both are
 * handled; anything unrecognised comes back empty rather than as a fragment of
 * spreadsheet syntax.
 */
export function folderUrlFrom(value: unknown): string {
  const text = asText(value);
  const match = /^=HYPERLINK\("([^"]*)"/.exec(text);
  if (match !== null) return match[1] ?? '';
  return text.indexOf('https://') === 0 ? text : '';
}

function toRow(values: unknown[], rowNumber: number): QuotationRow {
  return {
    quotationNumber: asText(values[COLUMN.quotationNumber]),
    date: asText(values[COLUMN.date]),
    clientName: asText(values[COLUMN.clientName]),
    companyName: asText(values[COLUMN.companyName]),
    quotationFor: asText(values[COLUMN.quotationFor]),
    totalAmount: asNumber(values[COLUMN.totalAmount]),
    status: parseStatus(values[COLUMN.status]),
    driveFolderUrl: folderUrlFrom(values[COLUMN.driveFolder]),
    pdfUrl: asText(values[COLUMN.pdfUrl]),
    docxUrl: asText(values[COLUMN.docxUrl]),
    subtotal: asNumber(values[COLUMN.subtotal]),
    vatAmount: asNumber(values[COLUMN.vatAmount]),
    authorizedPerson: asText(values[COLUMN.authorizedPerson]),
    createdBy: asText(values[COLUMN.createdBy]),
    createdAt: asText(values[COLUMN.createdAt]),
    updatedAt: asText(values[COLUMN.updatedAt]),
    draftId: asText(values[COLUMN.draftId]),
    rowNumber,
  };
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The sheet, created with its headers if absent.
 *
 * Deliberately NOT `bootstrapQuotationsSheet`: that applies formatting and
 * validation, and it imports this module for the column map. Reading a register
 * must not depend on the cosmetics being installed, and the two modules must
 * not import each other.
 */
function sheet(): GoogleAppsScript.Spreadsheet.Sheet {
  return getOrCreateSheet(QUOTATIONS_SHEET_NAME, QUOTATION_HEADERS);
}

/**
 * Every row, newest first.
 *
 * A row whose Status is unreadable is SKIPPED rather than failing the whole
 * list: one hand-edited cell must not make the register unopenable. The
 * skipped row is reported to Cloud Logging by its number, never its content.
 */
export function listQuotationRows(): QuotationRow[] {
  const rows = readRows(sheet());
  const parsed: QuotationRow[] = [];

  for (let index = 0; index < rows.length; index++) {
    const values = rows[index];
    if (values === undefined) continue;
    if (asText(values[COLUMN.quotationNumber]).length === 0) continue;

    try {
      parsed.push(toRow(values, index + 2));
    } catch {
      console.warn(`Quotations row ${String(index + 2)} has an unreadable status; skipping it.`);
    }
  }

  return parsed.reverse();
}

export function findByDraftId(draftId: string): QuotationRow | null {
  if (draftId.length === 0) return null;
  const found = findRow(sheet(), COLUMN.draftId, draftId);
  return found === null ? null : toRow(found.values, found.rowNumber);
}

export function findByQuotationNumber(quotationNumber: string): QuotationRow | null {
  if (quotationNumber.length === 0) return null;
  const found = findRow(sheet(), COLUMN.quotationNumber, quotationNumber);
  return found === null ? null : toRow(found.values, found.rowNumber);
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

/** Everything needed to write one row. All money in SAR, server-computed. */
export interface TrackingInput {
  quotationNumber: string;
  quotationDate: string;
  clientName: string;
  companyName: string;
  quotationFor: string;
  totalAmount: number;
  subtotal: number;
  vatAmount: number;
  authorizedPerson: string;
  driveFolderUrl: string;
  pdfUrl: string;
  docxUrl: string;
  createdBy: string;
  draftId: string;
  codes: QuotationCodes;
}

export interface WriteResult {
  row: QuotationRow;
  disposition: 'appended' | 'updated';
}

/**
 * Build the seventeen cells.
 *
 * Every one goes through `cell-escaping`, which is what the `PreparedCell` type
 * enforces. The Drive Folder cell is the only formula, and it degrades to inert
 * text when the URL is not Drive's.
 */
function buildCells(
  input: TrackingInput,
  status: QuotationStatus,
  createdAt: string,
  updatedAt: string,
): PreparedCell[] {
  const cells: PreparedCell[] = new Array<PreparedCell>(QUOTATION_HEADERS.length).fill(
    safeText(''),
  );

  cells[COLUMN.quotationNumber] = safeText(input.quotationNumber);
  cells[COLUMN.date] = safeText(input.quotationDate);
  cells[COLUMN.clientName] = safeText(input.clientName);
  cells[COLUMN.companyName] = safeText(input.companyName);
  cells[COLUMN.quotationFor] = safeText(input.quotationFor);
  cells[COLUMN.totalAmount] = safeNumber(input.totalAmount);
  cells[COLUMN.status] = safeText(status);
  cells[COLUMN.driveFolder] = driveHyperlink(input.driveFolderUrl, input.quotationNumber);
  cells[COLUMN.pdfUrl] = safeText(input.pdfUrl);
  cells[COLUMN.docxUrl] = safeText(input.docxUrl);
  cells[COLUMN.subtotal] = safeNumber(input.subtotal);
  cells[COLUMN.vatAmount] = safeNumber(input.vatAmount);
  cells[COLUMN.authorizedPerson] = safeText(input.authorizedPerson);
  cells[COLUMN.createdBy] = safeText(input.createdBy);
  cells[COLUMN.createdAt] = safeText(createdAt);
  cells[COLUMN.updatedAt] = safeText(updatedAt);
  cells[COLUMN.draftId] = safeText(input.draftId);

  return cells;
}

/**
 * Append or update the row for a quotation.
 *
 * Located by `Draft ID` first, then by `Quotation No.` — the draft id is the
 * idempotency key, and the number is the fallback for a row whose draft id was
 * cleared by hand.
 *
 * Three invariants:
 *
 *   - **Never two rows for one quotation.** A re-save updates.
 *   - **Status is preserved.** Staff set it in the Sheet (§17.5); re-saving a
 *     document must not reset an `Approved` quotation to `Pending`.
 *   - **`Created At` is written once.** It is the audit anchor.
 *
 * Concurrency is the caller's responsibility: `recordQuotation` wraps this in
 * the script lock, so the duplicate scan and the append cannot interleave.
 */
export function upsertQuotationRow(input: TrackingInput): WriteResult {
  if (!isValidQuotationNumber(input.quotationNumber, input.codes)) {
    throw new QuotationSheetError('A valid quotation number is required to track a quotation.');
  }

  const target = sheet();
  const now = new Date().toISOString();

  /*
   * Locate by `Draft ID` first — it is the idempotency key, and it is what a
   * retry carries. Fall back to `Quotation No.` only for a row whose draft id
   * was cleared by hand, which is recoverable; a number that belongs to a
   * DIFFERENT draft is not, and is the duplicate this scan exists to catch
   * (§17.4 layer 2).
   */
  const byDraft = findByDraftId(input.draftId);
  let existing = byDraft;

  if (byDraft === null) {
    const byNumber = findByQuotationNumber(input.quotationNumber);

    if (byNumber !== null && byNumber.draftId.length > 0) {
      throw new QuotationSheetError(
        `Quotation number ${input.quotationNumber} is already in the register.`,
      );
    }
    existing = byNumber;
  }

  if (existing === null) {
    const rowNumber = target.getLastRow() + 1;
    writeRow(target, rowNumber, buildCells(input, 'Pending', now, now));

    return {
      row: readBack(target, rowNumber, input.quotationNumber),
      disposition: 'appended',
    };
  }

  writeRow(
    target,
    existing.rowNumber,
    buildCells(input, existing.status, existing.createdAt.length > 0 ? existing.createdAt : now, now),
  );

  return {
    row: readBack(target, existing.rowNumber, input.quotationNumber),
    disposition: 'updated',
  };
}

/**
 * Read the row back and confirm it is what was intended.
 *
 * A write that reports success without the value landing is the failure mode
 * that leaves a client's quotation untracked and nobody any the wiser.
 */
function readBack(
  target: GoogleAppsScript.Spreadsheet.Sheet,
  rowNumber: number,
  quotationNumber: string,
): QuotationRow {
  const values = target.getRange(rowNumber, 1, 1, QUOTATION_HEADERS.length).getValues()[0] ?? [];
  const row = toRow(values, rowNumber);

  if (row.quotationNumber !== quotationNumber) {
    throw new QuotationSheetError('The quotation register did not accept the row.');
  }
  return row;
}

/** Set the Status of an existing row. Returns null when there is no row. */
export function setRowStatus(quotationNumber: string, status: QuotationStatus): QuotationRow | null {
  const existing = findByQuotationNumber(quotationNumber);
  if (existing === null) return null;

  const target = sheet();
  const now = new Date().toISOString();

  target.getRange(existing.rowNumber, COLUMN_NUMBER.status).setValue(safeText(status));
  target.getRange(existing.rowNumber, COLUMN.updatedAt + 1).setValue(safeText(now));

  return { ...existing, status, updatedAt: now };
}
