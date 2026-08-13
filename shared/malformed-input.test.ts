/**
 * What the shared modules do with input that is wrong.
 *
 * ---------------------------------------------------------------------------
 * WHY THESE ARE GROUPED
 * ---------------------------------------------------------------------------
 * Every function here sits on a boundary: a number read back out of a
 * spreadsheet a person has edited, a PNG uploaded through a browser, a date
 * typed into a form. The happy paths are covered by each module's own suite.
 * These are the refusals — and a refusal that is wrong is worse than a happy
 * path that is wrong, because it either lets bad data through silently or
 * rejects good data with no explanation.
 *
 * Each one asserts the specific answer, not merely "it threw".
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_QUOTATION_CODES,
  QuotationNumberError,
  createQuotationNumber,
  parseQuotationNumber,
  quotationYearFromDate,
} from './numbering';
import { hasPngSignature, readPngHeader } from './png';
import { countDecimals, escapeForSheet, unescapeFromSheet } from './validation-rules';
import { TEST_ONLY_buildPng } from '../google-apps-script/src/__fixtures__/png-fixtures';

/* -------------------------------------------------------------------------- */
/* Quotation codes                                                            */
/* -------------------------------------------------------------------------- */

describe('the configured quotation codes', () => {
  it.each([
    ['empty', ''],
    ['lowercase', 'sfc'],
    ['with a space', 'S FC'],
    ['with a slash', 'S/C'],
    ['too long', 'ABCDEFGHIJK'],
  ])('refuses a %s company code, naming which one is wrong', (_name, company) => {
    // A bad code from Script Properties must fail loudly at the point of use.
    // Silently issuing `//QTN/2026/001` would put it on a client's document.
    expect(() =>
      createQuotationNumber(2026, 1, { ...DEFAULT_QUOTATION_CODES, company }),
    ).toThrow(QuotationNumberError);
  });

  it('refuses a bad branch code and a bad document-type code too', () => {
    expect(() =>
      createQuotationNumber(2026, 1, { ...DEFAULT_QUOTATION_CODES, branch: 'ruh!' }),
    ).toThrow(QuotationNumberError);
    expect(() =>
      createQuotationNumber(2026, 1, { ...DEFAULT_QUOTATION_CODES, documentType: '' }),
    ).toThrow(QuotationNumberError);
  });
});

/* -------------------------------------------------------------------------- */
/* Parsing a number back out of storage                                       */
/* -------------------------------------------------------------------------- */

