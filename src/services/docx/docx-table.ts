/**
 * The items table, as a Word table.
 *
 * ---------------------------------------------------------------------------
 * WHO SPLITS THE TABLE
 * ---------------------------------------------------------------------------
 * Word does. The PDF renderer has to split the rows itself and redraw the
 * header, because a PDF page has no idea what a table is; Word already knows,
 * and `tableHeader: true` on the first row emits `w:tblHeader`, which makes it
 * repeat on every continuation page (PRD §27).
 *
 * So this module is handed the WHOLE table — not the paginator's per-page
 * fragments — and lets Word break it. Feeding it fragments would produce a
 * separate table per page, which looks identical until someone edits the file
 * and the pieces stop lining up.
 *
 * Column widths come from the model's ratios through `columnTwips`, which folds
 * the rounding remainder into the last column so the columns sum to the table
 * width exactly.
 */

import {
  AlignmentType,
  HeightRule,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlignTable,
  WidthType,
} from 'docx';

import { BODY_BOX, COLORS, PAGE, TABLE, TYPOGRAPHY } from '@/config/document-layout';
import type { ColumnSpec, DocumentBlock } from '@/services/document/document-model.types';
import { alignmentFor, hex, FONTS, TABLE_BORDERS, CELL_BORDER } from './docx-styles';
import { columnTwips, toHalfPoints, toTwips } from './docx-units';

/** Absolute column widths in twips, from the model's ratios. */
export function tableColumnTwips(columns: readonly ColumnSpec[]): number[] {
  return columnTwips(
    columns.map((column) => column.widthRatio),
    TABLE.defaultWidthPt,
  );
}

/**
 * How far the table sits from the left margin.
 *
 * §2.4 measured the approved table as centred on the PAGE — its centre, 297.65,
 * is the page centre — and the text box is not symmetric about that centre
 * (34.0 left, 12.9 right). Word's `alignment: CENTER` centres a table between
 * the MARGINS, which lands it 10.6 pt to the right. So the position is stated
 * as an explicit indent instead.
 */
export function tableIndentPt(): number {
  return (PAGE.widthPt - TABLE.defaultWidthPt) / 2 - BODY_BOX.leftPt;
}

function cell(
  text: string,
  column: ColumnSpec,
  widthTwips: number,
  isHeader: boolean,
): TableCell {
  return new TableCell({
    borders: TABLE_BORDERS,
    width: { size: widthTwips, type: WidthType.DXA },
    // The approved document's rows are roomy and their text sits centred in
    // them, so a one-line cell next to a three-line one does not look dropped.
    verticalAlign: VerticalAlignTable.CENTER,
    margins: {
      top: toTwips(TABLE.cellPaddingPt),
      bottom: toTwips(TABLE.cellPaddingPt),
      left: toTwips(TABLE.cellPaddingPt),
      right: toTwips(TABLE.cellPaddingPt),
    },
    children: [
      new Paragraph({
        alignment: alignmentFor(column.align),
        spacing: { before: 0, after: 0, line: toTwips(TYPOGRAPHY.bodyLeadingPt), lineRule: 'exact' },
        children: [
          new TextRun({
            text,
            font: FONTS.body,
            bold: isHeader && TABLE.headerBold,
            size: toHalfPoints(TYPOGRAPHY.bodySizePt),
            color: hex(COLORS.text),
          }),
        ],
      }),
    ],
  });
}

/**
 * Build the Word table for a `table` block.
 *
 * `repeatHeader` is `true` for every table the model produces — the type says
 * so — but it is read rather than assumed, so a future optional table cannot
 * quietly acquire a repeating header it was not meant to have.
 */
export function buildTable(block: Extract<DocumentBlock, { kind: 'table' }>): Table {
  const widths = tableColumnTwips(block.columns);

  const headerRow = new TableRow({
    tableHeader: block.repeatHeader,
    // A header row that splits mid-cell across a page break defeats the point
    // of repeating it.
    cantSplit: true,
    height: { value: toTwips(TABLE.minRowHeightPt), rule: HeightRule.ATLEAST },
    children: block.columns.map((column, index) =>
      cell(column.header, column, widths[index] ?? 0, true),
    ),
  });

  /*
   * Body rows are unsplittable too. Word will happily break a row across a page
   * — leaving `TEST_ONLY item` on one page and `number 12` on the next — and
   * the PDF never can, so allowing it here would be a visible divergence
   * between the two files for the same quotation.
   */
  const bodyRows = block.rows.map(
    (row) =>
      new TableRow({
        cantSplit: true,
        height: { value: toTwips(TABLE.minRowHeightPt), rule: HeightRule.ATLEAST },
        children: block.columns.map((column, index) =>
          cell(row[index] ?? '', column, widths[index] ?? 0, false),
        ),
      }),
  );

  return new Table({
    width: { size: toTwips(TABLE.defaultWidthPt), type: WidthType.DXA },
    // Fixed layout: the measured widths are the widths. Autofit would let Word
    // re-proportion the columns around the content and stop matching the PDF.
    layout: TableLayoutType.FIXED,
    columnWidths: widths,
    alignment: AlignmentType.LEFT,
    ...(TABLE.centredOnPage
      ? { indent: { size: toTwips(tableIndentPt()), type: WidthType.DXA } }
      : {}),
    borders: TABLE_BORDERS,
    rows: [headerRow, ...bodyRows],
  });
}

/** The border width Word will emit, in eighths of a point. For assertions. */
export const TABLE_BORDER_EIGHTHS = CELL_BORDER.size;
