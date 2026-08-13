/**
 * Recording a quotation in the register: the money, the date, and the lock.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { installGasFakes, type GasEnvironment } from '../__fixtures__/gas-fakes';
import { DEFAULT_QUOTATION_CODES } from '@shared/numbering';
import { ApiError } from '../errors';
import { QUOTATIONS_SHEET_NAME } from '../sheets/quotations-sheet';
import { TEST_ONLY_resetBootstrapState } from '../sheets/sheet-bootstrap';
import {
  computeMoney,
  recordQuotationTracking,
  toSheetDate,
  TRACKING_LOCK_TIMEOUT_MS,
  type RecordTrackingInput,
} from './tracking';

let env: GasEnvironment;

const FOLDER_URL = 'https://drive.google.com/drive/folders/test-only-folder-1';

function input(overrides: Partial<RecordTrackingInput> = {}): RecordTrackingInput {
  return {
    quotationNumber: 'SFC/RUH/QTN/2026/004',
    quotationDate: '2026-08-11',
    clientName: 'TEST_ONLY Contact',
    companyName: 'TEST_ONLY Client Co.',
    quotationFor: 'TEST_ONLY manpower supply',
    authorizedPerson: 'TEST_ONLY_Signatory',
    money: { subtotal: 24_000, vatAmount: 3_600, grandTotal: 27_600 },
    driveFolderUrl: FOLDER_URL,
    pdfUrl: 'https://drive.google.com/file/d/test-only-file-1/view',
    docxUrl: 'https://drive.google.com/file/d/test-only-file-2/view',
    createdBy: 'staff@speedxksa.com',
    draftId: 'draft-0001',
    codes: DEFAULT_QUOTATION_CODES,
    ...overrides,
  };
}

beforeEach(() => {
  vi.unstubAllGlobals();
  env = installGasFakes(vi.stubGlobal);
  TEST_ONLY_resetBootstrapState();
});

/* -------------------------------------------------------------------------- */

describe('the money', () => {
  it('is recomputed from the stored lines, not taken from a payload', () => {
    const money = computeMoney({
      // 40 hours at SAR 20.00, plus 15% VAT.
      lines: [{ category: 'Manpower', quantity: 40_000, unitPrice: 2_000 }],
      vatRateBasisPoints: 1_500,
    });

    expect(money.subtotal).toBe(800);
    expect(money.vatAmount).toBe(120);
    expect(money.grandTotal).toBe(920);
  });

  it('ignores a line whose category is not one of the three', () => {
    const money = computeMoney({
      lines: [
        { category: 'Manpower', quantity: 1_000, unitPrice: 10_000 },
        { category: 'Consulting', quantity: 1_000, unitPrice: 999_999 },
      ],
    });

    expect(money.subtotal).toBe(100);
  });

  it('applies a discount before VAT', () => {
    const money = computeMoney({
      lines: [{ category: 'Manpower', quantity: 1_000, unitPrice: 100_000 }],
      discountRateBasisPoints: 1_000,
      vatRateBasisPoints: 1_500,
    });

    // 1000 − 10% = 900, +15% = 1035.
    expect(money.subtotal).toBe(1_000);
    expect(money.grandTotal).toBe(1_035);
  });

  it('is zero for a quotation with no usable lines', () => {
    expect(computeMoney({}).grandTotal).toBe(0);
    expect(computeMoney({ lines: 'not an array' }).grandTotal).toBe(0);
  });
});

describe('the date', () => {
  it('is written as the document prints it', () => {
    expect(toSheetDate('2026-08-11')).toBe('11-08-2026');
    expect(toSheetDate('2026-01-01')).toBe('01-01-2026');
  });

  it('does not shift across a timezone', () => {
    // Parsed as a string. `new Date('2026-08-01')` is UTC midnight, and read
    // back west of Greenwich it is the 31st of July.
    expect(toSheetDate('2026-08-01')).toBe('01-08-2026');
  });

  it('passes an unrecognised value through rather than inventing one', () => {
    expect(toSheetDate('not a date')).toBe('not a date');
  });
});

/* -------------------------------------------------------------------------- */

describe('recording', () => {
  it('writes a row and reports what it did', () => {
    const first = recordQuotationTracking(input());
    expect(first.disposition).toBe('appended');

    const second = recordQuotationTracking(input());
    expect(second.disposition).toBe('updated');

    expect(env.spreadsheet.dataRows(QUOTATIONS_SHEET_NAME)).toHaveLength(1);
  });

  it('holds the lock across the scan and the write, and always releases it', () => {
    recordQuotationTracking(input());

    // One acquisition: the uniqueness scan and the append are one critical
    // section, or two concurrent saves can both pass the check.
    expect(env.lock.acquisitions()).toBe(1);
    expect(env.lock.isHeld()).toBe(false);
  });

  it('releases the lock when the write fails', () => {
    recordQuotationTracking(input());

    expect(() => recordQuotationTracking(input({ draftId: 'draft-0002' }))).toThrow(ApiError);
    expect(env.lock.isHeld()).toBe(false);
  });

  it('tells the caller to retry when the lock cannot be taken', () => {
    env.lock.failNextAcquisition();

    try {
      recordQuotationTracking(input());
      expect.unreachable('should have thrown');
    } catch (error: unknown) {
      expect((error as ApiError).code).toBe('SHEETS_WRITE_FAILED');
      expect((error as ApiError).message).toMatch(/retry/i);
    }
  });

  it('waits no longer than Apps Script allows', () => {
    expect(TRACKING_LOCK_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });

  it('reports a duplicate number by its own code', () => {
    recordQuotationTracking(input());

    try {
      recordQuotationTracking(input({ draftId: 'draft-0002' }));
      expect.unreachable('should have thrown');
    } catch (error: unknown) {
      expect((error as ApiError).code).toBe('DUPLICATE_QUOTATION_NUMBER');
    }
  });

  it('refuses a number that is not a quotation number', () => {
    try {
      recordQuotationTracking(input({ quotationNumber: 'nonsense' }));
      expect.unreachable('should have thrown');
    } catch (error: unknown) {
      expect((error as ApiError).code).toBe('VALIDATION_FAILED');
    }
    expect(env.spreadsheet.dataRows(QUOTATIONS_SHEET_NAME)).toHaveLength(0);
  });
});
