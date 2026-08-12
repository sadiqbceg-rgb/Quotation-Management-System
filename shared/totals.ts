/**
 * The quotation calculation model.
 *
 * See IMPLEMENTATION_PLAN.md §8.3.
 *
 *   amount            = roundHalfUp(quantityMilli × unitPriceHalalas / 1000)
 *   categorySubtotal  = Σ amount within the category
 *   subtotal          = Σ categorySubtotal
 *   discountAmount    = roundHalfUp(subtotal × discountRateBp / 10000)
 *   taxableBase       = subtotal − discountAmount
 *   vatAmount         = roundHalfUp(taxableBase × vatRateBp / 10000)
 *   grandTotal        = taxableBase + vatAmount
 *
 * Pure and deterministic. This exact module runs on BOTH the client (for live
 * display) and the server (to recompute and verify what the client submitted,
 * §8.6). Running the same code on both sides is what makes the mismatch check
 * trustworthy rather than a source of false failures.
 */

import {
  ZERO_HALALAS,
  addHalalas,
  applyRateBasisPoints,
  halalas,
  multiplyQuantityByRate,
  subtractHalalas,
  sumHalalas,
  type Halalas,
  type Milli,
} from './money.js';
import type { ItemCategory, Totals } from './types.js';

/** The KSA VAT rate, from `reference/existing-terms.docx` term 9 and the approved quotation. */
export const DEFAULT_VAT_RATE_BASIS_POINTS = 1500;

export const MAX_RATE_BASIS_POINTS = 10_000;

export interface TotalsLineInput {
  readonly category: ItemCategory;
  readonly quantity: Milli;
  readonly unitPrice: Halalas;
}

export interface TotalsInput {
  readonly lines: readonly TotalsLineInput[];
  /** Basis points. Omit or leave undefined when discount is disabled (§26 UR-12). */
  readonly discountRateBasisPoints?: number | undefined;
  /** Basis points. Pass 0 to disable VAT. Defaults to 1500 (15%). */
  readonly vatRateBasisPoints?: number | undefined;
}

export class TotalsError extends Error {
  public override readonly name = 'TotalsError';
}

function assertRate(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > MAX_RATE_BASIS_POINTS) {
    throw new TotalsError(
      `${label} must be an integer between 0 and ${MAX_RATE_BASIS_POINTS} basis points, received ${String(value)}.`,
    );
  }
}

/** The amount for a single line. Derived — never accept this value from a client. */
export function calculateLineAmount(quantity: Milli, unitPrice: Halalas): Halalas {
  return multiplyQuantityByRate(quantity, unitPrice);
}

/** Sum the line amounts for one category. */
export function calculateCategorySubtotal(lines: readonly TotalsLineInput[]): Halalas {
  return sumHalalas(lines.map((line) => calculateLineAmount(line.quantity, line.unitPrice)));
}

/**
 * Compute every total for a quotation.
 *
 * Line amounts are rounded individually and then summed exactly, so the Amount
 * column printed on the document always adds up to the printed subtotal.
 */
export function calculateTotals(input: TotalsInput): Totals {
  const discountRateBasisPoints = input.discountRateBasisPoints;
  const vatRateBasisPoints = input.vatRateBasisPoints ?? DEFAULT_VAT_RATE_BASIS_POINTS;

  if (discountRateBasisPoints !== undefined) {
    assertRate(discountRateBasisPoints, 'Discount rate');
  }
  assertRate(vatRateBasisPoints, 'VAT rate');

  const categorySubtotals: Partial<Record<ItemCategory, Halalas>> = {};
  let subtotal: Halalas = ZERO_HALALAS;

  for (const line of input.lines) {
    const amount = calculateLineAmount(line.quantity, line.unitPrice);
    const current = categorySubtotals[line.category] ?? ZERO_HALALAS;
    categorySubtotals[line.category] = addHalalas(current, amount);
    subtotal = addHalalas(subtotal, amount);
  }

  const discountAmount =
    discountRateBasisPoints === undefined || discountRateBasisPoints === 0
      ? ZERO_HALALAS
      : applyRateBasisPoints(subtotal, discountRateBasisPoints);

  const taxableBase = subtractHalalas(subtotal, discountAmount);

  const vatAmount =
    vatRateBasisPoints === 0 ? ZERO_HALALAS : applyRateBasisPoints(taxableBase, vatRateBasisPoints);

  const grandTotal = addHalalas(taxableBase, vatAmount);

  const totals: Totals = {
    categorySubtotals,
    subtotal,
    discountAmount,
    taxableBase,
    vatRateBasisPoints,
    vatAmount,
    grandTotal,
  };

  return discountRateBasisPoints === undefined ? totals : { ...totals, discountRateBasisPoints };
}

/**
 * Compare two totals for exact equality.
 *
 * Used by the backend to reject a client payload whose arithmetic does not
 * match the server's recomputation (`TOTALS_MISMATCH`, §8.6).
 */
export function totalsMatch(a: Totals, b: Totals): boolean {
  if (
    a.subtotal !== b.subtotal ||
    a.discountAmount !== b.discountAmount ||
    a.taxableBase !== b.taxableBase ||
    a.vatRateBasisPoints !== b.vatRateBasisPoints ||
    a.vatAmount !== b.vatAmount ||
    a.grandTotal !== b.grandTotal
  ) {
    return false;
  }

  const categories = new Set<string>([
    ...Object.keys(a.categorySubtotals),
    ...Object.keys(b.categorySubtotals),
  ]);

  for (const category of categories) {
    const left = a.categorySubtotals[category as ItemCategory] ?? halalas(0);
    const right = b.categorySubtotals[category as ItemCategory] ?? halalas(0);
    if (left !== right) return false;
  }

  return true;
}
