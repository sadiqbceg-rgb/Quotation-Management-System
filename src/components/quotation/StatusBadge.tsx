import type { QuotationStatus } from '@shared/types';
import { cn } from '@/utils/cn';

const STYLES: Record<QuotationStatus, string> = {
  Pending: 'border-amber-200 bg-amber-50 text-amber-800',
  Approved: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  Rejected: 'border-red-200 bg-red-50 text-red-800',
};

export function StatusBadge({ status }: { status: QuotationStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
        STYLES[status],
      )}
    >
      {status}
    </span>
  );
}
