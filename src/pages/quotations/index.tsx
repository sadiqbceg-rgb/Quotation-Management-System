import { Link } from 'react-router-dom';

import { PageHeader } from '@/components/common/PageHeader';
import { buttonClasses } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { EmptyState } from '@/components/common/EmptyState';
import { Spinner } from '@/components/common/Spinner';
import { QuotationFilters } from '@/components/quotation/QuotationFilters';
import { QuotationTable } from '@/components/quotation/QuotationTable';
import { useQuotationTracking } from '@/hooks/useQuotationTracking';
import { describeError } from '@/services/api/errors';

/**
 * The quotation register (PRD §31).
 *
 * Backed by the `Quotations` tracking sheet, which is the V1 record system —
 * so a Status someone changed in the spreadsheet appears here, and a change
 * made here appears there. Drafts that have not been saved to Drive have no
 * register row and are listed from the record store so they are not lost.
 */
export default function QuotationsPage() {
  const tracking = useQuotationTracking();

  return (
    <>
      <PageHeader
        title="Quotations"
        description="All quotations issued by the company, from the tracking sheet."
        actions={
          <Link to="/quotations/new" className={buttonClasses()}>
            New Quotation
          </Link>
        }
      />

      <Card
        bodyClassName="p-0"
        actions={
          <QuotationFilters
            search={tracking.filters.search}
            status={tracking.filters.status}
            onSearchChange={tracking.setSearch}
            onStatusChange={tracking.setStatus}
          />
        }
        title="Quotation register"
      >
        {tracking.isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" label="Loading quotations" />
          </div>
        ) : tracking.isError ? (
          <div className="px-5 py-6">
            <p className="text-brand-red text-sm">{describeError(tracking.error)}</p>
          </div>
        ) : tracking.rows.length === 0 ? (
          <div className="px-5 py-6">
            <EmptyState
              title={
                tracking.all.length === 0 ? 'No quotations yet' : 'No quotations match your filters'
              }
              description={
                tracking.all.length === 0
                  ? 'Quotations appear here once they are created. The system starts empty by design.'
                  : 'Try a different search term or status.'
              }
              {...(tracking.all.length === 0
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
          <QuotationTable
            rows={tracking.rows}
            isChangingStatus={tracking.isChangingStatus}
            onStatusChange={tracking.changeStatus}
          />
        )}
      </Card>
    </>
  );
}
