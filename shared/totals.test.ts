import { describe, expect, it } from 'vitest';
import { quantityToMilli, sarToHalalas, sumHalalas, type Halalas } from './money.js';
import {
  DEFAULT_VAT_RATE_BASIS_POINTS,
  TotalsError,
  calculateLineAmount,
  calculateTotals,
  totalsMatch,
  type TotalsLineInput,
} from './totals.js';

const line = (
  category: TotalsLineInput['category'],
  quantity: number,
  priceSar: number,
): TotalsLineInput => ({
  category,
  quantity: quantityToMilli(quantity),
  unitPrice: sarToHalalas(priceSar),
});

describe('defaults', () => {
  it('uses the 15% KSA VAT rate from the reference documents', () => {
    expect(DEFAULT_VAT_RATE_BASIS_POINTS).toBe(1500);
  });
});

describe('calculateTotals', () => {
  it('computes subtotal, VAT and grand total', () => {
    const totals = calculateTotals({ lines: [line('Manpower', 40, 20), line('Manpower', 1, 30)] });

    expect(totals.subtotal).toBe(830_00);
    expect(totals.discountAmount).toBe(0);
    expect(totals.taxableBase).toBe(830_00);
    expect(totals.vatRateBasisPoints).toBe(1500);
    expect(totals.vatAmount).toBe(124_50);
    expect(totals.grandTotal).toBe(954_50);
  });

  it('keeps a subtotal per category', () => {
    const totals = calculateTotals({
      lines: [line('Manpower', 10, 20), line('Equipment', 2, 500), line('Materials', 100, 12.5)],
    });

    expect(totals.categorySubtotals.Manpower).toBe(200_00);
    expect(totals.categorySubtotals.Equipment).toBe(1000_00);
    expect(totals.categorySubtotals.Materials).toBe(1250_00);
    expect(totals.subtotal).toBe(2450_00);
  });

  it('omits a category that has no lines', () => {
    const totals = calculateTotals({ lines: [line('Manpower', 1, 100)] });
    expect(totals.categorySubtotals.Equipment).toBeUndefined();
    expect(totals.categorySubtotals.Materials).toBeUndefined();
  });

  it('applies a discount before VAT', () => {
    const totals = calculateTotals({
      lines: [line('Materials', 1, 1000)],
      discountRateBasisPoints: 1000, // 10%
    });

    expect(totals.subtotal).toBe(1000_00);
    expect(totals.discountAmount).toBe(100_00);
    expect(totals.taxableBase).toBe(900_00);
    expect(totals.vatAmount).toBe(135_00);
    expect(totals.grandTotal).toBe(1035_00);
  });

  it('treats an absent discount as zero', () => {
    const totals = calculateTotals({ lines: [line('Materials', 1, 1000)] });
    expect(totals.discountAmount).toBe(0);
    expect(totals.discountRateBasisPoints).toBeUndefined();
  });

  it('supports VAT being switched off', () => {
    const totals = calculateTotals({
      lines: [line('Materials', 1, 1000)],
      vatRateBasisPoints: 0,
    });
    expect(totals.vatAmount).toBe(0);
    expect(totals.grandTotal).toBe(1000_00);
  });

  it('supports a non-default VAT rate', () => {
    const totals = calculateTotals({
      lines: [line('Materials', 1, 1000)],
      vatRateBasisPoints: 500,
    });
    expect(totals.vatAmount).toBe(50_00);
  });

  it('handles an empty quotation', () => {
    const totals = calculateTotals({ lines: [] });
    expect(totals.subtotal).toBe(0);
    expect(totals.grandTotal).toBe(0);
  });

  it('rejects an out-of-range rate', () => {
    expect(() => calculateTotals({ lines: [], vatRateBasisPoints: 10_001 })).toThrow(TotalsError);
    expect(() => calculateTotals({ lines: [], discountRateBasisPoints: -1 })).toThrow(TotalsError);
    expect(() => calculateTotals({ lines: [], vatRateBasisPoints: 15.5 })).toThrow(TotalsError);
  });
});

describe('printed column integrity', () => {
  it('sums the printed line amounts exactly to the printed subtotal', () => {
    // The document prints each Amount and then a Subtotal. If rounding were
    // deferred to the end, the visible column would not add up to the visible
    // total — unacceptable on an official quotation (§8.2).
    const lines: TotalsLineInput[] = Array.from({ length: 200 }, (_unused, index) =>
      line('Materials', 1 + (index % 7) * 0.125, 3.33 + (index % 5) * 0.07),
    );

    const printedAmounts: Halalas[] = lines.map((entry) =>
      calculateLineAmount(entry.quantity, entry.unitPrice),
    );

    expect(calculateTotals({ lines }).subtotal).toBe(sumHalalas(printedAmounts));
  });
});

describe('totalsMatch', () => {
  it('accepts an identical recomputation', () => {
    const input = { lines: [line('Manpower', 40, 20)] };
    expect(totalsMatch(calculateTotals(input), calculateTotals(input))).toBe(true);
  });

  it('rejects a tampered grand total', () => {
    const server = calculateTotals({ lines: [line('Manpower', 40, 20)] });
    const tampered = { ...server, grandTotal: 1 as Halalas };
    expect(totalsMatch(server, tampered)).toBe(false);
  });

  it('rejects a tampered category subtotal', () => {
    const server = calculateTotals({ lines: [line('Manpower', 40, 20)] });
    const tampered = {
      ...server,
      categorySubtotals: { ...server.categorySubtotals, Manpower: 1 as Halalas },
    };
    expect(totalsMatch(server, tampered)).toBe(false);
  });

  it('rejects an extra category present on only one side', () => {
    const server = calculateTotals({ lines: [line('Manpower', 40, 20)] });
    const tampered = {
      ...server,
      categorySubtotals: { ...server.categorySubtotals, Equipment: 500 as Halalas },
    };
    expect(totalsMatch(server, tampered)).toBe(false);
  });
});
