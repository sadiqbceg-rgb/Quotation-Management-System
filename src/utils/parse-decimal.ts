/**
 * Parsing user-typed decimals into integer minor units.
 *
 * The storage model is integers throughout (IMPLEMENTATION_PLAN.md §8.1), but a
 * user types "1.5" and "20.00". This is the single conversion boundary.
 *
 * Returns a discriminated result rather than throwing or returning NaN, because
 * "1." is a legitimate intermediate state while typing: the caller keeps the
 * text and simply does not emit a value yet, instead of destroying the input.
 */

import { quantityToMilli, sarToHalalas, type Halalas, type Milli } from '@shared/money';
import { PRICE_LIMITS, QUANTITY_LIMITS, countDecimals } from '@shared/validation-rules';

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'empty' | 'not-a-number' | 'too-many-decimals' | 'out-of-range' };

const NUMERIC = /^\d*\.?\d*$/;

function parseNumeric(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  if (!NUMERIC.test(trimmed)) return null;

  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Parse a quantity. Must be greater than zero — PRD §36 forbids zero and negatives. */
export function parseQuantity(text: string): ParseResult<Milli> {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { ok: false, reason: 'empty' };

  const parsed = parseNumeric(trimmed);
  if (parsed === null) return { ok: false, reason: 'not-a-number' };

  if (countDecimals(parsed) > QUANTITY_LIMITS.maxDecimals) {
    return { ok: false, reason: 'too-many-decimals' };
  }
  if (parsed <= QUANTITY_LIMITS.minExclusive || parsed > QUANTITY_LIMITS.max) {
    return { ok: false, reason: 'out-of-range' };
  }

  return { ok: true, value: quantityToMilli(parsed) };
}

/** Parse a price in SAR. Zero is allowed; negatives are not (PRD §36). */
export function parsePrice(text: string): ParseResult<Halalas> {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { ok: false, reason: 'empty' };

  const parsed = parseNumeric(trimmed);
  if (parsed === null) return { ok: false, reason: 'not-a-number' };

  if (countDecimals(parsed) > PRICE_LIMITS.maxDecimals) {
    return { ok: false, reason: 'too-many-decimals' };
  }
  if (parsed < PRICE_LIMITS.min || parsed > PRICE_LIMITS.maxSar) {
    return { ok: false, reason: 'out-of-range' };
  }

  return { ok: true, value: sarToHalalas(parsed) };
}

export function quantityParseMessage(
  reason: Exclude<ParseResult<Milli>, { ok: true }>['reason'],
): string {
  switch (reason) {
    case 'empty':
      return 'Quantity is required';
    case 'not-a-number':
      return 'Enter a number';
    case 'too-many-decimals':
      return `At most ${String(QUANTITY_LIMITS.maxDecimals)} decimal places`;
    case 'out-of-range':
      return `Enter a quantity greater than 0 and up to ${QUANTITY_LIMITS.max.toLocaleString('en-US')}`;
  }
}

export function priceParseMessage(
  reason: Exclude<ParseResult<Halalas>, { ok: true }>['reason'],
): string {
  switch (reason) {
    case 'empty':
      return 'Price is required';
    case 'not-a-number':
      return 'Enter a number';
    case 'too-many-decimals':
      return `At most ${String(PRICE_LIMITS.maxDecimals)} decimal places`;
    case 'out-of-range':
      return `Enter a price from 0 up to ${PRICE_LIMITS.maxSar.toLocaleString('en-US')}`;
  }
}