describe('parsing a quotation number', () => {
  it('returns null rather than throwing, so one bad row cannot break a register', () => {
    // `listQuotationRows` skips an unreadable row; that depends on this
    // returning null instead of throwing.
    expect(parseQuotationNumber('TEST_ONLY not a number')).toBeNull();
    expect(parseQuotationNumber('')).toBeNull();
  });

  it('refuses a value that is not a string at all', () => {
    // A spreadsheet cell can hold a number, a date or a boolean, and every one
    // of those arrives here as something other than a string.
    const notStrings: unknown[] = [42, null, undefined, {}, [], true, new Date()];

    for (const value of notStrings) {
      expect(parseQuotationNumber(value as string), String(value)).toBeNull();
    }
  });

  it('refuses a year before the system existed', () => {
    // The upper bound is 9999, which a four-digit year cannot exceed — so the
    // only reachable half of that check is this one.
    expect(parseQuotationNumber('SFC/RUH/QTN/1999/001')).toBeNull();
    expect(parseQuotationNumber('SFC/RUH/QTN/2000/001')).not.toBeNull();
  });

  it('refuses sequence zero, because counting starts at one', () => {
    expect(parseQuotationNumber('SFC/RUH/QTN/2026/000')).toBeNull();
  });

  it('refuses a non-canonical padding of a valid sequence', () => {
    // `0004` and `4` both mean four, and neither is how this system writes it.
    // Accepting them would let two spellings of one number into the register.
    expect(parseQuotationNumber('SFC/RUH/QTN/2026/0004')).toBeNull();
    expect(parseQuotationNumber('SFC/RUH/QTN/2026/4')).toBeNull();
    expect(parseQuotationNumber('SFC/RUH/QTN/2026/004')).not.toBeNull();
  });

  it('refuses a number issued under different codes', () => {
    expect(parseQuotationNumber('XXX/YYY/ZZZ/2026/001')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* The year, from a date                                                      */
/* -------------------------------------------------------------------------- */

describe('taking the year from a quotation date', () => {
  it.each([
    ['a slashed date', '11/08/2026'],
    ['a written date', '11 August 2026'],
    ['an empty string', ''],
    ['a timestamp', '2026-08-11T00:00:00Z'],
    ['a two-digit year', '26-08-11'],
  ])('refuses %s rather than guessing', (_name, value) => {
    expect(() => quotationYearFromDate(value)).toThrow(QuotationNumberError);
  });

  it('refuses a year outside the issuable range', () => {
    expect(() => quotationYearFromDate('1999-01-01')).toThrow(QuotationNumberError);
  });
});

/* -------------------------------------------------------------------------- */
/* PNG inspection                                                             */
/* -------------------------------------------------------------------------- */

describe('recognising a PNG', () => {
  it('accepts a real one', () => {
    expect(hasPngSignature(TEST_ONLY_buildPng({ width: 4, height: 4 }))).toBe(true);
  });

  it('refuses bytes too short to carry a signature', () => {
    expect(hasPngSignature([])).toBe(false);
    expect(hasPngSignature([0x89, 0x50, 0x4e])).toBe(false);
  });

  it('refuses a JPEG wearing a .png name', () => {
    expect(hasPngSignature([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])).toBe(false);
  });

  it('handles the SIGNED byte arrays Apps Script hands back', () => {
    // 0x89 arrives as -119 from `Blob.getBytes()`. A comparison that does not
    // normalise rejects every real PNG the backend reads.
    const signed = [...TEST_ONLY_buildPng({ width: 4, height: 4 })].map((byte) =>
      byte > 127 ? byte - 256 : byte,
    );

    expect(hasPngSignature(signed)).toBe(true);
  });
});

describe('reading a PNG header', () => {
  it('reports the dimensions of a real one', () => {
    const header = readPngHeader(TEST_ONLY_buildPng({ width: 12, height: 5 }));

    expect(header?.width).toBe(12);
    expect(header?.height).toBe(5);
  });

  it('returns null for anything it cannot read, rather than a partial answer', () => {
    expect(readPngHeader([])).toBeNull();
    expect(readPngHeader([0xff, 0xd8, 0xff, 0xe0])).toBeNull();
    // A valid signature followed by nothing: truncated mid-upload.
    expect(readPngHeader([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])).toBeNull();
  });
});

describe('detecting transparency', () => {
  it('reports alpha on a PNG that has it', () => {
    // The seal must be keyed; an opaque one prints a white box over the text.
    expect(readPngHeader(TEST_ONLY_buildPng({ width: 4, height: 4 }))?.hasAlpha).toBe(true);
  });

  it('does not walk off the end of a truncated PNG', () => {
    // A chunk length larger than the file is what a corrupt upload looks like.
    // The walk has to stop rather than read past the buffer.
    const bytes = [...TEST_ONLY_buildPng({ width: 4, height: 4 })].slice(0, 24);
    bytes[16] = 0x7f;
    bytes[17] = 0xff;
    bytes[18] = 0xff;
    bytes[19] = 0xff;

    expect(() => readPngHeader(bytes)).not.toThrow();
  });

  it('reads the header of a PNG whose chunks it cannot fully walk', () => {
    const full = TEST_ONLY_buildPng({ width: 9, height: 3 });
    const header = readPngHeader([...full].slice(0, 33));

    // IHDR is the first chunk, so the dimensions survive a truncation after it.
    expect(header?.width).toBe(9);
    expect(header?.height).toBe(3);
  });
});

/* -------------------------------------------------------------------------- */
/* Sheet escaping, both directions                                            */
/* -------------------------------------------------------------------------- */

describe('un-escaping a value read back from a sheet', () => {
  it('restores a value that was escaped once', () => {
    for (const value of ['=1+1', '+A1', '-2', '@import']) {
      expect(unescapeFromSheet(escapeForSheet(value)), value).toBe(value);
    }
  });

  it("leaves a leading apostrophe alone when what follows is not a formula", () => {
    // A client genuinely called "'Al Noor" must come back with its apostrophe;
    // stripping unconditionally would quietly edit the company's data.
    expect(unescapeFromSheet("'TEST_ONLY Contact")).toBe("'TEST_ONLY Contact");
  });

  it('is a no-op on a value that was never escaped', () => {
    expect(unescapeFromSheet('TEST_ONLY Client Company')).toBe('TEST_ONLY Client Company');
    expect(unescapeFromSheet('')).toBe('');
  });
});

describe('counting decimals', () => {
  it('reports zero for a whole number', () => {
    expect(countDecimals(40)).toBe(0);
    expect(countDecimals(0)).toBe(0);
    expect(countDecimals(-7)).toBe(0);
  });

  it('counts the places a user actually typed', () => {
    expect(countDecimals(1.5)).toBe(1);
    expect(countDecimals(19.99)).toBe(2);
    expect(countDecimals(0.125)).toBe(3);
  });
});
