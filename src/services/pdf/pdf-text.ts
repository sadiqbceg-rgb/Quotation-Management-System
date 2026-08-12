/**
 * Text measurement and wrapping.
 *
 * `pdf-lib` draws strings; it does not lay them out. Everything below is the
 * layout half.
 *
 * Measurement uses the EMBEDDED font's real advance widths, so a wrapped line
 * genuinely fits the column it was measured against. The Phase 07 estimator
 * approximates the same thing without a font, for the preview.
 */

import type { PDFFont } from 'pdf-lib';

/** Width of a string at a size, from the font's own metrics. */
export function measureText(text: string, font: PDFFont, size: number): number {
  if (text.length === 0) return 0;
  return font.widthOfTextAtSize(text, size);
}

/**
 * Break a single unbroken run that is wider than the column.
 *
 * A URL, a part number, or a pasted string with no spaces would otherwise
 * overflow the page silently. Broken by character, at the last one that fits.
 */
function hardBreak(word: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const pieces: string[] = [];
  let current = '';

  for (const character of word) {
    const candidate = current + character;

    if (current.length > 0 && measureText(candidate, font, size) > maxWidth) {
      pieces.push(current);
      current = character;
    } else {
      current = candidate;
    }
  }

  if (current.length > 0) pieces.push(current);
  return pieces;
}

/**
 * Greedy word wrap.
 *
 * Greedy rather than Knuth–Plass: Word wraps greedily too, and the point of
 * using a metric-compatible font is that this document breaks where Word would.
 * A cleverer algorithm would produce prettier — and different — line breaks.
 *
 * Explicit newlines are honoured as hard breaks.
 */
export function wrapText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  if (maxWidth <= 0) return [text];

  const lines: string[] = [];

  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter((word) => word.length > 0);

    if (words.length === 0) {
      lines.push('');
      continue;
    }

    let current = '';

    for (const word of words) {
      const candidate = current.length === 0 ? word : `${current} ${word}`;

      if (measureText(candidate, font, size) <= maxWidth) {
        current = candidate;
        continue;
      }

      if (current.length > 0) {
        lines.push(current);
        current = '';
      }

      if (measureText(word, font, size) > maxWidth) {
        const pieces = hardBreak(word, font, size, maxWidth);
        // Every piece but the last is a finished line; the last continues.
        lines.push(...pieces.slice(0, -1));
        current = pieces[pieces.length - 1] ?? '';
      } else {
        current = word;
      }
    }

    if (current.length > 0) lines.push(current);
  }

  return lines.length > 0 ? lines : [''];
}

/** Height of wrapped text at a leading. */
export function wrappedHeight(lineCount: number, leading: number): number {
  return Math.max(1, lineCount) * leading;
}

/**
 * A run of text with its own face.
 *
 * The approved document sets a term as `**Title:** body` — bold then regular on
 * the same line — so a line is a sequence of runs, not a single string.
 */
export interface TextRun {
  text: string;
  bold: boolean;
}

/**
 * Wrap a sequence of runs, keeping each fragment's face.
 *
 * Used for the terms list and the meta block, where a bold label is followed by
 * regular text that must wrap underneath it as one flow.
 */
export function wrapRuns(
  runs: readonly TextRun[],
  fonts: { regular: PDFFont; bold: PDFFont },
  size: number,
  maxWidth: number,
): TextRun[][] {
  const lines: TextRun[][] = [];

  let current: TextRun[] = [];
  let currentWidth = 0;

  const flush = (): void => {
    if (current.length > 0) lines.push(current);
    current = [];
    currentWidth = 0;
  };

  for (const run of runs) {
    const font = run.bold ? fonts.bold : fonts.regular;
    const words = run.text.split(/(\s+)/).filter((piece) => piece.length > 0);

    for (const rawWord of words) {
      // Whitespace at a line start is dropped, exactly as a wrapper should.
      if (/^\s+$/.test(rawWord) && currentWidth === 0) continue;

      /*
       * A run wider than the whole column has to be broken by character, or it
       * runs off the right margin and off the page. Without this a pasted
       * unbroken string — a URL, a part number — silently produces a document
       * with text outside the printable area.
       */
      const pieces =
        measureText(rawWord, font, size) > maxWidth
          ? hardBreak(rawWord, font, size, maxWidth)
          : [rawWord];

      for (const word of pieces) {
      const width = measureText(word, font, size);

      if (currentWidth + width > maxWidth && currentWidth > 0) flush();

      const last = current[current.length - 1];
      if (last !== undefined && last.bold === run.bold) {
        last.text += word;
      } else {
        current.push({ text: word, bold: run.bold });
      }
      currentWidth += width;
      }
    }
  }

  flush();
  return lines.length > 0 ? lines : [[{ text: '', bold: false }]];
}
