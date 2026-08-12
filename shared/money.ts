/**
 * Monetary and quantity arithmetic for the quotation system.
 *
 * See IMPLEMENTATION_PLAN.md §8.
 *
 * Two invariants hold everywhere in this codebase:
 *
 *   1. Money is an integer count of **halalas** (1 SAR = 100 halalas).
 *   2. Quantity is an integer count of **thousandths** (1.5 → 1500).
 *
 * Floating-point currency arithmetic never happens. Decimal strings are
 * produced only at the display / document-render boundary.
 *
 * This module is imported by BOTH the React app and the Apps Script backend,
 * which is what makes the server-side totals recomputation in §8.6 a
 * meaningful check rather than a source of false mismatches.
 */

declare const halalasBrand: unique symbol;
declare const milliBrand: unique symbol;

/** An integer count of halalas. 1 SAR = 100 halalas. */
export type Halalas = number & { readonly [halalasBrand]: 'Halalas' };

/** An integer count of quantity thousandths. 1.5 units = 1500. */
export type Milli = number & { readonly [milliBrand]: 'Milli' };

export const HALALAS_PER_SAR = 100;
export const MILLI_PER_UNIT = 1000;
export const BASIS_POINTS_PER_UNIT = 10_000;

export const CURRENCY_CODE = 'SAR';

export class MoneyError extends Error {
  public override readonly name = 'MoneyError';
}

