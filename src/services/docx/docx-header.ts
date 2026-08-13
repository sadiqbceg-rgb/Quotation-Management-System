/**
 * The Word header — the top of the letterhead, rebuilt.
 *
 * ---------------------------------------------------------------------------
 * WHY REBUILT RATHER THAN EMBEDDED
 * ---------------------------------------------------------------------------
 * The PDF embeds `reference/letterhead.pdf` as a vector page and gets the
 * artwork exactly. Word cannot embed a PDF page as a background, so the header
 * is reconstructed from the logo image plus the transcribed text in
 * `letterhead-content.ts`.
 *
 * Declaring it on the SECTION is what makes Word repeat it on every page —
 * the same guarantee the PDF gets from its background, obtained a different
 * way. It is never emitted per page.
 *
 * ---------------------------------------------------------------------------
 * THE ONE PLACE ARABIC IS RE-TYPESET
 * ---------------------------------------------------------------------------
 * The Arabic company name is emitted as a run with `rightToLeft: true` and an
 * Arabic-capable font; Word does the bidirectional reordering and the glyph
 * shaping. It is a FIXED string from the company's own letterhead, never user
 * content, which is what makes this acceptable where the PDF renderer refuses
 * to draw Arabic at all (§13.2).
 */

import {
  AlignmentType,
  BorderStyle,
  Header,
  ImageRun,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TabStopType,
  TextRun,
  WidthType,
} from 'docx';

import { COLORS, LETTERHEAD, TYPOGRAPHY } from '@/config/document-layout';
import {
  ARABIC_FONT,
  LETTERHEAD_COMPANY_NAME,
  LETTERHEAD_COMPANY_NAME_ARABIC,
  LETTERHEAD_CR_LINE,
  LETTERHEAD_CR_LINE_ARABIC,
} from '@/config/letterhead-content';
import {
  BAND_CELL_MARGINS,
  BAND_LEFT_PT,
  BAND_RIGHT_PT,
  BAND_WIDTH_PT,
  bandColumnRatios,
  bandIndent,
} from './docx-band';
import { hex, FONTS, NO_BORDERS } from './docx-styles';
import { columnTwips, toHalfPoints, toPixels, toTwips } from './docx-units';

/** The logo's printed size, measured from the letterhead (§2.4). */
function logoSize(): { width: number; height: number } {
  return {
    width: toPixels(LETTERHEAD.logoRect.x1 - LETTERHEAD.logoRect.x0),
    height: toPixels(LETTERHEAD.logoRect.y1 - LETTERHEAD.logoRect.y0),
  };
}

/**
 * Where the band splits: at the header rule's left edge.
 *
 * That is where the letterhead's right-hand block begins — the rule starts at
 * x 185 precisely because the company name sits above it. A 50/50 split leaves
 * the name too narrow and Word wraps `SPEED FALCON COMPANY` onto two lines.
 */
export function headerColumnRatios(): number[] {
  return bandColumnRatios([BAND_LEFT_PT, LETTERHEAD.headerRule.x0]);
}

/**
 * Indents that centre a paragraph on the right block's axis.
 *
 * The letterhead centres the company name and the C.R. line on x 306.8, which
 * is neither the cell's centre nor the page's. Indenting both edges moves the
 * paragraph's own centre onto that axis, so `AlignmentType.CENTER` then does
 * the right thing.
 */
export function rightBlockIndent(): { left: number; right: number } {
  return {
    left: toTwips(LETTERHEAD.rightBlock.x0 - LETTERHEAD.headerRule.x0),
    right: toTwips(BAND_RIGHT_PT - LETTERHEAD.rightBlock.x1),
  };
}

/**
 * The letterhead top, plus the watermark.
 *
 * The watermark is passed in rather than built here because it belongs to the
 * PAGE, not to the header band — but Word has no page-background construct, and
 * a floating image anchored in the header is how Word's own watermark feature
 * works. See `docx-watermark.ts`.
 */
