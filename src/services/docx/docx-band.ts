/**
 * Letterhead band geometry — shared by the Word header and footer.
 *
 * ---------------------------------------------------------------------------
 * WHY THE BANDS ESCAPE THE MARGINS
 * ---------------------------------------------------------------------------
 * The letterhead's furniture does not respect the body's text box. The logo
 * starts at x 13.9, the footer columns at 13.9, and both rules run to the page
 * edge at x 595.3 — all outside the 34.0 → 582.4 the body text uses.
 *
 * Word measures a table's indent from the LEFT MARGIN, so reaching x 13.9 means
 * a negative indent. That is legal, it is what Word itself produces when you
 * drag a header table into the margin, and it is the only way the rebuilt bands
 * land where the artwork puts them rather than 20 pt inside it.
 *
 * Cell margins are zeroed for the same reason: Word's default 0.08" left inset
 * would shift every band position by 5.8 pt from the measurement.
 */

import { WidthType } from 'docx';

import { BODY_BOX, LETTERHEAD, PAGE } from '@/config/document-layout';
import { toTwips } from './docx-units';

/** Left edge of the letterhead's furniture — the logo and the footer columns. */
export const BAND_LEFT_PT = LETTERHEAD.logoRect.x0;

/** Right edge — the rules run to the page edge. */
export const BAND_RIGHT_PT = Math.min(LETTERHEAD.headerRule.x1, PAGE.widthPt);

/** How wide a band is. Wider than the body text box, deliberately. */
export const BAND_WIDTH_PT = BAND_RIGHT_PT - BAND_LEFT_PT;

/** A band's offset from the left margin. Negative: the band starts outside it. */
export const BAND_INDENT_PT = BAND_LEFT_PT - BODY_BOX.leftPt;

/** The table indent property for a band. */
export function bandIndent(): { size: number; type: (typeof WidthType)['DXA'] } {
  return { size: toTwips(BAND_INDENT_PT), type: WidthType.DXA };
}

/** Zeroed cell insets, so a column's text starts exactly at its measured x. */
export const BAND_CELL_MARGINS = { top: 0, bottom: 0, left: 0, right: 0 } as const;

/**
 * Column shares of a band, from the measured left edges of its columns.
 *
 * The last column runs to the band's right edge, so its width is whatever is
 * left rather than an extra measurement that could disagree with the others.
 */
export function bandColumnRatios(columnLefts: readonly number[]): number[] {
  const edges = [...columnLefts, BAND_RIGHT_PT];
  const widths: number[] = [];

  for (let index = 0; index < columnLefts.length; index += 1) {
    const start = edges[index] ?? BAND_LEFT_PT;
    const end = edges[index + 1] ?? start;
    widths.push(Math.max(0, end - start));
  }

  const total = widths.reduce((sum, width) => sum + width, 0);
  return total === 0 ? widths.map(() => 0) : widths.map((width) => width / total);
}
