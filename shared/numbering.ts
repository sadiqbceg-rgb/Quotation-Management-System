/**
 * Quotation number formatting, parsing and file-safe derivation.
 *
 * See IMPLEMENTATION_PLAN.md §7.
 *
 * Canonical format:
 *
 *     SFC/RUH/QTN/YYYY/###          e.g. SFC/RUH/QTN/2026/004
 *
 *     SFC  — Speed Falcon Company (company code)
 *     RUH  — Riyadh branch (branch code, fixed for V1)
 *     QTN  — Quotation (document type code)
 *     YYYY — the year of the QUOTATION DATE, computed, never hard-coded
 *     ###  — automatically incremented sequence, minimum 3 digits
 *
 * This format is read directly off page 1 of `reference/quotation-sample.pdf`,
 * which carries the real number `SFC/RUH/QTN/2026/004`.
 *
 * IMPORTANT: this module only *formats* and *parses*. It never allocates a
 * sequence. Allocation is the exclusive responsibility of the Google Apps
 * Script backend, under a script lock, keyed by draft id (§7.3–§7.5).
 * Nothing in the browser may invent an official quotation number.
 */

/** The fixed codes that make up a quotation number. Supplied by configuration. */
export interface QuotationCodes {
  readonly company: string;
  readonly branch: string;
  readonly documentType: string;
}

/**
 * V1 defaults. The backend reads the real values from Script Properties
 * (COMPANY_CODE / BRANCH_CODE / DOC_TYPE_CODE) so a second branch can be added
 * without a rewrite — see §7.1 and §26 UR-02.
 */
export const DEFAULT_QUOTATION_CODES: QuotationCodes = {
  company: 'SFC',
  branch: 'RUH',
  documentType: 'QTN',
};

/** Sequence padding is a MINIMUM width, not a truncation. 1000 stays "1000". */
export const MIN_SEQUENCE_DIGITS = 3;

export const MIN_QUOTATION_YEAR = 2000;
export const MAX_QUOTATION_YEAR = 9999;

const CODE_PATTERN = /^[A-Z][A-Z0-9]{1,7}$/;

export interface QuotationNumberParts {
  readonly codes: QuotationCodes;
  readonly year: number;
  readonly sequence: number;
}

/** A validated quotation number in both of its representations. */
export interface QuotationNumber {
  /** Business identifier, as printed on the document: `SFC/RUH/QTN/2026/004`. */
  readonly canonical: string;
  /** Filesystem-safe slug for Drive folders and filenames: `SFC-RUH-QTN-2026-004`. */
  readonly fileSafe: string;
  readonly year: number;
  readonly sequence: number;
}

export class QuotationNumberError extends Error {
  public override readonly name = 'QuotationNumberError';
}

function assertValidCodes(codes: QuotationCodes): void {
  const entries: ReadonlyArray<readonly [string, string]> = [
    ['company', codes.company],
    ['branch', codes.branch],
    ['documentType', codes.documentType],
  ];

  for (const [label, code] of entries) {
    if (!CODE_PATTERN.test(code)) {
      throw new QuotationNumberError(
        `Invalid ${label} code "${code}": expected 2-8 uppercase alphanumerics starting with a letter.`,
      );
    }
  }
}

function assertValidYear(year: number): void {
  if (!Number.isInteger(year) || year < MIN_QUOTATION_YEAR || year > MAX_QUOTATION_YEAR) {
    throw new QuotationNumberError(
      `Invalid quotation year ${String(year)}: expected an integer between ${MIN_QUOTATION_YEAR} and ${MAX_QUOTATION_YEAR}.`,
    );
  }
}

function assertValidSequence(sequence: number): void {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new QuotationNumberError(
      `Invalid quotation sequence ${String(sequence)}: expected a positive integer.`,
    );
  }
}

/**
 * Zero-pad a sequence to at least MIN_SEQUENCE_DIGITS.
 *
 *   1 → "001"   9 → "009"   10 → "010"   99 → "099"
 * 100 → "100"  999 → "999" 1000 → "1000"   (width grows, never truncates)
 */
export function formatSequence(sequence: number): string {
  assertValidSequence(sequence);
  return sequence.toString().padStart(MIN_SEQUENCE_DIGITS, '0');
}

/** Build the canonical quotation number string. */
export function formatQuotationNumber(
  year: number,
  sequence: number,
  codes: QuotationCodes = DEFAULT_QUOTATION_CODES,
): string {
  assertValidCodes(codes);
  assertValidYear(year);
  assertValidSequence(sequence);

  return [
    codes.company,
    codes.branch,
    codes.documentType,
    year.toString(),
    formatSequence(sequence),
  ].join('/');
}

