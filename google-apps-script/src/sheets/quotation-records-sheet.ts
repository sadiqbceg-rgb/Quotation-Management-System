/**
 * The `QuotationRecords` sheet — the system of record for quotation data.
 *
 * Distinct from the human-readable `Quotations` tracking sheet that Phase 11
 * adds (IMPLEMENTATION_PLAN.md §17.2). That one carries the eight business
 * columns staff read and filter; this one carries the full payload needed to
 * reload a quotation for editing, which does not fit in those columns.
 *
 *   | Draft ID | Quotation No. | Status | Created By | Created At | Updated At
 *   | Payload 1 … Payload 4 |
 *
 * The payload is JSON, chunked across four columns. A Google Sheets cell holds
 * at most 50,000 characters, and a 500-line quotation (the validation ceiling)
 * serialises to well over that, so a single cell would fail on exactly the
 * large quotations that matter most. Four chunks give ~180 KB of headroom.
 */

import { appendRow, asText, findRow, getOrCreateSheet, readRows, setCell } from './sheet-access';
import type { QuotationStatus } from '@shared/types';

export const QUOTATION_RECORDS_SHEET_NAME = 'QuotationRecords';

export const QUOTATION_RECORDS_HEADERS = [
  'Draft ID',
  'Quotation No.',
  'Status',
  'Created By',
  'Created At',
  'Updated At',
  'Payload 1',
  'Payload 2',
  'Payload 3',
  'Payload 4',
] as const;

const COLUMN = {
  draftId: 0,
  quotationNumber: 1,
  status: 2,
  createdBy: 3,
  createdAt: 4,
  updatedAt: 5,
  payloadStart: 6,
} as const;

/** Cells cap at 50,000 characters; stay clear of the edge. */
const CHUNK_SIZE = 45_000;
const CHUNK_COUNT = 4;

export const MAX_PAYLOAD_CHARACTERS = CHUNK_SIZE * CHUNK_COUNT;

export interface QuotationRecord {
  draftId: string;
  /** Empty until the quotation is finalized and a number is reserved. */
  quotationNumber: string;
  status: QuotationStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** The quotation as JSON. */
  payload: string;
  rowNumber: number;
}

function sheet(): GoogleAppsScript.Spreadsheet.Sheet {
  return getOrCreateSheet(QUOTATION_RECORDS_SHEET_NAME, QUOTATION_RECORDS_HEADERS);
}

function splitPayload(payload: string): string[] {
  if (payload.length > MAX_PAYLOAD_CHARACTERS) {
    throw new Error(
      `Quotation payload is ${String(payload.length)} characters, over the ${String(MAX_PAYLOAD_CHARACTERS)} limit.`,
    );
  }

  const chunks: string[] = [];
  for (let index = 0; index < CHUNK_COUNT; index++) {
    chunks.push(payload.substring(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE));
  }
  return chunks;
}

function joinPayload(values: unknown[]): string {
  let payload = '';
  for (let index = 0; index < CHUNK_COUNT; index++) {
    payload += asText(values[COLUMN.payloadStart + index]);
  }
  return payload;
}

function toRecord(values: unknown[], rowNumber: number): QuotationRecord {
  const statusText = asText(values[COLUMN.status]);
  const status: QuotationStatus =
    statusText === 'Approved' || statusText === 'Rejected' ? statusText : 'Pending';

  return {
    draftId: asText(values[COLUMN.draftId]),
    quotationNumber: asText(values[COLUMN.quotationNumber]),
    status,
    createdBy: asText(values[COLUMN.createdBy]),
    createdAt: asText(values[COLUMN.createdAt]),
    updatedAt: asText(values[COLUMN.updatedAt]),
    payload: joinPayload(values),
    rowNumber,
  };
}

export function findByDraftId(draftId: string): QuotationRecord | null {
  const found = findRow(sheet(), COLUMN.draftId, draftId);
  return found === null ? null : toRecord(found.values, found.rowNumber);
}

export function findByQuotationNumber(quotationNumber: string): QuotationRecord | null {
  const found = findRow(sheet(), COLUMN.quotationNumber, quotationNumber);
  return found === null ? null : toRecord(found.values, found.rowNumber);
}

