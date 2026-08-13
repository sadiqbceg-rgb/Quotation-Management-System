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
  milliToQuantity,
  multiplyQuantityByRate,
  quantityToMilli,
  roundHalfUp,
  sarToHalalas,
  subtractHalalas,
  sumHalalas,
  sumMilli,
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

describe('the decimal conversions at the edges', () => {
  /*
   * Money and quantities are integers everywhere inside the system. These four
   * functions are the only places a decimal is allowed, and they are the only
   * places a rounding mistake can enter — so each is asserted at the half, at
   * zero, and at the values that expose a float.
   */

  it('converts SAR to halalas, rounding halves away from zero', () => {
    expect(sarToHalalas(0)).toBe(0);
    expect(sarToHalalas(2500.5)).toBe(250_050);
    expect(sarToHalalas(0.005)).toBe(1);
    expect(sarToHalalas(-0.005)).toBe(-1);
  });

  it('is exact for every price the system will actually be given', () => {
    /*
     * The domain matters here.
     *
     * `sarToHalalas` multiplies by 100 and rounds, so its answer for a THIRD
     * decimal depends on the float representation: 8.115 is stored slightly
     * high and gives 812, while 1.005 is stored slightly low and gives 100.
     * That is a real property of binary floating point, not something rounding
     * can fix from inside this function.
     *
     * It is also unreachable. `parsePrice` refuses anything with more than
     * `PRICE_LIMITS.maxDecimals` (2) decimal places before a value ever gets
     * here, so the only inputs in the contract are the ones below — and for
     * every one of them the conversion is exact.
     */
    const twoDecimalPrices = [
      0.01, 0.05, 0.1, 0.25, 1.01, 1.99, 8.11, 8.12, 18.5, 19.99, 20, 350, 2500.5, 999_999.99,
    ];

    for (const sar of twoDecimalPrices) {
      expect(sarToHalalas(sar), `SAR ${String(sar)}`).toBe(Math.round(sar * 100));
    }
  });

  it('is exact for every quantity the system will actually be given', () => {
    // `parseQuantity` caps at three decimals, and thousandths are the unit.
    const threeDecimalQuantities = [0.001, 0.125, 0.333, 1.5, 2.25, 40, 41, 999.999];

    for (const quantity of threeDecimalQuantities) {
      expect(quantityToMilli(quantity), String(quantity)).toBe(Math.round(quantity * 1_000));
    }
  });

  it('refuses a non-finite SAR amount rather than producing NaN halalas', () => {
    expect(() => sarToHalalas(Number.NaN)).toThrow(MoneyError);
    expect(() => sarToHalalas(Number.POSITIVE_INFINITY)).toThrow(MoneyError);
  });

  it('converts halalas back to SAR for display', () => {
    expect(halalasToSar(halalas(250_050))).toBe(2500.5);
    expect(halalasToSar(halalas(0))).toBe(0);
  });

  it('converts a decimal quantity to thousandths', () => {
    expect(quantityToMilli(1.5)).toBe(1_500);
    expect(quantityToMilli(0.0005)).toBe(1);
    expect(quantityToMilli(0)).toBe(0);
  });

  it('refuses a non-finite quantity', () => {
    expect(() => quantityToMilli(Number.NaN)).toThrow(MoneyError);
  });

  it('converts thousandths back to a decimal quantity', () => {
    expect(milliToQuantity(milli(1_500))).toBe(1.5);
    expect(milliToQuantity(milli(1))).toBe(0.001);
  });

  it('round-trips every conversion without losing a unit', () => {
    for (const sar of [0, 0.01, 1, 19.99, 2500.5, 1_000_000]) {
      expect(halalasToSar(sarToHalalas(sar)), `SAR ${String(sar)}`).toBe(sar);
    }
    for (const quantity of [0, 0.001, 1, 1.5, 40, 999.999]) {
      expect(milliToQuantity(quantityToMilli(quantity)), String(quantity)).toBe(quantity);
    }
  });
});

describe('roundHalfUp', () => {
  it('refuses a non-finite value rather than returning NaN', () => {
    expect(() => roundHalfUp(Number.NaN)).toThrow(MoneyError);
    expect(() => roundHalfUp(Number.POSITIVE_INFINITY)).toThrow(MoneyError);
  });
});

describe('subtraction and quantity summation', () => {
  it('subtracts exactly, which is what a discount line does', () => {
    expect(subtractHalalas(halalas(100_000), halalas(7_500))).toBe(92_500);
    expect(subtractHalalas(halalas(100), halalas(100))).toBe(0);
  });

  it('sums quantities without drifting, over a thousand lines', () => {
    // The Total Manpower line on the approved document is this sum.
    const values = Array.from({ length: 1_000 }, () => milli(1_001));
    expect(sumMilli(values)).toBe(1_001_000);
  });

  it('sums an empty list to zero rather than failing', () => {
    expect(sumMilli([])).toBe(0);
  });
});