/** The validation regex for a given code set: `^SFC\/RUH\/QTN\/(\d{4})\/(\d{3,})$`. */
export function quotationNumberRegex(codes: QuotationCodes = DEFAULT_QUOTATION_CODES): RegExp {
  assertValidCodes(codes);
  return new RegExp(
    `^${codes.company}\\/${codes.branch}\\/${codes.documentType}\\/(\\d{4})\\/(\\d{${MIN_SEQUENCE_DIGITS},})$`,
  );
}

/** Parse a canonical quotation number. Returns null when the input does not match. */
export function parseQuotationNumber(
  value: string,
  codes: QuotationCodes = DEFAULT_QUOTATION_CODES,
): QuotationNumberParts | null {
  if (typeof value !== 'string') return null;

  const match = quotationNumberRegex(codes).exec(value.trim());
  if (match === null) return null;

  const yearText = match[1];
  const sequenceText = match[2];
  if (yearText === undefined || sequenceText === undefined) return null;

  const year = Number.parseInt(yearText, 10);
  const sequence = Number.parseInt(sequenceText, 10);

  if (year < MIN_QUOTATION_YEAR || year > MAX_QUOTATION_YEAR) return null;
  if (sequence < 1) return null;

  // "0004" is not a canonical rendering of 4; only the padded-to-minimum form is.
  if (formatSequence(sequence) !== sequenceText) return null;

  return { codes, year, sequence };
}

export function isValidQuotationNumber(
  value: string,
  codes: QuotationCodes = DEFAULT_QUOTATION_CODES,
): boolean {
  return parseQuotationNumber(value, codes) !== null;
}

/**
 * Derive the filesystem-safe form used for Drive folder and file names.
 *
 *     SFC/RUH/QTN/2026/004  →  SFC-RUH-QTN-2026-004
 *
 * A mechanical, lossless transform of the canonical number. The input is
 * validated first so a malformed value can never become a filename.
 *
 * UR-01 IS SETTLED. The company has confirmed the ordering as
 *
 *     Company - Branch - Document Type - Year - Sequence
 *     SFC-RUH-QTN-YYYY-NNN
 *
 * which is what the slug of the canonical number already produces. PRD §5/§28
 * write the components as `SFC-QTN-RUH-…`; that ordering is superseded and must
 * not be reintroduced.
 *
 * Keeping the slug a mechanical transform of the canonical number is what makes
 * the two impossible to disagree: there is no second ordering to maintain, and
 * a filename cannot drift from the number printed on the document.
 */
export function toFileSafe(
  canonical: string,
  codes: QuotationCodes = DEFAULT_QUOTATION_CODES,
): string {
  if (parseQuotationNumber(canonical, codes) === null) {
    throw new QuotationNumberError(
      `Cannot derive a file-safe name from "${canonical}": not a valid quotation number.`,
    );
  }
  return canonical.split('/').join('-');
}

/** Build a fully validated QuotationNumber in both representations. */
export function createQuotationNumber(
  year: number,
  sequence: number,
  codes: QuotationCodes = DEFAULT_QUOTATION_CODES,
): QuotationNumber {
  const canonical = formatQuotationNumber(year, sequence, codes);
  return {
    canonical,
    fileSafe: toFileSafe(canonical, codes),
    year,
    sequence,
  };
}

/** Rebuild a QuotationNumber from its canonical string. Throws when invalid. */
export function quotationNumberFromCanonical(
  canonical: string,
  codes: QuotationCodes = DEFAULT_QUOTATION_CODES,
): QuotationNumber {
  const parts = parseQuotationNumber(canonical, codes);
  if (parts === null) {
    throw new QuotationNumberError(`"${canonical}" is not a valid quotation number.`);
  }
  return createQuotationNumber(parts.year, parts.sequence, codes);
}

/**
 * The year a quotation number belongs to, taken from the quotation date.
 *
 * Deliberately derived from the supplied ISO date and NOT from `new Date()`:
 * a quotation dated 2027-01-05 must draw from the 2027 counter even if the
 * system clock still says 2026, and a backdated 2026 quotation finalized in
 * 2027 must draw from the 2026 counter (§7.6, PRD §10).
 */
export function quotationYearFromDate(isoDate: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (match === null) {
    throw new QuotationNumberError(`Expected an ISO date (YYYY-MM-DD), received "${isoDate}".`);
  }
  const yearText = match[1];
  if (yearText === undefined) {
    throw new QuotationNumberError(`Expected an ISO date (YYYY-MM-DD), received "${isoDate}".`);
  }
  const year = Number.parseInt(yearText, 10);
  assertValidYear(year);
  return year;
}
