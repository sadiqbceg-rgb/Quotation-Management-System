/**
 * Date handling.
 *
 * Two representations, deliberately separated (IMPLEMENTATION_PLAN.md §26 UR-13):
 *
 *   storage / API : ISO  `YYYY-MM-DD`
 *   display / docs: `DD-MM-YYYY`  — matches `Date: 11-08-2026` on the approved
 *                                   quotation in reference/quotation-sample.pdf
 *
 * All parsing is calendar-based, never `new Date(string)`, which applies a
 * timezone shift that can move a quotation into the wrong year — and the year
 * determines both the quotation number and the Drive folder.
 */

import { PATTERNS } from '@shared/validation-rules';

export const MONTH_NAMES = [
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

export interface CalendarDate {
  year: number;
  /** 1–12. */
  month: number;
  /** 1–31. */
  day: number;
}

export function parseIsoDate(isoDate: string): CalendarDate | null {
  if (!PATTERNS.isoDate.test(isoDate)) return null;

  const [yearText, monthText, dayText] = isoDate.split('-');
  if (yearText === undefined || monthText === undefined || dayText === undefined) return null;

  const year = Number.parseInt(yearText, 10);
  const month = Number.parseInt(monthText, 10);
  const day = Number.parseInt(dayText, 10);

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  // Reject impossible calendar dates such as 2026-02-30.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

export function isValidIsoDate(isoDate: string): boolean {
  return parseIsoDate(isoDate) !== null;
}

/** Format for the UI and for generated documents: `11-08-2026`. */
export function formatDisplayDate(isoDate: string): string {
  const parsed = parseIsoDate(isoDate);
  if (parsed === null) return '';
  const day = parsed.day.toString().padStart(2, '0');
  const month = parsed.month.toString().padStart(2, '0');
  return `${day}-${month}-${parsed.year}`;
}

/** Today, in the local calendar, as an ISO date string. */
export function todayIso(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const day = now.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * The full English month name for a quotation date.
 * Used for the Drive `Year / Month / Number` tree (PRD §5, §10).
 */
export function monthNameFromIso(isoDate: string): string | null {
  const parsed = parseIsoDate(isoDate);
  if (parsed === null) return null;
  return MONTH_NAMES[parsed.month - 1] ?? null;
}
