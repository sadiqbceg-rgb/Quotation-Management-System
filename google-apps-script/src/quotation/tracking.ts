/**
 * Writing a quotation into the tracking register — PRD §30 step 13.
 *
 * ---------------------------------------------------------------------------
 * THE MONEY IS COMPUTED HERE, NOT ACCEPTED
 * ---------------------------------------------------------------------------
 * Every figure written to the sheet is recomputed from the stored line items
 * through `calculateTotals`, the same function the document uses. Nothing is
 * taken from the request. A client that could name its own `Total Amount` could
 * put a different number in the register from the one on the document it just
 * sent — and the register is what the company invoices from.
 *
 * ---------------------------------------------------------------------------
 * WHY THE LOCK
 * ---------------------------------------------------------------------------
 * The uniqueness scan and the append have to be one critical section (§17.4).
 * Between "is this number already present?" and the append, another request can
 * append the same number, and both pass. The window is milliseconds and the
 * consequence is two clients holding one quotation reference.
 */

import { calculateTotals } from '@shared/totals';
import { halalas, halalasToSar, milli } from '@shared/money';
import { isValidQuotationNumber, type QuotationCodes } from '@shared/numbering';
import type { ItemCategory } from '@shared/types';
import { ApiError } from '../errors';
import { bootstrapQuotationsSheet } from '../sheets/sheet-bootstrap';
import {
  QuotationSheetError,
  upsertQuotationRow,
  type QuotationRow,
  type TrackingInput,
} from '../sheets/quotations-sheet';

/**
 * How long to wait for the register lock.
 *
 * Apps Script caps this at 30 s. The critical section is a column scan and one
 * `setValues`; a caller that cannot get in is told to retry, and the retry
 * updates in place rather than appending.
 */
export const TRACKING_LOCK_TIMEOUT_MS = 30_000;

/** Injectable so tests can drive the lock and assert the critical section. */
export interface TrackingLock {
  tryLock: (timeoutMs: number) => boolean;
  releaseLock: () => void;
}

function defaultLock(): TrackingLock {
  // getScriptLock: the register is global, so mutual exclusion must span every
  // user of the deployment, not just concurrent tabs of one.
  return LockService.getScriptLock();
}

/* -------------------------------------------------------------------------- */
/* Recomputing the money                                                      */
/* -------------------------------------------------------------------------- */

interface StoredLine {
  category?: unknown;
  quantity?: unknown;
  unitPrice?: unknown;
}

const CATEGORIES: readonly string[] = ['Manpower', 'Equipment', 'Materials'];

export interface ComputedMoney {
  /** SAR, not halalas — the sheet is read by people. */
  subtotal: number;
  vatAmount: number;
  grandTotal: number;
}

/**
 * Recompute the totals from the stored line items.
 *
 * Uses the same integer arithmetic as the document (halalas throughout, one
 * conversion to SAR at the end), so the register and the PDF can never disagree
 * by a rounding step.
 */
export function computeMoney(stored: {
  lines?: unknown;
  discountRateBasisPoints?: unknown;
  vatRateBasisPoints?: unknown;
}): ComputedMoney {
  const raw = Array.isArray(stored.lines) ? (stored.lines as StoredLine[]) : [];

  const lines = raw
    .filter((line) => typeof line.category === 'string' && CATEGORIES.includes(line.category))
    .map((line) => ({
      category: line.category as ItemCategory,
      quantity: milli(typeof line.quantity === 'number' ? line.quantity : 0),
      unitPrice: halalas(typeof line.unitPrice === 'number' ? line.unitPrice : 0),
    }));

  const totals = calculateTotals({
    lines,
    ...(typeof stored.discountRateBasisPoints === 'number'
      ? { discountRateBasisPoints: stored.discountRateBasisPoints }
      : {}),
    ...(typeof stored.vatRateBasisPoints === 'number'
      ? { vatRateBasisPoints: stored.vatRateBasisPoints }
      : {}),
  });

  return {
    subtotal: halalasToSar(totals.subtotal),
    vatAmount: halalasToSar(totals.vatAmount),
    grandTotal: halalasToSar(totals.grandTotal),
  };
}

