import { COMPANY_IDENTITY } from '@/config/navigation';
import { Card } from '@/components/common/Card';

/**
 * Sign-in.
 *
 * The route exists so the shell is complete, but the form, the session and the
 * route guards belong to Phase 02. No credentials, no demo account and no
 * "test login" hint are rendered here — PRD §33 items 2 and 15.
 */
export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <p className="text-brand-navy text-lg font-semibold tracking-tight">
            {COMPANY_IDENTITY.shortName}
          </p>
          <p className="mt-1 text-sm text-slate-500">Quotation Management System</p>
        </div>

        <Card>
          <p className="text-sm text-slate-600">
            Sign-in is implemented in Phase 02 (Authentication).
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Accounts are created by an administrator. There is no self-registration.
          </p>
        </Card>
      </div>
    </div>
  );
}
