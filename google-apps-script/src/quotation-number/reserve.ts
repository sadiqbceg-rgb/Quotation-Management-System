/**
 * Quotation-number reservation — the atomic core of the whole system.
 *
 * See IMPLEMENTATION_PLAN.md §7.
 *
 *   SFC/RUH/QTN/YYYY/###        e.g. SFC/RUH/QTN/2026/004
 *
 * Guarantees, all of which are tested:
 *
 *   1. Server-authoritative — the browser never invents an official number.
 *   2. Per-year sequence, resetting to 001 each January.
 *   3. The year comes from the QUOTATION DATE, never the system clock.
 *   4. Mutually exclusive — the read-increment-write runs under a script lock.
 *   5. Idempotent — the same draft id always gets the same number back.
 *   6. Unique — a duplicate is a hard error, never silently resolved.
 *
 * The critical section is deliberately tiny: counter read, increment, write,
 * flush. No Drive call, no document generation, no network request happens
 * while the lock is held, because every user of the system serialises here.
 */

import {
  createQuotationNumber,
  quotationNumberFromCanonical,
  quotationYearFromDate,
  type QuotationNumber,
} from '@shared/numbering';
import { PATTERNS } from '@shared/validation-rules';
import { quotationCodes } from '../config/properties';
import { ApiError } from '../errors';
import * as counters from '../sheets/counters-sheet';
import * as idempotency from '../sheets/idempotency-sheet';

/**
 * How long to wait for the lock.
 *
 * Apps Script caps `waitLock`/`tryLock` at 30 s. A caller that cannot get in
 * within that window is told to retry rather than being queued indefinitely.
 */
export const LOCK_TIMEOUT_MS = 30_000;

/** Injectable so tests can drive the lock and assert the critical section. */
export interface NumberingLock {
  tryLock: (timeoutMs: number) => boolean;
  releaseLock: () => void;
}

function defaultLock(): NumberingLock {
  // getScriptLock, not getUserLock: the counter is global, so mutual exclusion
  // must span every user of the deployment, not just concurrent tabs of one.
  return LockService.getScriptLock();
}

function flush(): void {
  // Forces the counter write to be durable BEFORE the lock is released.
  // Without this, the next holder of the lock can read a stale value and
  // hand out a number that has already been issued.
  SpreadsheetApp.flush();
}

export interface ReserveInput {
  draftId: string;
  /** ISO `YYYY-MM-DD`. Determines which year's counter is used. */
  quotationDate: string;
}

export interface ReserveDependencies {
  lock?: NumberingLock;
  flush?: () => void;
}

/**
 * Reserve — or return the already-reserved — quotation number for a draft.
 *
 * Called only when the user explicitly finalizes a quotation. Opening the
 * application or the New Quotation form must never reach this (PRD §35).
 */
export function reserveQuotationNumber(
  input: ReserveInput,
  dependencies: ReserveDependencies = {},
): QuotationNumber {
  const codes = quotationCodes();

  if (!PATTERNS.isoDate.test(input.quotationDate)) {
    throw new ApiError('VALIDATION_FAILED', 'A valid quotation date is required.', {
      quotationDate: 'Enter a valid date.',
    });
  }

  const draftId = input.draftId.trim();
  if (draftId.length === 0 || draftId.length > 64) {
    throw new ApiError('VALIDATION_FAILED', 'A valid draft identifier is required.');
  }

  const year = quotationYearFromDate(input.quotationDate);

  const lock = dependencies.lock ?? defaultLock();
  const flushWrites = dependencies.flush ?? flush;

  if (!lock.tryLock(LOCK_TIMEOUT_MS)) {
    throw new ApiError(
      'NUMBERING_LOCKED',
      'The system is busy issuing a quotation number. Please try again.',
    );
  }

  try {
    /*
     * Idempotency first, inside the lock.
     *
     * A number already reserved for this draft is returned unchanged even if
     * the quotation date has since moved to another year: the number is
     * immutable once issued (§7.7), and re-deriving it from a changed date is
     * exactly the bug that would produce two documents sharing an identifier.
     */
    const existing = idempotency.findReservation(draftId);
    if (existing !== null) {
      return quotationNumberFromCanonical(existing, codes);
    }

    const next = counters.readLastSequence(year) + 1;
    const reserved = createQuotationNumber(year, next, codes);

    if (idempotency.quotationNumberExists(reserved.canonical)) {
      // The counter and the ledger disagree. Refuse rather than issue a
      // duplicate, and leave the counter untouched so a human can inspect it.
      throw new ApiError(
        'DUPLICATE_QUOTATION_NUMBER',
        'That quotation number already exists. Please contact an administrator.',
      );
    }

    counters.writeLastSequence(year, next);
    idempotency.recordReservation(draftId, reserved.canonical);

    flushWrites();

    return reserved;
  } finally {
    // Always released, including on the duplicate/validation error paths.
    lock.releaseLock();
  }
}

/** The number already reserved for a draft, without reserving one. */
export function peekReservation(draftId: string): QuotationNumber | null {
  const existing = idempotency.findReservation(draftId);
  return existing === null ? null : quotationNumberFromCanonical(existing, quotationCodes());
}
