/**
 * Quotation numbering under genuine contention, and the parts of the mandatory
 * matrix (IMPLEMENTATION_PLAN.md §20.2) that no single-module test can reach.
 *
 * `src/quotation-number/reserve.test.ts` covers the reserver in isolation. This
 * file covers what only the whole stack shows:
 *
 *   - requests genuinely interleaved inside each other's critical section,
 *   - the negative control that proves the interleaving is real,
 *   - the year-reset figures the plan names (…/2026/125 → …/2027/001),
 *   - a mocked clock in a year the code has never seen.
 *
 * See `test/fakes/interleaving.ts` for why a sequential loop would prove
 * nothing here.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installGasFakes, type GasEnvironment } from '../src/__fixtures__/gas-fakes';
import {
  COUNTERS_SHEET_NAME,
  readLastSequence,
  writeLastSequence,
} from '../src/sheets/counters-sheet';
import { reserveQuotationNumber, type NumberingLock } from '../src/quotation-number/reserve';
import { ApiError } from '../src/errors';
import { parseQuotationNumber } from '@shared/numbering';
import { interleave } from '../../test/fakes/interleaving';
import { withFrozenClock } from '../../test/helpers/clock';

let env: GasEnvironment;

beforeEach(() => {
  env = installGasFakes(vi.stubGlobal);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Ids that name themselves in a failure message. */
function drafts(count: number): string[] {
  return Array.from({ length: count }, (_value, index) => `TEST_ONLY_draft-${String(index + 1)}`);
}

function codeOf(error: unknown): string {
  return error instanceof ApiError ? error.code : `not an ApiError: ${String(error)}`;
}

/* -------------------------------------------------------------------------- */
/* Concurrency — N requests genuinely inside one another                      */
/* -------------------------------------------------------------------------- */

describe('concurrent reservation', () => {
  const QUOTATION_DATE = '2026-03-09';

  it('gives eight interleaved requests eight distinct numbers, with no gaps', () => {
    const ids = drafts(8);

    const report = interleave({
      ids,
      seam: COUNTERS_SHEET_NAME,
      arm: (atSeam) => {
        env.spreadsheet.onRead(atSeam);
      },
      run: (draftId) =>
        reserveQuotationNumber({ draftId, quotationDate: QUOTATION_DATE }).canonical,
    });

    const issued = ids.map((id) => report.settled.get(id)?.value ?? '');
    const sequences = issued
      .map((canonical) => parseQuotationNumber(canonical)?.sequence ?? -1)
      .sort((left, right) => left - right);

    expect(new Set(issued).size, `duplicate numbers issued: ${issued.join(', ')}`).toBe(ids.length);
    expect(sequences).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(readLastSequence(2026)).toBe(8);
  });

  it('actually suspends a request inside another request', () => {
    // Without this the suite above would pass on a sequential loop, which is
    // exactly the failure mode this file exists to rule out.
    const ids = drafts(4);

    const report = interleave({
      ids,
      seam: COUNTERS_SHEET_NAME,
      arm: (atSeam) => {
        env.spreadsheet.onRead(atSeam);
      },
      run: (draftId) =>
        reserveQuotationNumber({ draftId, quotationDate: QUOTATION_DATE }).canonical,
    });

    expect(report.reentrant.length).toBeGreaterThan(0);
    expect(report.attempts.length).toBeGreaterThan(ids.length);
  });

  it('refuses every request that arrives mid-critical-section, with NUMBERING_LOCKED', () => {
    const ids = drafts(5);

    const report = interleave({
      ids,
      seam: COUNTERS_SHEET_NAME,
      arm: (atSeam) => {
        env.spreadsheet.onRead(atSeam);
      },
      run: (draftId) =>
        reserveQuotationNumber({ draftId, quotationDate: QUOTATION_DATE }).canonical,
    });

    // A request that barged in is turned away at the lock and never reaches the
    // counter. That refusal — not a queue, not a wait — is what the client
    // retries with backoff (§23.2).
    const codes = new Set(report.reentrant.map((attempt) => codeOf(attempt.error)));
    expect([...codes]).toEqual(['NUMBERING_LOCKED']);
  });

  it('burns no number on a request that was turned away', () => {
    const ids = drafts(6);

    interleave({
      ids,
      seam: COUNTERS_SHEET_NAME,
      arm: (atSeam) => {
        env.spreadsheet.onRead(atSeam);
      },
      run: (draftId) =>
        reserveQuotationNumber({ draftId, quotationDate: QUOTATION_DATE }).canonical,
    });

    // Six drafts, six numbers, six ledger rows — however many refusals it took.
    expect(readLastSequence(2026)).toBe(6);
    expect(env.spreadsheet.dataRows('Idempotency')).toHaveLength(6);
  });

  it('without the lock, the same interleaving produces the collision the lock prevents', () => {
    /*
     * The negative control.
     *
     * Same harness, same seam, same requests — only the lock is replaced with
     * one that grants every caller. If the interleaving were fake, this would
     * behave identically to the test above. It does not: the intruders read the
     * counter value the suspended request has not yet written back, and the
     * ledger — the last line of defence behind the counter and the lock — is
     * what stops two documents sharing an identifier.
     */
    const grantsEveryone: NumberingLock = { tryLock: () => true, releaseLock: () => undefined };
    const ids = drafts(4);

    const report = interleave({
      ids,
      seam: COUNTERS_SHEET_NAME,
      arm: (atSeam) => {
        env.spreadsheet.onRead(atSeam);
      },
      run: (draftId) =>
        reserveQuotationNumber({ draftId, quotationDate: QUOTATION_DATE }, { lock: grantsEveryone })
          .canonical,
    });

    const failures = report.attempts
      .filter((attempt) => attempt.error !== null)
      .map((attempt) => codeOf(attempt.error));

    expect(failures, 'an unlocked interleaving must collide').not.toEqual([]);
    expect(new Set(failures)).toEqual(new Set(['DUPLICATE_QUOTATION_NUMBER']));

    // Not NUMBERING_LOCKED — with the lock gone, nothing is turned away at the
    // door. The intruders get all the way to the counter, read the value the
    // suspended request is still holding, and are caught by the ledger instead.
    expect(failures).not.toContain('NUMBERING_LOCKED');

    // And critically: no duplicate was ever ISSUED. The requests failed instead.
    const issued = env.spreadsheet.dataRows('Idempotency').map((row) => String(row[1]));
    expect(new Set(issued).size).toBe(issued.length);
    expect(issued).toHaveLength(ids.length);
  });
});

