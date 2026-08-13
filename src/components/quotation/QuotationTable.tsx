import { Table, type TableColumn } from '@/components/common/Table';
import { StatusSelect } from '@/components/quotation/StatusSelect';
import { driveLinkOf, type TrackedQuotation } from '@/services/google-sheets/sheets-service';
import { formatDisplayDate } from '@/utils/format-date';
import { formatSar, halalas } from '@shared/money';
import type { QuotationStatus } from '@shared/types';

export interface QuotationTableProps {
  rows: TrackedQuotation[];
  isChangingStatus: boolean;
  onStatusChange: (quotationNumber: string, status: QuotationStatus) => void;
}

/**
 * The register, as a table (PRD §31).
 *
 * The columns mirror the tracking sheet's A–H, in the same order, so someone
 * looking at both sees the same thing. `Drive Folder` is a link exactly when
 * the server recorded one — a quotation that has not been saved to Drive shows
 * a dash rather than a link that goes nowhere.
 */
export function QuotationTable({ rows, isChangingStatus, onStatusChange }: QuotationTableProps) {
  const columns: Array<TableColumn<TrackedQuotation>> = [
    {
      key: 'number',
      header: 'Quotation No.',
      render: (row) =>
        row.quotationNumber.length > 0 ? (
          <span className="font-medium tabular-nums">{row.quotationNumber}</span>
        ) : (
          <span className="text-slate-400 italic">Draft</span>
        ),
    },
    { key: 'date', header: 'Date', render: (row) => formatDisplayDate(row.quotationDate) },
    { key: 'client', header: 'Client Name', render: (row) => row.clientName },
    { key: 'company', header: 'Company Name', render: (row) => row.companyName },
    { key: 'for', header: 'Quotation For', render: (row) => row.quotationFor },
    {
      key: 'total',
      header: 'Total Amount',
      align: 'right',
      render: (row) => formatSar(halalas(row.grandTotal)),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <StatusSelect
          quotationNumber={row.quotationNumber}
          status={row.status}
          disabled={isChangingStatus}
          onChange={(status) => {
            onStatusChange(row.quotationNumber, status);
          }}
        />
      ),
    },
    {
      key: 'drive',
      header: 'Drive Folder',
      render: (row) => {
        const href = driveLinkOf(row.driveFolderUrl);

        return href === null ? (
          <span className="text-slate-400" aria-label="Not saved to Drive">
            —
          </span>
        ) : (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand-navy underline underline-offset-2"
          >
            Open
          </a>
        );
      },
    },
  ];

  return (
    <Table
      columns={columns}
      rows={rows}
      rowKey={(row) => (row.draftId.length > 0 ? row.draftId : row.quotationNumber)}
      caption="Quotations"
    />
  );
}
