/**
 * The `Idempotency` sheet — draft id → quotation number.
 *
 * See IMPLEMENTATION_PLAN.md §7.5(b).
 *
 *   | Draft ID | Quotation No. | Created At |
 *
 * This is what makes reservation correct under the failure modes that actually
 * happen in practice, which locking alone does not cover:
 *
 *   - a double-clicked Save button,
 *   - a request that timed out client-side but succeeded server-side,
 *   - a retry after a Drive or Sheets failure,
 *   - a flaky connection that resends.
 *
 * Each of those would otherwise burn a quotation number and leave a permanent
 * gap in the company's official sequence. Keyed by the draft id the browser
 * minted when the user clicked "New Quotation", a repeat reservation returns
 * the SAME number instead of issuing a new one.
 */

import { appendRow, asText, findRow, getOrCreateSheet } from './sheet-access';

export const IDEMPOTENCY_SHEET_NAME = 'Idempotency';

export const IDEMPOTENCY_HEADERS = ['Draft ID', 'Quotation No.', 'Created At'] as const;

const COLUMN = {
  draftId: 0,
  quotationNumber: 1,
  createdAt: 2,
} as const;

function sheet(): GoogleAppsScript.Spreadsheet.Sheet {
  return getOrCreateSheet(IDEMPOTENCY_SHEET_NAME, IDEMPOTENCY_HEADERS);
}

/** The number already reserved for this draft, or null if none. */
export function findReservation(draftId: string): string | null {
  const found = findRow(sheet(), COLUMN.draftId, draftId);
  if (found === null) return null;

  const number = asText(found.values[COLUMN.quotationNumber]);
  return number.length === 0 ? null : number;
}

/** Record a reservation. Called only inside the numbering lock. */
export function recordReservation(draftId: string, quotationNumber: string): void {
  appendRow(sheet(), [draftId, quotationNumber, new Date().toISOString()]);
}

/**
 * True when this quotation number has already been reserved by some draft.
 *
 * The last line of defence behind the counter and the lock: if this ever
 * returns true for a freshly generated number, something has gone wrong with
 * the counter and the request must fail loudly rather than issue a duplicate.
 */
export function quotationNumberExists(quotationNumber: string): boolean {
  return findRow(sheet(), COLUMN.quotationNumber, quotationNumber) !== null;
}