export interface SaveInput {
  draftId: string;
  quotationNumber: string;
  status: QuotationStatus;
  createdBy: string;
  payload: string;
}

/** Insert a new record. */
export function insert(input: SaveInput): QuotationRecord {
  const now = new Date().toISOString();
  const chunks = splitPayload(input.payload);

  appendRow(sheet(), [
    input.draftId,
    input.quotationNumber,
    input.status,
    input.createdBy,
    now,
    now,
    ...chunks,
  ]);

  return {
    draftId: input.draftId,
    quotationNumber: input.quotationNumber,
    status: input.status,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
    payload: input.payload,
    rowNumber: sheet().getLastRow(),
  };
}

/**
 * Update an existing record in place.
 *
 * `createdAt`, `createdBy` and `quotationNumber` are never touched: the number
 * is immutable once issued (§7.7), and rewriting the creation metadata on every
 * edit would destroy the audit trail.
 */
export function update(
  existing: QuotationRecord,
  payload: string,
  status: QuotationStatus,
): QuotationRecord {
  const target = sheet();
  const now = new Date().toISOString();
  const chunks = splitPayload(payload);

  setCell(target, existing.rowNumber, COLUMN.status + 1, status);
  setCell(target, existing.rowNumber, COLUMN.updatedAt + 1, now);
  chunks.forEach((chunk, index) => {
    setCell(target, existing.rowNumber, COLUMN.payloadStart + index + 1, chunk);
  });

  return { ...existing, payload, status, updatedAt: now };
}

/**
 * Write the quotation number onto an existing row.
 *
 * Used exactly once per quotation: when a draft that was saved without a number
 * is later finalized. It refuses to overwrite a number that is already present,
 * so this cannot become a back door around immutability (§7.7).
 */
export function setQuotationNumber(existing: QuotationRecord, quotationNumber: string): void {
  if (existing.quotationNumber.length > 0 && existing.quotationNumber !== quotationNumber) {
    throw new Error('Refusing to overwrite an existing quotation number.');
  }
  setCell(sheet(), existing.rowNumber, COLUMN.quotationNumber + 1, quotationNumber);
}

export function setStatus(existing: QuotationRecord, status: QuotationStatus): void {
  const target = sheet();
  setCell(target, existing.rowNumber, COLUMN.status + 1, status);
  setCell(target, existing.rowNumber, COLUMN.updatedAt + 1, new Date().toISOString());
}

export function deleteByDraftId(draftId: string): boolean {
  const target = sheet();
  const found = findRow(target, COLUMN.draftId, draftId);
  if (found === null) return false;

  // Google Apps Script exposes `deleteRow`, and the fake spreadsheet in tests
  // mirrors it so the operation stays explicit and easy to reason about.
  if ('deleteRow' in target && typeof target.deleteRow === 'function') {
    target.deleteRow(found.rowNumber);
    return true;
  }

  const rows = readRows(target);
  const next = rows.filter((_row, index) => index + 2 !== found.rowNumber);

  target.clear();

  /*
   * The header row is rewritten UNCONDITIONALLY.
   *
   * This used to sit inside `if (next.length > 0)`, so deleting the last
   * remaining record cleared the sheet and put nothing back — every later read
   * then ran against a headerless sheet. The data rows are conditional because
   * there may be none; the headers never are.
   */
  target.getRange(1, 1, 1, QUOTATION_RECORDS_HEADERS.length).setValues([
    QUOTATION_RECORDS_HEADERS.slice(),
  ]);

  if (next.length > 0) {
    target.getRange(2, 1, next.length, QUOTATION_RECORDS_HEADERS.length).setValues(next);
  }
  return true;
}

/** Every record, newest first. Phase 11 replaces this with the tracking sheet. */
export function listAll(): QuotationRecord[] {
  const rows = readRows(sheet());
  const records: QuotationRecord[] = [];

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (row === undefined) continue;
    if (asText(row[COLUMN.draftId]).length === 0) continue;
    records.push(toRecord(row, index + 2));
  }

  return records.reverse();
}
