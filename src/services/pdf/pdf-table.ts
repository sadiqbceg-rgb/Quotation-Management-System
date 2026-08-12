/**
 * Table rendering.
 *
 * The approved quotation's table (§2.4) is page-CENTRED at 453.9 pt — its
 * centre, 297.65, is the exact page centre — with 0.5 pt black borders, a bold
 * header row and rows about 33.9 pt tall. All of that comes from `TABLE`.
 *
 * Header repetition on a continuation page is PRD §27. The pagination pass has
 * already split the rows and flagged the continuation; this module only draws
 * what it is given, header included, every time.
 */

import { PAGE, TABLE, TYPOGRAPHY } from '@/config/document-layout';
import type { ColumnSpec } from '@/services/document/document-model.types';
import type { PdfLayoutEngine } from './pdf-layout-engine';

/** Left edge of a page-centred table of the standard width. */
export function tableLeft(): number {
  return (PAGE.widthPt - TABLE.defaultWidthPt) / 2;
}

/** Absolute column widths from the model's ratios. */
export function columnWidths(columns: readonly ColumnSpec[]): number[] {
  return columns.map((column) => column.widthRatio * TABLE.defaultWidthPt);
}

function cellTextX(
  align: ColumnSpec['align'],
  cellX: number,
  cellWidth: number,
  textWidth: number,
): number {
  const inner = cellWidth - TABLE.cellPaddingPt * 2;

  switch (align) {
    case 'right':
      return cellX + TABLE.cellPaddingPt + Math.max(0, inner - textWidth);
    case 'center':
      return cellX + TABLE.cellPaddingPt + Math.max(0, (inner - textWidth) / 2);
    default:
      return cellX + TABLE.cellPaddingPt;
  }
}

/** How tall a row must be for its tallest wrapped cell to fit. */
export function rowHeight(
  engine: PdfLayoutEngine,
  cells: readonly string[],
  columns: readonly ColumnSpec[],
  bold: boolean,
): number {
  const widths = columnWidths(columns);

  const lines = cells.reduce((most, cell, index) => {
    const width = (widths[index] ?? 0) - TABLE.cellPaddingPt * 2;
    return Math.max(most, engine.wrap(cell, width, { bold }).length);
  }, 1);

  // A one-line row is the measured 33.9 pt; a wrapped one grows from there.
  return Math.max(TABLE.minRowHeightPt, lines * TYPOGRAPHY.bodyLeadingPt + TABLE.cellPaddingPt * 2);
}

/** Draw one row, borders and all. Returns the height consumed. */
function drawRow(
  engine: PdfLayoutEngine,
  cells: readonly string[],
  columns: readonly ColumnSpec[],
  topY: number,
  bold: boolean,
): number {
  const widths = columnWidths(columns);
  const height = rowHeight(engine, cells, columns, bold);

  let x = tableLeft();

  columns.forEach((column, index) => {
    const width = widths[index] ?? 0;

    engine.drawRect(
      { x, y: topY, width, height },
      { borderColor: TABLE.borderColor, borderWidth: TABLE.borderWidthPt },
    );

    const text = cells[index] ?? '';
    const lines = engine.wrap(text, width - TABLE.cellPaddingPt * 2, { bold });

    // Vertically centred, matching the reference's roomy single-line rows.
    const textHeight = lines.length * TYPOGRAPHY.bodyLeadingPt;
    let lineY = topY + Math.max(TABLE.cellPaddingPt, (height - textHeight) / 2);

    for (const line of lines) {
      engine.drawLine(line, {
        x: cellTextX(column.align, x, width, engine.measure(line, { bold })),
        y: lineY,
        bold,
      });
      lineY += TYPOGRAPHY.bodyLeadingPt;
    }

    x += width;
  });

  return height;
}

export interface DrawTableOptions {
  columns: readonly ColumnSpec[];
  rows: readonly string[][];
  topY: number;
}

/**
 * Draw a table fragment: header, then rows.
 *
 * The header is drawn unconditionally. On a continuation page that is exactly
 * what PRD §27 requires, and on the first page it is simply the header.
 */
export function drawTable(engine: PdfLayoutEngine, options: DrawTableOptions): number {
  let y = options.topY;

  y += drawRow(
    engine,
    options.columns.map((column) => column.header),
    options.columns,
    y,
    TABLE.headerBold,
  );

  for (const row of options.rows) {
    y += drawRow(engine, row, options.columns, y, false);
  }

  return y - options.topY;
}

/** Total height of a fragment, without drawing it. */
export function measureTable(
  engine: PdfLayoutEngine,
  columns: readonly ColumnSpec[],
  rows: readonly string[][],
): number {
  const header = rowHeight(
    engine,
    columns.map((column) => column.header),
    columns,
    TABLE.headerBold,
  );

  return rows.reduce((total, row) => total + rowHeight(engine, row, columns, false), header);
}
