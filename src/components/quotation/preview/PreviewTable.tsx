import { COLORS, TABLE, TYPOGRAPHY } from '@/config/document-layout';
import type { ColumnSpec } from '@/services/document/document-model.types';
import type { ItemCategory } from '@shared/types';

export interface PreviewTableProps {
  category: ItemCategory;
  columns: readonly ColumnSpec[];
  rows: readonly string[][];
  /** A continuation of a table split across pages — the header repeats. */
  isContinuation: boolean;
}

/**
 * A category items table.
 *
 * The approved table is page-CENTRED at a fixed 453.9 pt, not stretched to the
 * text box, so it is centred here with `margin: 0 auto` at that exact width
 * (§2.4). Column widths are ratios from the model; the absolute width belongs
 * to the renderer.
 *
 * On a continuation page the header repeats (PRD §27) and is labelled for a
 * screen reader, so the second half of a split table is not an unexplained set
 * of rows.
 */
export function PreviewTable({ category, columns, rows, isContinuation }: PreviewTableProps) {
  const border = `${String(TABLE.borderWidthPt)}pt solid ${TABLE.borderColor}`;

  const cellStyle = (align: ColumnSpec['align']): React.CSSProperties => ({
    border,
    padding: `${String(TABLE.cellPaddingPt)}pt`,
    textAlign: align,
    height: `${String(TABLE.minRowHeightPt)}pt`,
    verticalAlign: 'middle',
    lineHeight: `${String(TYPOGRAPHY.bodyLeadingPt)}pt`,
  });

  return (
    <table
      style={{
        width: `${String(TABLE.defaultWidthPt)}pt`,
        margin: `0 auto ${String(TYPOGRAPHY.paragraphSpaceAfterPt)}pt`,
        borderCollapse: 'collapse',
        color: COLORS.text,
      }}
    >
      <caption className="sr-only">
        {category} items{isContinuation ? ' (continued)' : ''}
      </caption>
      <thead>
        <tr>
          {columns.map((column) => (
            <th
              key={column.key}
              scope="col"
              style={{
                ...cellStyle(column.align),
                width: `${String(column.widthRatio * 100)}%`,
                fontWeight: TABLE.headerBold ? 700 : 400,
              }}
            >
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rowIndex) => (
          // Rows carry no id in the model, and a split table renumbers from
          // zero on each page, so position is genuinely the only key available.
          <tr key={`${category}-${String(rowIndex)}`}>
            {columns.map((column, columnIndex) => (
              <td key={column.key} style={cellStyle(column.align)}>
                {row[columnIndex] ?? ''}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
