import type { ReactNode } from 'react';
import { cn } from '@/utils/cn';

export interface TableColumn<TRow> {
  key: string;
  header: string;
  align?: 'left' | 'right' | 'center';
  width?: string;
  render: (row: TRow, index: number) => ReactNode;
}

export interface TableProps<TRow> {
  columns: ReadonlyArray<TableColumn<TRow>>;
  rows: readonly TRow[];
  rowKey: (row: TRow, index: number) => string;
  emptyMessage?: string;
  caption?: string;
  className?: string;
}

const ALIGN_CLASSES = {
  left: 'text-left',
  right: 'text-right tabular-nums',
  center: 'text-center',
} as const;

/**
 * A screen table for lists and item grids.
 *
 * This is UI only. Document tables are produced by the renderers in Phases 08
 * and 09 from the shared document model, with their own measured geometry —
 * see src/config/document-layout.ts.
 */
export function Table<TRow>({
  columns,
  rows,
  rowKey,
  emptyMessage = 'No records.',
  caption,
  className,
}: TableProps<TRow>) {
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full border-collapse text-sm">
        {caption !== undefined ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                style={column.width === undefined ? undefined : { width: column.width }}
                className={cn(
                  'px-3 py-2.5 font-semibold text-slate-700',
                  ALIGN_CLASSES[column.align ?? 'left'],
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-8 text-center text-slate-500">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row, index) => (
              <tr key={rowKey(row, index)} className="border-b border-slate-100 last:border-b-0">
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn('px-3 py-2.5', ALIGN_CLASSES[column.align ?? 'left'])}
                  >
                    {column.render(row, index)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
