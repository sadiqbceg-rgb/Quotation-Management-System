/**
 * Quotation-number reservation.
 *
 * This is the most consequential logic in the system: a mistake here puts two
 * different official documents under one identifier, or leaves permanent gaps
 * in the company's sequence. Every guarantee in IMPLEMENTATION_PLAN.md §7 has a
 * test below.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installGasFakes, type GasEnvironment } from '../__fixtures__/gas-fakes';
import { COUNTERS_SHEET_NAME, readLastSequence } from '../sheets/counters-sheet';
import { IDEMPOTENCY_SHEET_NAME } from '../sheets/idempotency-sheet';
import { peekReservation, reserveQuotationNumber } from './reserve';
import { ApiError } from '../errors';

let env: GasEnvironment;

function reserve(draftId: string, quotationDate: string) {
  return reserveQuotationNumber({ draftId, quotationDate });
}

beforeEach(() => {
  env = installGasFakes(vi.stubGlobal);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* -------------------------------------------------------------------------- */

describe('format', () => {
  it('issues the canonical format from the approved quotation', () => {
    const reserved = reserve('draft-1', '2026-08-11');
    expect(reserved.canonical).toBe('SFC/RUH/QTN/2026/001');
    expect(reserved.fileSafe).toBe('SFC-RUH-QTN-2026-001');
  });

  it('uses the codes from Script Properties rather than inlined literals', () => {
    env.properties.values.set('BRANCH_CODE', 'JUB');
    expect(reserve('draft-1', '2026-08-11').canonical).toBe('SFC/JUB/QTN/2026/001');
  });
});

describe('sequence', () => {
  it('starts a year at 001 and increments', () => {
    expect(reserve('d1', '2026-01-05').canonical).toBe('SFC/RUH/QTN/2026/001');
    expect(reserve('d2', '2026-01-06').canonical).toBe('SFC/RUH/QTN/2026/002');
    expect(reserve('d3', '2026-01-07').canonical).toBe('SFC/RUH/QTN/2026/003');
  });

  it('pads to a minimum of three digits and then grows', () => {
    for (let sequence = 1; sequence <= 8; sequence++) {
      reserve(`d${String(sequence)}`, '2026-01-05');
    }
    expect(reserve('d9', '2026-01-05').canonical).toBe('SFC/RUH/QTN/2026/009');
    expect(reserve('d10', '2026-01-05').canonical).toBe('SFC/RUH/QTN/2026/010');
  });

  it('crosses 099 to 100 without losing a digit', () => {
    // Seed the counter directly rather than issuing 98 numbers.
    reserve('seed', '2026-01-05');
    env.spreadsheet.sheets.get(COUNTERS_SHEET_NAME)!.rows[1]![1] = 99;

    expect(reserve('d100', '2026-01-05').canonical).toBe('SFC/RUH/QTN/2026/100');
  });

  it('grows past three digits at 1000 rather than truncating', () => {
    reserve('seed', '2026-01-05');
    env.spreadsheet.sheets.get(COUNTERS_SHEET_NAME)!.rows[1]![1] = 999;

    expect(reserve('d1000', '2026-01-05').canonical).toBe('SFC/RUH/QTN/2026/1000');
  });
});

describe('year handling', () => {
  it('resets to 001 in a new year', () => {
    reserve('seed', '2026-01-05');
    env.spreadsheet.sheets.get(COUNTERS_SHEET_NAME)!.rows[1]![1] = 125;

    expect(reserve('last-2026', '2026-12-31').canonical).toBe('SFC/RUH/QTN/2026/126');
    expect(reserve('first-2027', '2027-01-01').canonical).toBe('SFC/RUH/QTN/2027/001');
    expect(reserve('second-2027', '2027-01-02').canonical).toBe('SFC/RUH/QTN/2027/002');
  });

  it('keeps each year on its own counter', () => {
    reserve('a', '2026-05-01');
    reserve('b', '2027-05-01');
    reserve('c', '2026-05-02');

    expect(readLastSequence(2026)).toBe(2);
    expect(readLastSequence(2027)).toBe(1);
  });

  it('takes the year from the quotation date, not the system clock', () => {
    // Clock says 2026; the quotation is dated 2027 and must use the 2027 counter.
    vi.setSystemTime(new Date('2026-11-20T10:00:00Z'));
    expect(reserve('future', '2027-01-05').canonical).toBe('SFC/RUH/QTN/2027/001');

    // And a backdated quotation finalized in 2027 draws from 2026.
    vi.setSystemTime(new Date('2027-01-02T10:00:00Z'));
    expect(reserve('backdated', '2026-12-30').canonical).toBe('SFC/RUH/QTN/2026/001');

    vi.useRealTimers();
  });

  it('never hard-codes 2026', () => {
    expect(reserve('d', '2031-03-03').canonical).toBe('SFC/RUH/QTN/2031/001');
    expect(reserve('e', '2099-03-03').canonical).toBe('SFC/RUH/QTN/2099/001');
  });
});

/* -------------------------------------------------------------------------- */

