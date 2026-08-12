import { describe, expect, it } from 'vitest';
import {
  DEFAULT_QUOTATION_CODES,
  QuotationNumberError,
  createQuotationNumber,
  formatQuotationNumber,
  formatSequence,
  isValidQuotationNumber,
  parseQuotationNumber,
  quotationNumberFromCanonical,
  quotationNumberRegex,
  quotationYearFromDate,
  toFileSafe,
} from './numbering.js';

describe('formatQuotationNumber', () => {
  it('produces the canonical format from the approved quotation', () => {
    // reference/quotation-sample.pdf page 1 carries exactly this number.
    expect(formatQuotationNumber(2026, 4)).toBe('SFC/RUH/QTN/2026/004');
  });

  it('produces the first three quotations of a year', () => {
    expect(formatQuotationNumber(2026, 1)).toBe('SFC/RUH/QTN/2026/001');
    expect(formatQuotationNumber(2026, 2)).toBe('SFC/RUH/QTN/2026/002');
    expect(formatQuotationNumber(2026, 3)).toBe('SFC/RUH/QTN/2026/003');
  });

  it('takes the year from its argument and never hard-codes 2026', () => {
    expect(formatQuotationNumber(2027, 1)).toBe('SFC/RUH/QTN/2027/001');
    expect(formatQuotationNumber(2031, 1)).toBe('SFC/RUH/QTN/2031/001');
    expect(formatQuotationNumber(2099, 42)).toBe('SFC/RUH/QTN/2099/042');
  });

  it('honours configured codes rather than inlined literals', () => {
    const codes = { company: 'SFC', branch: 'JUB', documentType: 'QTN' };
    expect(formatQuotationNumber(2026, 7, codes)).toBe('SFC/JUB/QTN/2026/007');
  });

  it('rejects an invalid year or sequence', () => {
    expect(() => formatQuotationNumber(26, 1)).toThrow(QuotationNumberError);
    expect(() => formatQuotationNumber(2026, 0)).toThrow(QuotationNumberError);
    expect(() => formatQuotationNumber(2026, -1)).toThrow(QuotationNumberError);
    expect(() => formatQuotationNumber(2026, 1.5)).toThrow(QuotationNumberError);
  });
});

describe('formatSequence padding', () => {
  it('pads to a minimum of three digits', () => {
    expect(formatSequence(1)).toBe('001');
    expect(formatSequence(9)).toBe('009');
    expect(formatSequence(10)).toBe('010');
    expect(formatSequence(99)).toBe('099');
    expect(formatSequence(100)).toBe('100');
    expect(formatSequence(101)).toBe('101');
  });

  it('grows past three digits rather than truncating', () => {
    expect(formatSequence(999)).toBe('999');
    expect(formatSequence(1000)).toBe('1000');
    expect(formatSequence(12345)).toBe('12345');
  });

  it('crosses the padding boundaries correctly', () => {
    expect(formatSequence(9)).toBe('009');
    expect(formatSequence(10)).toBe('010');
    expect(formatSequence(99)).toBe('099');
    expect(formatSequence(100)).toBe('100');
  });
});

describe('parseQuotationNumber', () => {
  it('round-trips a formatted number', () => {
    const parsed = parseQuotationNumber('SFC/RUH/QTN/2026/004');
    expect(parsed).not.toBeNull();
    expect(parsed?.year).toBe(2026);
    expect(parsed?.sequence).toBe(4);
  });

  it('parses a four-digit sequence', () => {
    expect(parseQuotationNumber('SFC/RUH/QTN/2026/1000')?.sequence).toBe(1000);
  });

  it.each([
    ['empty string', ''],
    ['under-padded sequence', 'SFC/RUH/QTN/2026/1'],
    ['two-digit sequence', 'SFC/RUH/QTN/2026/01'],
    ['over-padded sequence', 'SFC/RUH/QTN/2026/0004'],
    ['the file-safe form', 'SFC-RUH-QTN-2026-004'],
    ['wrong segment order', 'SFC/QTN/RUH/2026/004'],
    ['lower case', 'sfc/ruh/qtn/2026/004'],
    ['two-digit year', 'SFC/RUH/QTN/26/004'],
    ['non-numeric sequence', 'SFC/RUH/QTN/2026/abc'],
    ['unknown company code', 'XXX/RUH/QTN/2026/004'],
    ['internal spaces', 'SFC / RUH / QTN / 2026 / 004'],
  ])('rejects %s', (_label, value) => {
    expect(isValidQuotationNumber(value)).toBe(false);
    expect(parseQuotationNumber(value)).toBeNull();
  });

  it('tolerates surrounding whitespace', () => {
    expect(isValidQuotationNumber('  SFC/RUH/QTN/2026/004  ')).toBe(true);
  });
});