function assertSafeInteger(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new MoneyError(`${label} must be a finite number, received ${String(value)}`);
  }
  if (!Number.isInteger(value)) {
    throw new MoneyError(`${label} must be an integer minor-unit value, received ${value}`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} exceeds the safe integer range: ${value}`);
  }
}

function assertNonNegative(value: number, label: string): void {
  if (value < 0) {
    throw new MoneyError(`${label} must not be negative, received ${value}`);
  }
}

/** Construct a Halalas value, validating that it really is an integer minor unit. */
export function halalas(value: number): Halalas {
  assertSafeInteger(value, 'Halalas');
  return value as Halalas;
}

/** Construct a Milli quantity, validating that it really is an integer thousandth. */
export function milli(value: number): Milli {
  assertSafeInteger(value, 'Milli');
  return value as Milli;
}

export const ZERO_HALALAS: Halalas = 0 as Halalas;

/**
 * Multiply `value` by `multiplier` and divide by `divisor`, rounding half-up,
 * without ever forming the full product as a float.
 *
 * The naive `Math.round(value * multiplier / divisor)` overflows Number.MAX_SAFE_INTEGER
 * at the documented upper bounds (quantity 1e6 → 1e9 milli, price 1e6 SAR → 1e8 halalas,
 * product 1e17). Splitting into whole and remainder keeps every intermediate below ~1e14
 * and keeps the result exact.
 */
function mulDivRoundHalfUp(value: number, multiplier: number, divisor: number): number {
  assertSafeInteger(value, 'mulDiv value');
  assertSafeInteger(multiplier, 'mulDiv multiplier');
  assertNonNegative(value, 'mulDiv value');
  assertNonNegative(multiplier, 'mulDiv multiplier');
  if (!Number.isInteger(divisor) || divisor <= 0) {
    throw new MoneyError(`mulDiv divisor must be a positive integer, received ${divisor}`);
  }

  const whole = Math.floor(value / divisor);
  const remainder = value - whole * divisor;

  const wholeProduct = whole * multiplier;
  const remainderProduct = remainder * multiplier;

  const remainderWhole = Math.floor(remainderProduct / divisor);
  const remainderRest = remainderProduct - remainderWhole * divisor;

  // Half-up: a remainder of exactly half rounds away from zero.
  const rounded = remainderRest * 2 >= divisor ? remainderWhole + 1 : remainderWhole;

  const result = wholeProduct + rounded;
  assertSafeInteger(result, 'mulDiv result');
  return result;
}

/** Round a decimal to the nearest integer, halves away from zero. */
export function roundHalfUp(value: number): number {
  if (!Number.isFinite(value)) {
    throw new MoneyError(`roundHalfUp requires a finite number, received ${String(value)}`);
  }
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** Convert a decimal SAR amount (e.g. 2500.5) into halalas. */
export function sarToHalalas(sar: number): Halalas {
  if (!Number.isFinite(sar)) {
    throw new MoneyError(`sarToHalalas requires a finite number, received ${String(sar)}`);
  }
  return halalas(roundHalfUp(sar * HALALAS_PER_SAR));
}

/** Convert halalas back into a decimal SAR number. Display only — never arithmetic. */
export function halalasToSar(value: Halalas): number {
  return value / HALALAS_PER_SAR;
}

/** Convert a decimal quantity (e.g. 1.5) into integer thousandths. */
export function quantityToMilli(quantity: number): Milli {
  if (!Number.isFinite(quantity)) {
    throw new MoneyError(`quantityToMilli requires a finite number, received ${String(quantity)}`);
  }
  return milli(roundHalfUp(quantity * MILLI_PER_UNIT));
}

/** Convert integer thousandths back into a decimal quantity. Display only. */
export function milliToQuantity(value: Milli): number {
  return value / MILLI_PER_UNIT;
}

/**
 * Line amount = quantity × unit price, rounded half-up at the line level.
 *
 * Rounding per line (rather than once at the end) is deliberate: it guarantees
 * that the Amount column printed on the quotation sums exactly to the printed
 * subtotal. A document whose visible column does not add up to its visible
 * total is not acceptable on an official quotation.
 */
export function multiplyQuantityByRate(quantity: Milli, unitPrice: Halalas): Halalas {
  return halalas(mulDivRoundHalfUp(quantity, unitPrice, MILLI_PER_UNIT));
}

/** Apply a basis-point rate (1500 = 15%) to a base amount, rounding half-up. */
export function applyRateBasisPoints(base: Halalas, rateBasisPoints: number): Halalas {
  assertSafeInteger(rateBasisPoints, 'Basis-point rate');
  assertNonNegative(rateBasisPoints, 'Basis-point rate');
  return halalas(mulDivRoundHalfUp(base, rateBasisPoints, BASIS_POINTS_PER_UNIT));
}

/** Exact integer summation. */
export function sumHalalas(values: readonly Halalas[]): Halalas {
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return halalas(total);
}

export function addHalalas(a: Halalas, b: Halalas): Halalas {
  return halalas(a + b);
}

export function subtractHalalas(a: Halalas, b: Halalas): Halalas {
  return halalas(a - b);
}

export function sumMilli(values: readonly Milli[]): Milli {
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return milli(total);
}

/**
 * Format halalas for display and for documents: `SAR 12,500.00`.
 *
 * Matches the approved quotation, which prints `SAR 20.00 / Hour`.
 * Grouping is fixed to en-US so the output does not vary with the viewer's locale.
 */
export function formatSar(value: Halalas, options: { withCurrency?: boolean } = {}): string {
  const withCurrency = options.withCurrency ?? true;
  const negative = value < 0;
  const absolute = Math.abs(value);

  const whole = Math.floor(absolute / HALALAS_PER_SAR);
  const fraction = absolute - whole * HALALAS_PER_SAR;

  const groupedWhole = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const amount = `${groupedWhole}.${fraction.toString().padStart(2, '0')}`;

  const signed = negative ? `-${amount}` : amount;
  return withCurrency ? `${CURRENCY_CODE} ${signed}` : signed;
}

/**
 * Format a quantity with the minimum decimals needed: `40`, `1.5`, `0.125`.
 * Never `40.000` — the approved quotation prints `40 Nos.`, not `40.000 Nos.`
 */
export function formatQuantity(value: Milli): string {
  const negative = value < 0;
  const absolute = Math.abs(value);

  const whole = Math.floor(absolute / MILLI_PER_UNIT);
  const fraction = absolute - whole * MILLI_PER_UNIT;

  const trimmedFraction = fraction.toString().padStart(3, '0').replace(/0+$/, '');
  const text = trimmedFraction.length > 0 ? `${whole}.${trimmedFraction}` : whole.toString();

  return negative ? `-${text}` : text;
}

/** Render a basis-point rate as a percentage string: 1500 → "15%", 1250 → "12.5%". */
export function formatBasisPoints(rateBasisPoints: number): string {
  const percent = rateBasisPoints / 100;
  return `${Number.isInteger(percent) ? percent.toString() : percent.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}%`;
}
