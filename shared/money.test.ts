import { describe, expect, it } from 'vitest';
import {
  MoneyError,
  addHalalas,
  applyRateBasisPoints,
  formatBasisPoints,
  formatQuantity,
  formatSar,
  halalas,
  halalasToSar,
  milli,
  multiplyQuantityByRate,
  quantityToMilli,
  roundHalfUp,
  sarToHalalas,
  sumHalalas,
} from './money.js';

describe('construction', () => {
  it('rejects non-integer minor units', () => {
    expect(() => halalas(1.5)).toThrow(MoneyError);
    expect(() => milli(0.5)).toThrow(MoneyError);
  });

  it('rejects non-finite values', () => {
    expect(() => halalas(Number.NaN)).toThrow(MoneyError);
    expect(() => halalas(Number.POSITIVE_INFINITY)).toThrow(MoneyError);
  });

  it('rejects values beyond the safe integer range', () => {
    expect(() => halalas(Number.MAX_SAFE_INTEGER + 2)).toThrow(MoneyError);
  });
});

describe('conversion', () => {
  it('converts SAR to halalas and back', () => {
    expect(sarToHalalas(20)).toBe(2000);
    expect(sarToHalalas(2500)).toBe(250_000);
    expect(sarToHalalas(0.01)).toBe(1);
    expect(halalasToSar(halalas(12_500_00))).toBe(12_500);
  });

  it('converts quantities to thousandths and back', () => {
    expect(quantityToMilli(40)).toBe(40_000);
    expect(quantityToMilli(1.5)).toBe(1500);
    expect(quantityToMilli(0.125)).toBe(125);
  });
});

describe('roundHalfUp', () => {
  it('rounds halves away from zero', () => {
    expect(roundHalfUp(0.5)).toBe(1);
    expect(roundHalfUp(1.5)).toBe(2);
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(-0.5)).toBe(-1);
    expect(roundHalfUp(-2.5)).toBe(-3);
  });

  it('leaves integers untouched', () => {
    expect(roundHalfUp(7)).toBe(7);
  });
});

describe('multiplyQuantityByRate', () => {
  it('matches the figures on the approved quotation', () => {
    // 40 × SAR 20.00 / hour
    expect(multiplyQuantityByRate(quantityToMilli(40), sarToHalalas(20))).toBe(800_00);
    // 5 × SAR 2,500.00
    expect(multiplyQuantityByRate(quantityToMilli(5), sarToHalalas(2500))).toBe(12_500_00);
    // 10 × SAR 20.00
    expect(multiplyQuantityByRate(quantityToMilli(10), sarToHalalas(20))).toBe(200_00);
  });

  it('rounds a fractional quantity half-up', () => {
    // 1.5 × 33.33 = 49.995 → 50.00
    expect(multiplyQuantityByRate(quantityToMilli(1.5), sarToHalalas(33.33))).toBe(50_00);
  });

  it('rounds exactly one half up', () => {
    // 0.5 × 0.01 = 0.005 → 0.01
    expect(multiplyQuantityByRate(quantityToMilli(0.5), sarToHalalas(0.01))).toBe(1);
  });

  it('is exact at the documented upper bounds without overflowing', () => {
    // 1,000,000 units × SAR 1,000,000 — the extreme the validation rules allow.
    // 1e12 SAR = 1e14 halalas, comfortably inside Number.MAX_SAFE_INTEGER (9.007e15).
    // The naive `qty * rate / 1000` would form 1e17 first and lose precision.
    const result = multiplyQuantityByRate(quantityToMilli(1_000_000), sarToHalalas(1_000_000));
    expect(result).toBe(100_000_000_000_000);
    expect(Number.isSafeInteger(result)).toBe(true);
  });

  it('handles zero', () => {
    expect(multiplyQuantityByRate(quantityToMilli(0), sarToHalalas(20))).toBe(0);
    expect(multiplyQuantityByRate(quantityToMilli(40), sarToHalalas(0))).toBe(0);
  });
});

describe('applyRateBasisPoints', () => {
  it('applies 15% VAT', () => {
    expect(applyRateBasisPoints(halalas(1000_00), 1500)).toBe(150_00);
    expect(applyRateBasisPoints(halalas(12_500_00), 1500)).toBe(1875_00);
  });

  it('returns zero for a zero rate', () => {
    expect(applyRateBasisPoints(halalas(1000_00), 0)).toBe(0);
  });

  it('rounds half-up', () => {
    // 1 halala at 50% = 0.5 → 1
    expect(applyRateBasisPoints(halalas(1), 5000)).toBe(1);
  });

  it('rejects a negative rate', () => {
    expect(() => applyRateBasisPoints(halalas(100), -1)).toThrow(MoneyError);
  });
});

describe('summation', () => {
  it('does not drift over a thousand lines', () => {
    // 1000 × SAR 0.07 — the classic float-drift case.
    const line = multiplyQuantityByRate(quantityToMilli(1), sarToHalalas(0.07));
    const values = Array.from({ length: 1000 }, () => line);
    expect(sumHalalas(values)).toBe(70_00);
  });

  it('adds exactly', () => {
    expect(addHalalas(halalas(10), halalas(20))).toBe(30);
  });
});

describe('formatSar', () => {
  it('formats with a currency prefix, grouping and two decimals', () => {
    expect(formatSar(halalas(2000))).toBe('SAR 20.00');
    expect(formatSar(halalas(12_500_00))).toBe('SAR 12,500.00');
    expect(formatSar(halalas(0))).toBe('SAR 0.00');
    expect(formatSar(halalas(5))).toBe('SAR 0.05');
    expect(formatSar(halalas(1_234_567_89))).toBe('SAR 1,234,567.89');
  });

  it('can omit the currency code', () => {
    expect(formatSar(halalas(12_500_00), { withCurrency: false })).toBe('12,500.00');
  });

  it('formats a negative amount', () => {
    expect(formatSar(halalas(-2000))).toBe('SAR -20.00');
  });
});

describe('formatQuantity', () => {
  it('uses the minimum decimals needed', () => {
    expect(formatQuantity(quantityToMilli(40))).toBe('40');
    expect(formatQuantity(quantityToMilli(1))).toBe('1');
    expect(formatQuantity(quantityToMilli(1.5))).toBe('1.5');
    expect(formatQuantity(quantityToMilli(0.125))).toBe('0.125');
    expect(formatQuantity(quantityToMilli(2.25))).toBe('2.25');
  });
});

describe('formatBasisPoints', () => {
  it('renders whole percentages without decimals', () => {
    expect(formatBasisPoints(1500)).toBe('15%');
    expect(formatBasisPoints(0)).toBe('0%');
  });
});
