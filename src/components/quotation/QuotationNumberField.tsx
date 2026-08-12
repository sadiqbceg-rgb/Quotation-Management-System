import { cn } from '@/utils/cn';

export interface QuotationNumberFieldProps {
  /** Null while the quotation is still a draft. */
  quotationNumber: string | null;
}

/**
 * The quotation number, read-only.
 *
 * Deliberately NOT an input. PRD §9 and IMPLEMENTATION_PLAN.md §7.3 require the
 * number to be issued by the backend and never typed by a user, so there is no
 * editable control here at all — not a disabled input, which could be re-enabled
 * from devtools and would suggest the value is the client's to choose.
 *
 * A test asserts no form control is rendered.
 */
export function QuotationNumberField({ quotationNumber }: QuotationNumberFieldProps) {
  const assigned = quotationNumber !== null && quotationNumber.length > 0;

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-slate-700">Quotation No.</span>
      <output
        data-testid="quotation-number"
        className={cn(
          'flex h-10 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-sm',
          assigned ? 'font-medium text-slate-900 tabular-nums' : 'text-slate-500 italic',
        )}
      >
        {assigned ? quotationNumber : 'Will be assigned when you save'}
      </output>
      <p className="text-xs text-slate-500">
        {assigned
          ? 'Issued by the system. It never changes, even when the quotation is edited.'
          : 'Generated automatically on save — it cannot be entered manually.'}
      </p>
    </div>
  );
}
