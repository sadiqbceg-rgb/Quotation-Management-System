import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/common/PageHeader';
import { Card } from '@/components/common/Card';
import { buttonClasses } from '@/components/common/Button';
import { Spinner } from '@/components/common/Spinner';
import { checkHealth } from '@/services/api/health';
import { AppError, describeError } from '@/services/api/errors';
import { useQuotationTracking } from '@/hooks/useQuotationTracking';
import { formatDisplayDate } from '@/utils/format-date';
import { formatSar, halalas } from '@shared/money';

/**
 * Dashboard.
 *
 * PRD §7 says the dashboard may initially remain simple, because Google Sheets
 * is the primary tracking mechanism in V1 and PRD §32 explicitly defers the
 * analytics dashboard to Phase 2.
 *
 * This dashboard shows:
 * - Quick Actions for common tasks
 * - Backend connection status
 * - Quotation overview metrics
 * - Recent quotations with links to preview
 */
export default function DashboardPage() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: checkHealth,
    retry: 1,
    staleTime: 60_000,
  });

  const tracking = useQuotationTracking();

  // Calculate metrics from existing tracking data
  const thisYear = new Date().getFullYear();
  const thisYearQuotations = tracking.all.filter(
    (q) => q.quotationDate.startsWith(String(thisYear))
  );
  const recentQuotations = tracking.all.slice(0, 5);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Create and manage company quotations."
        actions={
          <Link to="/quotations/new" className={buttonClasses()}>
            New Quotation
          </Link>
        }
      />

      {/* Quick Actions */}
      <Card title="Quick Actions" description="Common tasks">
        <div className="flex flex-wrap gap-3">
          <Link to="/quotations/new" className={buttonClasses('primary')}>
            New Quotation
          </Link>
          <Link to="/quotations" className={buttonClasses('secondary')}>
            View All Quotations
          </Link>
        </div>
      </Card>

      {/* Backend Connection and Quotation Overview */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Backend connection" description="Google Apps Script deployment status">
          {health.isPending ? (
            <p className="flex items-center gap-2 text-sm text-slate-500">
              <Spinner size="sm" /> Checking…
            </p>
          ) : health.isError ? (
            <p className="text-brand-red text-sm">
              {describeError(health.error)}
              {health.error instanceof AppError ? (
                <span className="mt-1 block font-mono text-xs text-slate-500">
                  {health.error.code}
                </span>
              ) : null}
            </p>
          ) : (
            <div className="text-sm">
              <p className="text-emerald-700 font-medium">Connected.</p>
              {health.data.configured ? (
                <p className="mt-1 text-slate-500">All required settings are configured.</p>
              ) : (
                <p className="mt-1 text-amber-700">
                  Missing configuration: {health.data.missing.join(', ')}. Contact an administrator.
                </p>
              )}
            </div>
          )}
        </Card>

        <Card title="Quotation Overview" description="Current status summary">
          {tracking.isLoading ? (
            <p className="flex items-center gap-2 text-sm text-slate-500">
              <Spinner size="sm" /> Loading…
            </p>
          ) : tracking.isError ? (
            <p className="text-brand-red text-sm">{describeError(tracking.error)}</p>
          ) : (
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-slate-600 text-sm">Total Quotations</span>
                <span className="text-2xl font-semibold text-slate-900">{tracking.all.length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-600 text-sm">This Year ({thisYear})</span>
                <span className="text-2xl font-semibold text-slate-900">
                  {thisYearQuotations.length}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-600 text-sm">Pending</span>
                <span className="text-2xl font-semibold text-amber-700">
                  {tracking.all.filter((q) => q.status === 'Pending').length}
                </span>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Recent Quotations */}
      {!tracking.isLoading && !tracking.isError && recentQuotations.length > 0 && (
        <Card title="Recent Quotations" description="Last quotations created">
          <div className="space-y-2">
            {recentQuotations.map((q) => (
              <div
                key={q.draftId}
                className="flex items-center justify-between gap-4 rounded-md border border-slate-100 p-3 hover:bg-slate-50 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {q.draftId.length > 0 ? (
                      <Link
                        to={`/quotations/${q.draftId}/preview`}
                        className="font-medium text-brand-navy underline underline-offset-2 truncate hover:no-underline"
                        aria-label={
                          q.quotationNumber.length > 0
                            ? `Preview quotation ${q.quotationNumber}`
                            : 'Preview draft quotation'
                        }
                      >
                        {q.quotationNumber.length > 0 ? (
                          <span className="tabular-nums">{q.quotationNumber}</span>
                        ) : (
                          <span className="text-slate-400 italic">Draft</span>
                        )}
                      </Link>
                    ) : (
                      <span className="font-medium text-slate-900 truncate">
                        {q.quotationNumber.length > 0 ? (
                          <span className="tabular-nums">{q.quotationNumber}</span>
                        ) : (
                          <span className="text-slate-400 italic">Draft</span>
                        )}
                      </span>
                    )}
                    <span className="text-slate-400">•</span>
                    <span className="text-slate-600 text-sm truncate">{q.clientName}</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1 truncate">
                    {q.quotationFor}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <p className="text-sm font-medium text-slate-900">
                      {formatSar(halalas(q.grandTotal))}
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatDisplayDate(q.quotationDate)}
                    </p>
                  </div>
                  <div
                    className={`px-2.5 py-1 rounded text-xs font-medium whitespace-nowrap ${
                      q.status === 'Pending'
                        ? 'bg-amber-50 text-amber-700'
                        : q.status === 'Approved'
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-red-50 text-red-700'
                    }`}
                  >
                    {q.status}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}
