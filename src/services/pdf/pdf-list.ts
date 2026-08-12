/**
 * The numbered Terms & Conditions list.
 *
 * The approved document uses a hanging indent: the number at x 52, the text at
 * x 70, so a wrapped line aligns under the text rather than under the number.
 * Both come from `TERMS_LIST` (§2.4).
 *
 * Each item reads `**Title:** body` as one flow, which is why it is drawn as
 * runs rather than two separate strings — the body has to be able to wrap onto
 * the line after the bold title, not start on a new one.
 */

import { BODY_BOX, TERMS_LIST, TYPOGRAPHY } from '@/config/document-layout';
import type { TermItem } from '@/services/document/document-model.types';
import type { PdfLayoutEngine } from './pdf-layout-engine';
import { wrapRuns, type TextRun } from './pdf-text';

/** Width available to a term's text, from the hanging indent to the margin. */
export function termTextWidth(): number {
  return BODY_BOX.rightPt - TERMS_LIST.textXPt;
}

function runsFor(item: TermItem): TextRun[] {
  return [
    { text: `${item.title}: `, bold: true },
    { text: item.body, bold: false },
  ];
}

/** Wrapped lines for one item, using the embedded font's real metrics. */
export function termLines(engine: PdfLayoutEngine, item: TermItem): TextRun[][] {
  return wrapRuns(runsFor(item), engine.embeddedFonts, TYPOGRAPHY.bodySizePt, termTextWidth());
}

/** Height of one item, including the space after it. */
export function measureTermItem(engine: PdfLayoutEngine, item: TermItem): number {
  return termLines(engine, item).length * TERMS_LIST.leadingPt + TERMS_LIST.spaceAfterPt;
}

export interface DrawTermsOptions {
  items: readonly TermItem[];
  topY: number;
  /** The number the first item carries. A split list continues, never restarts. */
  startNumber: number;
}

/** Draw a run of term items. Returns the height consumed. */
export function drawTerms(engine: PdfLayoutEngine, options: DrawTermsOptions): number {
  let y = options.topY;

  options.items.forEach((item, index) => {
    const number = `${String(options.startNumber + index)}.`;

    engine.drawLine(number, { x: TERMS_LIST.numberXPt, y });

    for (const line of termLines(engine, item)) {
      engine.drawRuns(line, { x: TERMS_LIST.textXPt, y });
      y += TERMS_LIST.leadingPt;
    }

    y += TERMS_LIST.spaceAfterPt;
  });

  return y - options.topY;
}