export function buildHeader(logo: Uint8Array, watermark: Paragraph): Header {
  const nameParagraph = new Paragraph({
    alignment: AlignmentType.CENTER,
    indent: rightBlockIndent(),
    spacing: { after: 0 },
    children: [
      new TextRun({
        text: LETTERHEAD_COMPANY_NAME_ARABIC,
        // The only right-to-left run in the system. Word shapes it.
        rightToLeft: true,
        font: ARABIC_FONT,
        bold: true,
        size: toHalfPoints(TYPOGRAPHY.companyNameSizePt),
        color: hex(COLORS.text),
      }),
    ],
  });

  const latinName = new Paragraph({
    alignment: AlignmentType.CENTER,
    indent: rightBlockIndent(),
    spacing: { after: 0 },
    children: [
      new TextRun({
        text: LETTERHEAD_COMPANY_NAME,
        font: FONTS.body,
        bold: true,
        size: toHalfPoints(TYPOGRAPHY.companyNameSizePt),
        color: hex(COLORS.brandRed),
      }),
    ],
  });

  /*
   * The C.R. line belongs to the right-hand block, not the left margin: the
   * letterhead sets the Latin half at x 187.2 and the Arabic half from x 330.8,
   * both BESIDE the logo rather than beneath it. Positions are therefore
   * measured from the cell's own left edge, which is the rule's x 185.
   *
   * A tab stop separates the two halves; a run of spaces would move with the
   * font, and this line is set in two different ones.
   */
  const crLine = new Paragraph({
    spacing: { after: 0 },
    indent: { left: toTwips(LETTERHEAD.rightBlock.x0 - LETTERHEAD.headerRule.x0) },
    /*
     * The red rule is this paragraph's TOP BORDER, not an element of its own.
     * A border spans the paragraph's full width — here the right cell, which is
     * what the letterhead draws (x 185 to the page edge) — while the company
     * name above is indented to its own centred axis and would carry a short
     * rule instead. An empty paragraph would work too but costs a full line of
     * height, which would push the header past the 111 pt top margin and shove
     * the body text down every page.
     */
    border: {
      top: {
        style: BorderStyle.SINGLE,
        // Word states border widths in eighths of a point.
        size: Math.round((LETTERHEAD.headerRule.y1 - LETTERHEAD.headerRule.y0) * 8),
        color: hex(COLORS.brandRed),
      },
    },
    tabStops: [
      {
        type: TabStopType.LEFT,
        position: toTwips(LETTERHEAD.rightBlock.arabicX - LETTERHEAD.headerRule.x0),
      },
    ],
    children: [
      new TextRun({
        text: LETTERHEAD_CR_LINE,
        font: FONTS.body,
        bold: true,
        size: toHalfPoints(TYPOGRAPHY.crLineSizePt),
        color: hex(COLORS.text),
      }),
      new TextRun({ text: '\t', font: FONTS.body }),
      new TextRun({
        text: LETTERHEAD_CR_LINE_ARABIC,
        rightToLeft: true,
        font: ARABIC_FONT,
        bold: true,
        size: toHalfPoints(TYPOGRAPHY.crLineSizePt),
        color: hex(COLORS.text),
      }),
    ],
  });

  /*
   * A two-column borderless table, because the letterhead puts the logo hard
   * left and everything else hard right on the SAME band — the rule and the
   * C.R. line both sit within the logo's vertical span. A single paragraph
   * cannot do that; a table can, and Word treats it as ordinary header content.
   */
  const widths = columnTwips(headerColumnRatios(), BAND_WIDTH_PT);

  const band = new Table({
    width: { size: toTwips(BAND_WIDTH_PT), type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    columnWidths: widths,
    indent: bandIndent(),
    margins: BAND_CELL_MARGINS,
    borders: NO_BORDERS,
    rows: [
      new TableRow({
        children: [
          new TableCell({
            borders: NO_BORDERS,
            width: { size: widths[0] ?? 0, type: WidthType.DXA },
            children: [
              new Paragraph({
                spacing: { after: 0 },
                children: [
                  new ImageRun({
                    type: 'jpg',
                    data: logo,
                    transformation: logoSize(),
                  }),
                ],
              }),
            ],
          }),
          new TableCell({
            borders: NO_BORDERS,
            width: { size: widths[1] ?? 0, type: WidthType.DXA },
            children: [nameParagraph, latinName, crLine],
          }),
        ],
      }),
    ],
  });

  return new Header({ children: [watermark, band] });
}
