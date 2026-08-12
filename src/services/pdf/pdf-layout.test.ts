import { beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument, type PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { fitInside, fromPdfY, hexToRgb, toDrawRect, toPdfY } from './pdf-coordinates';
import { measureText, wrapRuns, wrapText } from './pdf-text';
import { PAGE } from '@/config/document-layout';

/**
 * The layout primitives, tested against the REAL embedded font rather than a
 * stub. A stubbed measurer would make every wrapping assertion a statement
 * about the stub.
 */

let regular: PDFFont;
let bold: PDFFont;

beforeAll(async () => {
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);

  const fonts = join(process.cwd(), 'src', 'assets', 'fonts');
  // A plain Uint8Array, not a Buffer: pdf-lib's validator does not accept
  // Node's Buffer subclass under jsdom.
  const read = (name: string): Uint8Array => new Uint8Array(readFileSync(join(fonts, name)));

  regular = await document.embedFont(read('Carlito-Regular.ttf'));
  bold = await document.embedFont(read('Carlito-Bold.ttf'));
});

/* -------------------------------------------------------------------------- */

describe('coordinates', () => {
  it('flips top-left to bottom-left', () => {
    expect(toPdfY(0)).toBeCloseTo(PAGE.heightPt, 5);
    expect(toPdfY(PAGE.heightPt)).toBeCloseTo(0, 5);
  });

  it('anchors a box at its bottom, because PDF draw operators do', () => {
    // A 100 pt box whose top is at 111 has its bottom at 211 from the top.
    expect(toPdfY(111, 100)).toBeCloseTo(PAGE.heightPt - 211, 5);
  });

  it('round-trips', () => {
    for (const y of [0, 111, 400.5, 760, PAGE.heightPt]) {
      expect(fromPdfY(toPdfY(y))).toBeCloseTo(y, 5);
    }
    expect(fromPdfY(toPdfY(111, 50), 50)).toBeCloseTo(111, 5);
  });

  it('converts a top-left rect for drawing', () => {
    const drawn = toDrawRect({ x: 34, y: 111, width: 200, height: 50 });

    expect(drawn.x).toBe(34);
    expect(drawn.width).toBe(200);
    expect(drawn.y).toBeCloseTo(PAGE.heightPt - 161, 5);
  });

  it('parses brand colours', () => {
    expect(hexToRgb('#d4292e')).toEqual({ r: 212 / 255, g: 41 / 255, b: 46 / 255 });
    expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('refuses a malformed colour rather than drawing the wrong one', () => {
    expect(() => hexToRgb('red')).toThrowError(/#rrggbb/);
  });
});

describe('fitting an image to its rect', () => {
  const target = { x: 100, y: 200, width: 119, height: 108.8 };

  it('preserves aspect ratio and centres', () => {
    // A wide image fills the width and is centred vertically.
    const fitted = fitInside(200, 100, target);

    expect(fitted.width).toBeCloseTo(119, 5);
    expect(fitted.height).toBeCloseTo(59.5, 5);
    expect(fitted.x).toBeCloseTo(100, 5);
    expect(fitted.y).toBeCloseTo(200 + (108.8 - 59.5) / 2, 5);
  });

  it('never stretches — a stretched signature looks forged', () => {
    const fitted = fitInside(100, 400, target);
    expect(fitted.width / fitted.height).toBeCloseTo(100 / 400, 5);
  });

  it('degrades to the target when the intrinsic size is unknown', () => {
    expect(fitInside(0, 0, target)).toEqual(target);
  });
});

describe('measuring', () => {
  it('reports zero for an empty string', () => {
    expect(measureText('', regular, 14)).toBe(0);
  });

  it('grows with the string', () => {
    expect(measureText('mm', regular, 14)).toBeGreaterThan(measureText('m', regular, 14));
  });

  it('makes bold wider than regular for the same text', () => {
    expect(measureText('Quotation', bold, 14)).toBeGreaterThan(
      measureText('Quotation', regular, 14),
    );
  });
});

describe('word wrapping', () => {
  it('keeps a short line whole', () => {
    expect(wrapText('Short line', regular, 14, 500)).toEqual(['Short line']);
  });

  it('wraps at the column', () => {
    const lines = wrapText('word '.repeat(60).trim(), regular, 14, 200);

    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(measureText(line, regular, 14)).toBeLessThanOrEqual(200);
    }
  });

  it('honours explicit newlines', () => {
    expect(wrapText('a\nb', regular, 14, 500)).toEqual(['a', 'b']);
  });

  it('hard-breaks a run with no spaces, rather than running off the page', () => {
    const lines = wrapText('x'.repeat(500), regular, 14, 100);

    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(measureText(line, regular, 14)).toBeLessThanOrEqual(100);
    }
  });

  it('always returns at least one line', () => {
    expect(wrapText('', regular, 14, 100)).toEqual(['']);
  });
});

describe('mixed-face wrapping', () => {
  const fonts = () => ({ regular, bold });

  it('keeps a bold label and its body on one line when they fit', () => {
    const lines = wrapRuns(
      [
        { text: 'Working Hours: ', bold: true },
        { text: 'Ten hours.', bold: false },
      ],
      fonts(),
      14,
      500,
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]?.map((run) => run.bold)).toEqual([true, false]);
  });

  it('wraps the body under the label, as the reference does', () => {
    const lines = wrapRuns(
      [
        { text: 'Working Hours: ', bold: true },
        { text: 'word '.repeat(80).trim(), bold: false },
      ],
      fonts(),
      14,
      200,
    );

    expect(lines.length).toBeGreaterThan(1);
  });

  it('hard-breaks an unbroken run so nothing overflows the column', () => {
    // The failure this guards against is silent: text drawn past the right
    // margin, off the printable area, visible only on paper.
    const width = 200;
    const lines = wrapRuns(
      [
        { text: 'Rate: ', bold: true },
        { text: 'y'.repeat(600), bold: false },
      ],
      fonts(),
      14,
      width,
    );

    for (const line of lines) {
      const lineWidth = line.reduce(
        (total, run) => total + measureText(run.text, run.bold ? bold : regular, 14),
        0,
      );
      expect(lineWidth).toBeLessThanOrEqual(width + 0.01);
    }
  });

  it('drops leading whitespace at a line start', () => {
    const lines = wrapRuns(
      [
        { text: 'A: ', bold: true },
        { text: 'word '.repeat(40).trim(), bold: false },
      ],
      fonts(),
      14,
      120,
    );

    for (const line of lines) {
      expect(line[0]?.text.startsWith(' ')).toBe(false);
    }
  });

  it('always returns at least one line', () => {
    expect(wrapRuns([], { regular, bold }, 14, 100)).toEqual([[{ text: '', bold: false }]]);
  });
});
