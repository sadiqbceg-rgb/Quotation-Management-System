/**
 * The archive's names — the part of Phase 10 that decides where a client's
 * quotation is filed and what it is called.
 */

import { describe, expect, it } from 'vitest';

import {
  MONTH_FOLDER_NAMES,
  describeArchivePath,
  documentFileName,
  isSafePathSegment,
  monthFolderName,
  quotationFolderName,
  quotationFolderSegments,
  yearFolderName,
} from './drive-paths';
import { QuotationNumberError } from './numbering';

const NUMBER = 'SFC/RUH/QTN/2026/004';

describe('the month folder', () => {
  it('is the full English name PRD §5 prints', () => {
    expect(monthFolderName('2026-01-15')).toBe('January');
    expect(monthFolderName('2026-08-11')).toBe('August');
    expect(monthFolderName('2026-12-31')).toBe('December');
  });

  it('covers all twelve', () => {
    MONTH_FOLDER_NAMES.forEach((name, index) => {
      const month = String(index + 1).padStart(2, '0');
      expect(monthFolderName(`2026-${month}-01`)).toBe(name);
    });
  });

  it('does not shift across a timezone', () => {
    /*
     * `new Date('2026-08-01')` is UTC midnight; read back in any zone west of
     * Greenwich it is 31 July, and the quotation files under July. The date is
     * parsed as a string precisely so that cannot happen — and this assertion
     * would fail on a Date-based implementation for a tester in Riyadh only if
     * they ran it at the wrong hour, which is why it is pinned to the first of
     * the month.
     */
    expect(monthFolderName('2026-08-01')).toBe('August');
    expect(monthFolderName('2026-01-01')).toBe('January');
    expect(yearFolderName('2026-01-01')).toBe('2026');
  });

  it('refuses a date that is not a date', () => {
    expect(() => monthFolderName('11-08-2026')).toThrow(QuotationNumberError);
    expect(() => monthFolderName('2026-13-01')).toThrow(QuotationNumberError);
    expect(() => monthFolderName('')).toThrow(QuotationNumberError);
  });
});

describe('the quotation folder', () => {
  it('is the file-safe form of the issued number', () => {
    expect(quotationFolderName(NUMBER)).toBe('SFC-RUH-QTN-2026-004');
  });

  it('refuses to name a folder after something that is not a quotation number', () => {
    // The folder must carry the number the application issued (PRD §5), so a
    // value that never came from the numbering module cannot become one.
    expect(() => quotationFolderName('SFC-RUH-QTN-2026-004')).toThrow(QuotationNumberError);
    expect(() => quotationFolderName('../../etc')).toThrow(QuotationNumberError);
  });
});

describe('the file names', () => {
  it('are the folder name plus the extension', () => {
    expect(documentFileName(NUMBER, 'pdf')).toBe('SFC-RUH-QTN-2026-004.pdf');
    expect(documentFileName(NUMBER, 'docx')).toBe('SFC-RUH-QTN-2026-004.docx');
  });

  it('never carry a Drive duplicate suffix', () => {
    // `(1)` is what Drive adds when a second file of the same name is created.
    // The name is derived, so it cannot contain one.
    expect(documentFileName(NUMBER, 'pdf')).not.toMatch(/\(\d+\)/);
  });
});

describe('the archive path', () => {
  it('is year, month, then the quotation number', () => {
    expect(quotationFolderSegments('2026-08-11', NUMBER)).toEqual([
      '2026',
      'August',
      'SFC-RUH-QTN-2026-004',
    ]);
  });

  it('files a backdated quotation under its own date, not today', () => {
    // PRD §10. A quotation dated in January and saved in August belongs in
    // January's folder; nothing here reads the clock.
    expect(quotationFolderSegments('2026-01-15', 'SFC/RUH/QTN/2026/001')).toEqual([
      '2026',
      'January',
      'SFC-RUH-QTN-2026-001',
    ]);
  });

  it('uses the year of the DATE, which is the year in the number', () => {
    const segments = quotationFolderSegments('2025-12-31', 'SFC/RUH/QTN/2025/117');
    expect(segments[0]).toBe('2025');
    expect(segments[2]).toBe('SFC-RUH-QTN-2025-117');
  });

  it('is entirely made of safe path segments', () => {
    for (const segment of quotationFolderSegments('2026-08-11', NUMBER)) {
      expect(isSafePathSegment(segment)).toBe(true);
    }
  });

  it('reads back for a person', () => {
    expect(describeArchivePath(quotationFolderSegments('2026-08-11', NUMBER))).toBe(
      '2026 / August / SFC-RUH-QTN-2026-004',
    );
  });
});

describe('path segment safety', () => {
  it('accepts the names the archive actually uses', () => {
    for (const name of ['2026', 'August', 'SFC-RUH-QTN-2026-004', '_assets', 'signatures']) {
      expect(isSafePathSegment(name)).toBe(true);
    }
  });

  it('refuses traversal and separators', () => {
    for (const name of ['..', '../2025', 'a/b', 'a\\b', '.hidden', '', ' 2026', '2026 ']) {
      expect(isSafePathSegment(name), name).toBe(false);
    }
  });

  it('refuses control characters and a name that is far too long', () => {
    expect(isSafePathSegment('a\u0000b')).toBe(false);
    expect(isSafePathSegment('a\nb')).toBe(false);
    expect(isSafePathSegment('x'.repeat(121))).toBe(false);
  });
});