/* -------------------------------------------------------------------------- */
/* Year reset — the figures the plan names                                     */
/* -------------------------------------------------------------------------- */

describe('the year boundary', () => {
  it('reaches …/2026/125 and then starts 2027 at 001', () => {
    // Seed the counter rather than issuing 124 numbers: the increment is proved
    // above, and what this test is about is the boundary.
    writeLastSequence(2026, 124);

    const last2026 = reserveQuotationNumber({
      draftId: 'TEST_ONLY_draft-last-2026',
      quotationDate: '2026-12-31',
    });
    const first2027 = reserveQuotationNumber({
      draftId: 'TEST_ONLY_draft-first-2027',
      quotationDate: '2027-01-01',
    });

    expect(last2026.canonical).toBe('SFC/RUH/QTN/2026/125');
    expect(first2027.canonical).toBe('SFC/RUH/QTN/2027/001');
  });

  it('leaves the 2026 counter where it was when 2027 opens', () => {
    writeLastSequence(2026, 124);
    reserveQuotationNumber({ draftId: 'TEST_ONLY_a', quotationDate: '2026-12-31' });
    reserveQuotationNumber({ draftId: 'TEST_ONLY_b', quotationDate: '2027-01-01' });

    expect(readLastSequence(2026)).toBe(125);
    expect(readLastSequence(2027)).toBe(1);
  });

  it('still files a backdated quotation against the year it is dated', () => {
    writeLastSequence(2026, 125);
    reserveQuotationNumber({ draftId: 'TEST_ONLY_first-2027', quotationDate: '2027-01-04' });

    // Finalized in 2027, dated 2026: it must draw from the 2026 counter (§7.6).
    const backdated = reserveQuotationNumber({
      draftId: 'TEST_ONLY_backdated',
      quotationDate: '2026-12-28',
    });

    expect(backdated.canonical).toBe('SFC/RUH/QTN/2026/126');
    expect(readLastSequence(2027)).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* The clock                                                                   */
/* -------------------------------------------------------------------------- */

describe('the system clock', () => {
  it('is not consulted: a 2031 quotation numbered on a 2031 machine gives …/2031/001', () => {
    const reserved = withFrozenClock('2031-06-15T09:00:00.000Z', () =>
      reserveQuotationNumber({
        draftId: 'TEST_ONLY_draft-2031',
        quotationDate: '2031-06-15',
      }),
    );

    expect(reserved.canonical).toBe('SFC/RUH/QTN/2031/001');
  });

  it('follows the quotation date when the two disagree', () => {
    const reserved = withFrozenClock('2031-06-15T09:00:00.000Z', () =>
      reserveQuotationNumber({
        draftId: 'TEST_ONLY_draft-dated-2029',
        quotationDate: '2029-02-02',
      }),
    );

    expect(reserved.canonical).toBe('SFC/RUH/QTN/2029/001');
    expect(readLastSequence(2031)).toBe(0);
  });

  it('numbers a year the code has never been run in without special-casing it', () => {
    const reserved = withFrozenClock('2041-01-01T00:00:00.000Z', () =>
      reserveQuotationNumber({
        draftId: 'TEST_ONLY_draft-2041',
        quotationDate: '2041-01-01',
      }),
    );

    expect(reserved.canonical).toBe('SFC/RUH/QTN/2041/001');
  });
});