/**
 * `2026-08-11` → `11-08-2026`, matching the document and PRD §31.
 *
 * Split as a string rather than through `Date`: `new Date('2026-08-01')` is UTC
 * midnight, and read back west of Greenwich it is the 31st of July.
 */
export function toSheetDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (match === null) return isoDate.trim();

  const [, year = '', month = '', day = ''] = match;
  return `${day}-${month}-${year}`;
}

/* -------------------------------------------------------------------------- */
/* Recording                                                                  */
/* -------------------------------------------------------------------------- */

export interface RecordTrackingInput {
  quotationNumber: string;
  quotationDate: string;
  clientName: string;
  companyName: string;
  quotationFor: string;
  authorizedPerson: string;
  money: ComputedMoney;
  driveFolderUrl: string;
  pdfUrl: string;
  docxUrl: string;
  createdBy: string;
  draftId: string;
  codes: QuotationCodes;
}

export interface RecordTrackingDependencies {
  lock?: TrackingLock;
}

export interface RecordedTracking {
  row: QuotationRow;
  disposition: 'appended' | 'updated';
}

/**
 * Append or update the register row for a quotation.
 *
 * The scan and the write are one critical section; the read-back inside
 * `upsertQuotationRow` confirms the row landed.
 */
export function recordQuotationTracking(
  input: RecordTrackingInput,
  dependencies: RecordTrackingDependencies = {},
): RecordedTracking {
  if (!isValidQuotationNumber(input.quotationNumber, input.codes)) {
    throw new ApiError('VALIDATION_FAILED', 'A valid quotation number is required.');
  }

  const lock = dependencies.lock ?? defaultLock();

  if (!lock.tryLock(TRACKING_LOCK_TIMEOUT_MS)) {
    throw new ApiError(
      'SHEETS_WRITE_FAILED',
      'The quotation register is busy. The documents are saved; please retry tracking.',
    );
  }

  try {
    // Idempotent, and what guarantees the headers, the Status dropdown and the
    // number formats exist before the first row is ever written.
    bootstrapQuotationsSheet();

    const payload: TrackingInput = {
      quotationNumber: input.quotationNumber,
      quotationDate: toSheetDate(input.quotationDate),
      clientName: input.clientName,
      companyName: input.companyName,
      quotationFor: input.quotationFor,
      totalAmount: input.money.grandTotal,
      subtotal: input.money.subtotal,
      vatAmount: input.money.vatAmount,
      authorizedPerson: input.authorizedPerson,
      driveFolderUrl: input.driveFolderUrl,
      pdfUrl: input.pdfUrl,
      docxUrl: input.docxUrl,
      createdBy: input.createdBy,
      draftId: input.draftId,
      codes: input.codes,
    };

    return upsertQuotationRow(payload);
  } catch (thrown: unknown) {
    if (thrown instanceof ApiError) throw thrown;

    if (thrown instanceof QuotationSheetError) {
      // The one sheet failure with its own meaning: two quotations claiming a
      // single identifier. Everything else is a write failure.
      if (thrown.message.indexOf('already in the register') !== -1) {
        throw new ApiError('DUPLICATE_QUOTATION_NUMBER', thrown.message);
      }
      throw new ApiError('SHEETS_WRITE_FAILED', thrown.message);
    }

    // Detail stays in Cloud Logging; the client gets a message it can act on.
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    console.error(`Quotation tracking write failed: ${message}`);

    throw new ApiError(
      'SHEETS_WRITE_FAILED',
      'The documents were saved to Google Drive, but quotation tracking was not updated.',
    );
  } finally {
    lock.releaseLock();
  }
}
