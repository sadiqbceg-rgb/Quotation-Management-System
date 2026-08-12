import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { PageHeader } from '@/components/common/PageHeader';
import { buttonClasses } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { EmptyState } from '@/components/common/EmptyState';
import { Input } from '@/components/common/Input';
import { Select } from '@/components/common/Select';
import { Spinner } from '@/components/common/Spinner';
import { Table, type TableColumn } from '@/components/common/Table';
import { StatusBadge } from '@/components/quotation/StatusBadge';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/useToast';
import { describeError } from '@/services/api/errors';
import {
  listQuotations,
  updateQuotationStatus,
  type QuotationSummary,
} from '@/services/quotation/quotation-service';
import { formatDisplayDate } from '@/utils/format-date';
import { formatSar, halalas } from '@shared/money';
import { QUOTATION_STATUSES, type QuotationStatus } from '@shared/types';

export default function QuotationsPage() {
  const { state } = useAuth();
  const { show } = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | QuotationStatus>('all');

  const token = state.status === 'authenticated' ? state.token : null;

  const quotations = useQuery({
    queryKey: ['quotations'],
    queryFn: () => listQuotations(token ?? ''),
    enabled: token !== null,
  });

  const statusMutation = useMutation({
    mutationFn: ({
      quotationNumber,
      status,
    }: {
      quotationNumber: string;
      status: QuotationStatus;
    }) => updateQuotationStatus(quotationNumber, status, token ?? ''),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['quotations'] });
      show({ variant: 'success', message: 'Status updated.' });
    },
    onError: (error: unknown) => {
      show({ variant: 'error', message: describeError(error) });
    },
  });

  const rows = useMemo(() => {
    const all = quotations.data ?? [];
    const term = search.trim().toLowerCase();

    return all.filter((row) => {
      if (statusFilter !== 'all' && row.status !== statusFilter) return false;
      if (term.length === 0) return true;
      return (
        row.quotationNumber.toLowerCase().includes(term) ||
        row.clientName.toLowerCase().includes(term) ||
        row.companyName.toLowerCase().includes(term) ||
        row.quotationFor.toLowerCase().includes(term)
      );
    });
  }, [quotations.data, search, statusFilter]);

  const columns: Array<TableColumn<QuotationSummary>> = [
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
    { key: 'client', header: 'Client', render: (row) => row.clientName },
    { key: 'company', header: 'Company', render: (row) => row.companyName },
    { key: 'for', header: 'Quotation For', render: (row) => row.quotationFor },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      render: (row) => formatSar(halalas(row.grandTotal)),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) =>
        row.quotationNumber.length === 0 ? (
          <StatusBadge status={row.status} />
        ) : (
          <Select
            aria-label={`Status for ${row.quotationNumber}`}
            value={row.status}
            options={QUOTATION_STATUSES.map((status) => ({ value: status, label: status }))}
            onChange={(event) => {
              statusMutation.mutate({
                quotationNumber: row.quotationNumber,
                status: event.target.value as QuotationStatus,
              });
            }}
            className="h-8 w-32 text-xs"
          />
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Quotations"
        description="All quotations issued by the company."
        actions={
          <Link to="/quotations/new" className={buttonClasses()}>
            New Quotation
          </Link>
        }
      />

      <Card
        bodyClassName="p-0"
        actions={
          <div className="flex gap-2">
            <Input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
              }}
              placeholder="Search"
              aria-label="Search quotations"
              className="h-8 w-48 text-xs"
            />
            <Select
              value={statusFilter}
              aria-label="Filter by status"
              options={[
                { value: 'all', label: 'All statuses' },
                ...QUOTATION_STATUSES.map((status) => ({ value: status, label: status })),
              ]}
              onChange={(event) => {
                setStatusFilter(event.target.value as 'all' | QuotationStatus);
              }}
              className="h-8 w-36 text-xs"
            />
          </div>
        }
        title="Quotation register"
      >
        {quotations.isPending ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" label="Loading quotations" />
          </div>
        ) : quotations.isError ? (
          <div className="px-5 py-6">
            <p className="text-brand-red text-sm">{describeError(quotations.error)}</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="px-5 py-6">
            <EmptyState
              title={
                (quotations.data ?? []).length === 0
                  ? 'No quotations yet'
                  : 'No quotations match your filters'
              }
              description={
                (quotations.data ?? []).length === 0
                  ? 'Quotations appear here once they are created. The system starts empty by design.'
                  : 'Try a different search term or status.'
              }
              {...((quotations.data ?? []).length === 0
                ? {
                    action: (
                      <Link to="/quotations/new" className={buttonClasses()}>
                        Create the first quotation
                      </Link>
                    ),
                  }
                : {})}
            />
          </div>
        ) : (
          <Table columns={columns} rows={rows} rowKey={(row) => row.draftId} caption="Quotations" />
        )}
      </Card>
    </>
  );
}
