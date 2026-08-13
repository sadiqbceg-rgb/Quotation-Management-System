/**
 * The Word footer — the bottom of the letterhead, rebuilt.
 *
 * The amber rule and the three contact columns, in the measured proportions.
 * Like the header it is declared ONCE on the section, which is what makes Word
 * repeat it on every page.
 *
 * The column widths are not chosen: they are the gaps between the measured
 * `LETTERHEAD.footerColumnsX` positions, expressed as a share of the printed
 * band. Change the measurements and the footer follows.
 */

import {
  AlignmentType,
  BorderStyle,
  Footer,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';

import { BODY_BOX, COLORS, LETTERHEAD, TYPOGRAPHY } from '@/config/document-layout';
import { LETTERHEAD_FOOTER_COLUMNS } from '@/config/letterhead-content';
import {
  BAND_CELL_MARGINS,
  BAND_WIDTH_PT,
  bandColumnRatios,
  bandIndent,
} from './docx-band';
import { columnTwips, toHalfPoints, toTwips } from './docx-units';
import { hex, FONTS, NO_BORDERS } from './docx-styles';

/** The three columns' share of the band, from their measured left edges. */
export function footerColumnRatios(): number[] {
  return bandColumnRatios(LETTERHEAD.footerColumnsX);
}

function columnCell(
  column: (typeof LETTERHEAD_FOOTER_COLUMNS)[number],
  widthTwips: number,
): TableCell {
  const paragraphs: Paragraph[] = [];

  if (column.label.length > 0) {
    paragraphs.push(
      new Paragraph({
        spacing: { after: 0 },
        children: [
          new TextRun({
            text: column.label,
            font: FONTS.body,
            bold: true,
            size: toHalfPoints(TYPOGRAPHY.footerLabelSizePt),
            color: hex(COLORS.text),
          }),
        ],
      }),
    );
  }

  for (const line of column.lines) {
    paragraphs.push(
      new Paragraph({
        spacing: { after: 0 },
        children: [
          new TextRun({
            text: line,
            font: FONTS.body,
            size: toHalfPoints(TYPOGRAPHY.footerBodySizePt),
            color: hex(COLORS.text),
          }),
        ],
      }),
    );
  }

  return new TableCell({
    borders: NO_BORDERS,
    margins: BAND_CELL_MARGINS,
    width: { size: widthTwips, type: WidthType.DXA },
    children: paragraphs,
  });
}

export function buildFooter(): Footer {
  /*
   * The amber rule, as a paragraph TOP border rather than a drawn shape: Word
   * renders a border at an exact width and LibreOffice agrees with it, whereas
   * the two disagree about a zero-height table row.
   */
  const rule = new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { before: 0, after: toTwips(TYPOGRAPHY.paragraphSpaceAfterPt) },
    // The rule runs the full page width, so it starts outside the left margin
    // and ends outside the right one. A paragraph border spans the paragraph's
    // extent, which the negative indents widen to the page.
    indent: {
      left: toTwips(LETTERHEAD.footerRule.x0 - BODY_BOX.leftPt),
      right: toTwips(BODY_BOX.rightPt - LETTERHEAD.footerRule.x1),
    },
    border: {
      top: {
        style: BorderStyle.SINGLE,
        // Word states border widths in eighths of a point.
        size: Math.round((LETTERHEAD.footerRule.y1 - LETTERHEAD.footerRule.y0) * 8),
        color: hex(COLORS.footerAmber),
      },
    },
    children: [],
  });

  const widths = columnTwips(footerColumnRatios(), BAND_WIDTH_PT);

  const columns = new Table({
    width: { size: toTwips(BAND_WIDTH_PT), type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    columnWidths: widths,
    indent: bandIndent(),
    margins: BAND_CELL_MARGINS,
    borders: NO_BORDERS,
    rows: [
      new TableRow({
        children: LETTERHEAD_FOOTER_COLUMNS.map((column, index) =>
          columnCell(column, widths[index] ?? 0),
        ),
      }),
    ],
  });

  return new Footer({ children: [rule, columns] });
}