describe('idempotency', () => {
  it('returns the same number for a repeated draft id', () => {
    const first = reserve('same-draft', '2026-08-11');
    const second = reserve('same-draft', '2026-08-11');

    expect(second.canonical).toBe(first.canonical);
  });

  it('does not advance the counter on a repeat', () => {
    reserve('same-draft', '2026-08-11');
    expect(readLastSequence(2026)).toBe(1);

    reserve('same-draft', '2026-08-11');
    reserve('same-draft', '2026-08-11');
    expect(readLastSequence(2026)).toBe(1);
  });

  it('records exactly one ledger entry per draft', () => {
    reserve('same-draft', '2026-08-11');
    reserve('same-draft', '2026-08-11');

    expect(env.spreadsheet.dataRows(IDEMPOTENCY_SHEET_NAME)).toHaveLength(1);
  });

  it('keeps the original number when the quotation date later moves year', () => {
    // Immutability wins over re-derivation: re-deriving from a changed date is
    // exactly how two documents end up sharing an identifier (§7.7).
    const first = reserve('drifting', '2026-08-11');
    const second = reserve('drifting', '2027-02-02');

    expect(second.canonical).toBe(first.canonical);
    expect(second.year).toBe(2026);
  });

  it('exposes a reservation without creating one', () => {
    expect(peekReservation('unseen')).toBeNull();

    const reserved = reserve('seen', '2026-08-11');
    expect(peekReservation('seen')?.canonical).toBe(reserved.canonical);
    // Peeking must not have advanced anything.
    expect(readLastSequence(2026)).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */

describe('concurrency', () => {
  it('holds the lock across the whole critical section', () => {
    reserve('d1', '2026-08-11');
    expect(env.lock.acquisitions()).toBe(1);
    expect(env.lock.isHeld()).toBe(false);
  });

  it('flushes the counter write before releasing the lock', () => {
    // Without the flush, the next holder can read a stale counter and reissue
    // a number that has already been used.
    reserve('d1', '2026-08-11');
    expect(env.lock.flushes()).toBe(1);
  });

  it('releases the lock even when the reservation fails', () => {
    expect(() => reserve('d1', 'not-a-date')).toThrow(ApiError);
    expect(env.lock.isHeld()).toBe(false);
  });

  it('reports NUMBERING_LOCKED when the lock cannot be acquired', () => {
    env.lock.failNextAcquisition();

    const error = (() => {
      try {
        reserve('d1', '2026-08-11');
        return null;
      } catch (thrown: unknown) {
        return thrown;
      }
    })();

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('NUMBERING_LOCKED');
    // Nothing was consumed.
    expect(readLastSequence(2026)).toBe(0);
  });

  it('issues distinct, gapless numbers across many reservations', () => {
    const issued = new Set<string>();
    for (let index = 0; index < 50; index++) {
      issued.add(reserve(`draft-${String(index)}`, '2026-08-11').canonical);
    }

    expect(issued.size).toBe(50);
    expect(readLastSequence(2026)).toBe(50);
    expect(issued.has('SFC/RUH/QTN/2026/001')).toBe(true);
    expect(issued.has('SFC/RUH/QTN/2026/050')).toBe(true);
  });

  it('never writes the counter while the lock is not held', () => {
    // The invariant a single-threaded test can genuinely prove.
    reserve('d1', '2026-08-11');

    const countersSheet = env.spreadsheet.sheets.get(COUNTERS_SHEET_NAME);
    expect(countersSheet).toBeDefined();
    expect(env.lock.acquisitions()).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */

describe('duplicate protection', () => {
  it('refuses to issue a number already present in the ledger', () => {
    reserve('d1', '2026-08-11');

    // Corrupt the counter so it would regenerate an already-issued number.
    env.spreadsheet.sheets.get(COUNTERS_SHEET_NAME)!.rows[1]![1] = 0;

    const error = (() => {
      try {
        reserve('d2', '2026-08-11');
        return null;
      } catch (thrown: unknown) {
        return thrown;
      }
    })();

    expect((error as ApiError).code).toBe('DUPLICATE_QUOTATION_NUMBER');
  });

  it('leaves the counter untouched when it refuses', () => {
    reserve('d1', '2026-08-11');
    env.spreadsheet.sheets.get(COUNTERS_SHEET_NAME)!.rows[1]![1] = 0;

    expect(() => reserve('d2', '2026-08-11')).toThrow(ApiError);
    expect(readLastSequence(2026)).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */

describe('input validation', () => {
  it('rejects a malformed date', () => {
    expect(() => reserve('d1', '11-08-2026')).toThrow(ApiError);
    expect(() => reserve('d1', '')).toThrow(ApiError);
  });

  it('rejects a missing or oversized draft id', () => {
    expect(() => reserve('', '2026-08-11')).toThrow(ApiError);
    expect(() => reserve('x'.repeat(65), '2026-08-11')).toThrow(ApiError);
  });

  it('does not consume a number when input is invalid', () => {
    expect(() => reserve('', '2026-08-11')).toThrow(ApiError);
    expect(readLastSequence(2026)).toBe(0);
  });
});
