import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/common/PageHeader';
import { Card } from '@/components/common/Card';
import { buttonClasses } from '@/components/common/Button';
import { Spinner } from '@/components/common/Spinner';
import { checkHealth } from '@/services/api/health';
import { AppError, describeError } from '@/services/api/errors';

/**
 * Dashboard.
 *
 * PRD §7 says the dashboard may initially remain simple, because Google Sheets
 * is the primary tracking mechanism in V1 and PRD §32 explicitly defers the
 * analytics dashboard to Phase 2. It shows no counts or totals here, because
 * showing fabricated figures would violate PRD §34 and there is no quotation
 * data source until Phase 11.
 */
export default function DashboardPage() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: checkHealth,
    retry: 1,
    staleTime: 60_000,
  });

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
              <p className="text-emerald-700">Connected.</p>
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

        <Card title="Getting started" description="What is available in this build">
          <ul className="list-inside list-disc space-y-1 text-sm text-slate-600">
            <li>Navigation and the application shell are in place.</li>
            <li>Sign-in arrives in Phase 02.</li>
            <li>Quotation creation and automatic numbering arrive in Phase 03.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
