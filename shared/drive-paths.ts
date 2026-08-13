/**
 * The Drive archive's folder and file names.
 *
 * See IMPLEMENTATION_PLAN.md §16.1 and PRD §5.
 *
 * ---------------------------------------------------------------------------
 * ONE PLACE, BOTH SIDES
 * ---------------------------------------------------------------------------
 * Apps Script creates the folders; the browser tells the user where the
 * documents went. If the two built those names independently they would drift,
 * and the drift would only show up as a second `August` folder in a client
 * archive months later. Every name in the archive comes from this module.
 *
 *     Quotation Archive/2026/August/SFC-RUH-QTN-2026-004/
 *                                   SFC-RUH-QTN-2026-004.pdf
 *                                   SFC-RUH-QTN-2026-004.docx
 *
 * ---------------------------------------------------------------------------
 * THE DATE IS THE QUOTATION'S, NEVER THE CLOCK'S
 * ---------------------------------------------------------------------------
 * PRD §10: the year and month folders come from the quotation date. A quotation
 * dated in January and saved in March files under January. Nothing here reads
 * `new Date()`, and nothing may pass it one.
 */

import {
  DEFAULT_QUOTATION_CODES,
  QuotationNumberError,
  parseQuotationNumber,
  toFileSafe,
  type QuotationCodes,
} from './numbering';
import { PATTERNS } from './validation-rules';

/** Full English month names, exactly as PRD §5 prints them (§26 UR-15). */
export const MONTH_FOLDER_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export type MonthFolderName = (typeof MONTH_FOLDER_NAMES)[number];

/** The private signature store from Phase 06. Beside the year folders, not in one. */
export const ASSETS_FOLDER_NAME = '_assets';

/** The MIME types the archive stores. Nothing else may be uploaded. */
export const DOCUMENT_MIME_TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
} as const;

export type DocumentKind = keyof typeof DOCUMENT_MIME_TYPES;

export const DOCUMENT_KINDS: readonly DocumentKind[] = ['pdf', 'docx'];

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Split an ISO date without constructing a `Date`.
 *
 * `new Date('2026-08-11')` is parsed as UTC midnight and then read back in the
 * local zone, so a browser west of Greenwich gets 10 August — and files the
 * quotation under July when the 1st of a month is involved. The string is the
 * source of truth; it is never turned into an instant.
 */
function parseIsoDate(isoDate: string): { year: number; month: number; day: number } {
  const match = ISO_DATE.exec(isoDate.trim());
  if (match === null) {
    throw new QuotationNumberError(`Expected an ISO date (YYYY-MM-DD), received "${isoDate}".`);
  }

  const [, yearText = '', monthText = '', dayText = ''] = match;
  const year = Number.parseInt(yearText, 10);
  const month = Number.parseInt(monthText, 10);
  const day = Number.parseInt(dayText, 10);

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new QuotationNumberError(`"${isoDate}" is not a real date.`);
  }
  return { year, month, day };
}

/** `2026` — the year folder, from the quotation date. */
export function yearFolderName(quotationDate: string): string {
  return String(parseIsoDate(quotationDate).year);
}

/** `August` — the month folder, from the quotation date. */
export function monthFolderName(quotationDate: string): MonthFolderName {
  const { month } = parseIsoDate(quotationDate);
  const name = MONTH_FOLDER_NAMES[month - 1];

  if (name === undefined) {
    throw new QuotationNumberError(`"${quotationDate}" has no month.`);
  }
  return name;
}

/**
 * `SFC-RUH-QTN-2026-004` — the quotation folder.
 *
 * The file-safe slug of the number the application ISSUED. PRD §5 is explicit
 * that the folder carries that exact number; nothing here re-derives one from a
 * date or a counter.
 */
export function quotationFolderName(
  canonicalNumber: string,
  codes: QuotationCodes = DEFAULT_QUOTATION_CODES,
): string {
  return toFileSafe(canonicalNumber, codes);
}

/** `SFC-RUH-QTN-2026-004.pdf` / `.docx`. */
export function documentFileName(
  canonicalNumber: string,
  kind: DocumentKind,
  codes: QuotationCodes = DEFAULT_QUOTATION_CODES,
): string {
  return `${quotationFolderName(canonicalNumber, codes)}.${kind}`;
}

/**
 * The archive path for a quotation, root-relative.
 *
 * Returned as SEGMENTS rather than a joined string: the resolver walks them one
 * at a time, and a joined path invites a call site to build the next one with
 * string concatenation.
 */
export function quotationFolderSegments(
  quotationDate: string,
  canonicalNumber: string,
  codes: QuotationCodes = DEFAULT_QUOTATION_CODES,
): string[] {
  if (parseQuotationNumber(canonicalNumber, codes) === null) {
    throw new QuotationNumberError(
      `Cannot build an archive path for "${canonicalNumber}": not a valid quotation number.`,
    );
  }

  return [
    yearFolderName(quotationDate),
    monthFolderName(quotationDate),
    quotationFolderName(canonicalNumber, codes),
  ];
}

/** Display form of the path, for telling a user where a document went. */
export function describeArchivePath(segments: readonly string[]): string {
  return segments.join(' / ');
}

/**
 * Whether a name is safe to use as one Drive path segment.
 *
 * The archive path is built entirely from a validated quotation number and a
 * validated date, so nothing user-typed should ever reach it. This is the check
 * that makes that a guarantee rather than an assumption: `..`, a slash, a
 * leading dot and a control character are all refused (PRD §33).
 */
export function isSafePathSegment(segment: string): boolean {
  if (!PATTERNS.pathSegment.test(segment)) return false;
  if (segment.startsWith('.') || segment.trim() !== segment) return false;
  return true;
}
