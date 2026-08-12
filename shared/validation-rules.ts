/**
 * Validation constants shared by the client-side Zod schemas and the
 * Apps Script server-side validator.
 *
 * See IMPLEMENTATION_PLAN.md §19.3 and PRD §36.
 *
 * Declaring the bounds once is what keeps frontend and backend validation
 * genuinely identical. Frontend validation is a convenience; the backend
 * check is the control.
 */

import type { ItemCategory } from './types.js';

/* -------------------------------------------------------------------------- */
/* String length caps                                                         */
/* -------------------------------------------------------------------------- */

export const TEXT_LIMITS = {
  email: { min: 3, max: 254 },
  password: { min: 12, max: 128 },

  clientName: { min: 2, max: 150 },
  companyName: { min: 2, max: 150 },
  address: { min: 2, max: 400 },
  contactPerson: { min: 0, max: 120 },
  phone: { min: 7, max: 20 },
  projectName: { min: 0, max: 200 },
  projectLocation: { min: 0, max: 200 },
  clientReference: { min: 0, max: 100 },

  quotationFor: { min: 3, max: 200 },
  scopeOfWork: { min: 0, max: 2000 },
  closingParagraph: { min: 2, max: 2000 },

  itemDescription: { min: 2, max: 300 },
  unit: { min: 1, max: 20 },
  remarks: { min: 0, max: 300 },

  termTitle: { min: 2, max: 120 },
  termBody: { min: 2, max: 4000 },

  personName: { min: 2, max: 100 },
  personDesignation: { min: 2, max: 100 },
  personCountry: { min: 2, max: 100 },
} as const;

/* -------------------------------------------------------------------------- */
/* Numeric bounds                                                             */
/* -------------------------------------------------------------------------- */

/** Quantity, expressed in whole units. Stored as integer thousandths. */
export const QUANTITY_LIMITS = {
  minExclusive: 0,
  max: 1_000_000,
  maxDecimals: 3,
} as const;

/** Unit price, expressed in SAR. Stored as integer halalas. */
export const PRICE_LIMITS = {
  min: 0,
  maxSar: 1_000_000,
  maxDecimals: 2,
} as const;

export const QUOTATION_LIMITS = {
  maxLineItems: 500,
  maxTerms: 60,
  maxCategories: 3,
  /** A quotation date may not be more than this many years from today. */
  dateRangeYears: 5,
} as const;

export const UPLOAD_LIMITS = {
  signatureMaxBytes: 1_048_576,
  documentMaxBytes: 5_242_880,
} as const;

/* -------------------------------------------------------------------------- */
/* Patterns                                                                   */
/* -------------------------------------------------------------------------- */

export const PATTERNS = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
  phone: /^[+\d][\d\s\-()]{6,19}$/,
  isoDate: /^\d{4}-\d{2}-\d{2}$/,
  /** A single Drive-safe path segment. Blocks traversal and reserved characters. */
  pathSegment: /^[A-Za-z0-9 _-]{1,120}$/,
  /** The file-safe quotation number used for folders and filenames. */
  fileSafeNumber: /^[A-Z0-9]+(-[A-Z0-9]+)+$/,
  driveUrl: /^https:\/\/drive\.google\.com\//,
  /** A custom unit: printable, no control characters, no formula-leading char. */
  // eslint-disable-next-line no-control-regex
  customUnit: /^[^\s=+@\u0000-\u001F\u007F][^\u0000-\u001F\u007F]{0,19}$/,
} as const;

/** Characters that turn a spreadsheet cell into a live formula (§19.5). */
export const FORMULA_INJECTION_PREFIXES = ['=', '+', '-', '@'] as const;

/* -------------------------------------------------------------------------- */
/* Units (PRD §14–§16 — configurable, never a hard-coded union type)          */
/* -------------------------------------------------------------------------- */

export const UNIT_OPTIONS: Readonly<Record<ItemCategory, readonly string[]>> = {
  Manpower: ['Hour', 'Day', 'Week', 'Month'],
  Equipment: ['Hour', 'Day', 'Week', 'Month', 'Trip', 'Unit', 'LS'],
  Materials: ['Nos.', 'Unit', 'Set', 'Box', 'Kg', 'Ton', 'm', 'm²', 'm³', 'LS'],
};

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** True when a value would be interpreted as a formula by Google Sheets. */
export function needsFormulaEscaping(value: string): boolean {
  return FORMULA_INJECTION_PREFIXES.some((prefix) => value.startsWith(prefix));
}

/**
 * Neutralise a spreadsheet formula by prefixing an apostrophe.
 * Applied to EVERY value written to any sheet — see §19.5.
 */
export function escapeForSheet(value: string): string {
  return needsFormulaEscaping(value) ? `'${value}` : value;
}

/** Strip control characters that have no business in a document field. */
export function stripControlCharacters(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

export function isWithinLength(value: string, limits: { min: number; max: number }): boolean {
  const length = value.trim().length;
  return length >= limits.min && length <= limits.max;
}

export function countDecimals(value: number): number {
  if (!Number.isFinite(value) || Number.isInteger(value)) return 0;
  const text = value.toString();
  const dotIndex = text.indexOf('.');
  if (dotIndex === -1) return 0;
  return text.length - dotIndex - 1;
}