describe('quotationNumberRegex', () => {
  it('matches the documented pattern', () => {
    const regex = quotationNumberRegex(DEFAULT_QUOTATION_CODES);
    expect(regex.source).toBe('^SFC\\/RUH\\/QTN\\/(\\d{4})\\/(\\d{3,})$');
    expect(regex.test('SFC/RUH/QTN/2026/004')).toBe(true);
  });
});

describe('toFileSafe', () => {
  it('replaces slashes with hyphens', () => {
    expect(toFileSafe('SFC/RUH/QTN/2026/004')).toBe('SFC-RUH-QTN-2026-004');
    expect(toFileSafe('SFC/RUH/QTN/2026/001')).toBe('SFC-RUH-QTN-2026-001');
    expect(toFileSafe('SFC/RUH/QTN/2027/1000')).toBe('SFC-RUH-QTN-2027-1000');
  });

  it('refuses to derive a filename from an invalid number', () => {
    expect(() => toFileSafe('not-a-number')).toThrow(QuotationNumberError);
    expect(() => toFileSafe('SFC/RUH/QTN/2026/1')).toThrow(QuotationNumberError);
  });

  it('produces a name safe for Drive folders and files', () => {
    const fileSafe = toFileSafe('SFC/RUH/QTN/2026/004');
    expect(fileSafe).toMatch(/^[A-Z0-9-]+$/);
    expect(fileSafe).not.toContain('/');
  });
});

describe('createQuotationNumber', () => {
  it('carries both representations plus the parts', () => {
    expect(createQuotationNumber(2026, 4)).toEqual({
      canonical: 'SFC/RUH/QTN/2026/004',
      fileSafe: 'SFC-RUH-QTN-2026-004',
      year: 2026,
      sequence: 4,
    });
  });

  it('rebuilds from a canonical string', () => {
    expect(quotationNumberFromCanonical('SFC/RUH/QTN/2026/125')).toEqual({
      canonical: 'SFC/RUH/QTN/2026/125',
      fileSafe: 'SFC-RUH-QTN-2026-125',
      year: 2026,
      sequence: 125,
    });
  });

  it('throws rather than returning a partial value for bad input', () => {
    expect(() => quotationNumberFromCanonical('SFC/RUH/QTN/2026/1')).toThrow(QuotationNumberError);
  });
});

describe('quotationYearFromDate', () => {
  it('takes the year from the quotation date', () => {
    expect(quotationYearFromDate('2026-08-11')).toBe(2026);
    expect(quotationYearFromDate('2027-01-01')).toBe(2027);
  });

  it('uses the quotation date even when it differs from today', () => {
    // A quotation dated 2027 finalized while the clock still says 2026 must
    // draw from the 2027 counter, and vice versa for backdating (§7.6).
    expect(quotationYearFromDate('2027-01-05')).toBe(2027);
    expect(quotationYearFromDate('2026-12-30')).toBe(2026);
  });

  it('rejects a non-ISO date', () => {
    expect(() => quotationYearFromDate('11-08-2026')).toThrow(QuotationNumberError);
    expect(() => quotationYearFromDate('2026/08/11')).toThrow(QuotationNumberError);
  });
});

describe('year rollover', () => {
  it('restarts at 001 in a new year', () => {
    // Last of 2026 → first of 2027 (§7.6).
    expect(formatQuotationNumber(2026, 125)).toBe('SFC/RUH/QTN/2026/125');
    expect(formatQuotationNumber(2027, 1)).toBe('SFC/RUH/QTN/2027/001');
    expect(formatQuotationNumber(2027, 2)).toBe('SFC/RUH/QTN/2027/002');
  });
});
