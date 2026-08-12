import { formatBasisPoints, formatSar } from '@shared/money';
import { ITEM_CATEGORIES, type PricingMode, type Totals } from '@shared/types';
import { cn } from '@/utils/cn';

export interface TotalsPanelProps {
  totals: Totals;
  pricingMode: PricingMode;
}

/**
 * The totals block.
 *
 * Hidden entirely in `rate-only` mode: the approved quotation quotes hourly
 * rates and carries no totals block at all, handling VAT as a term instead
 * (IMPLEMENTATION_PLAN.md §26 UR-04). PRD §19 mandates totals, so both are
 * supported and the mode decides.
 */
export function TotalsPanel({ totals, pricingMode }: TotalsPanelProps) {
  if (pricingMode === 'rate-only') {
    return (
      <p className="text-sm text-slate-500">
        Rate-only quotation — no amounts or totals are printed, matching the approved company
        format. VAT is stated in the Terms &amp; Conditions instead.
      </p>
    );
  }

  const categoryRows = ITEM_CATEGORIES.filter(
    (category) => totals.categorySubtotals[category] !== undefined,
  );

  const hasDiscount = totals.discountAmount > 0;

  return (
    <dl className="ml-auto w-full max-w-sm text-sm" data-testid="totals-panel">
      {categoryRows.map((category) => (
        <Row
          key={category}
          label={`${category} subtotal`}
          value={formatSar(totals.categorySubtotals[category] ?? (0 as Totals['subtotal']))}
          muted
        />
      ))}

      <Row label="Subtotal" value={formatSar(totals.subtotal)} />

      {hasDiscount ? (
        <Row
          label={`Discount${
            totals.discountRateBasisPoints === undefined
              ? ''
              : ` (${formatBasisPoints(totals.discountRateBasisPoints)})`
          }`}
          value={`− ${formatSar(totals.discountAmount)}`}
        />
      ) : null}

      {hasDiscount ? (
        <Row label="Taxable base" value={formatSar(totals.taxableBase)} muted />
      ) : null}

      {totals.vatRateBasisPoints > 0 ? (
        <Row
          label={`VAT (${formatBasisPoints(totals.vatRateBasisPoints)})`}
          value={formatSar(totals.vatAmount)}
        />
      ) : null}

      <div className="mt-1 flex items-baseline justify-between border-t-2 border-slate-300 pt-2">
        <dt className="font-semibold text-slate-900">Grand Total</dt>
        <dd
          className="text-base font-semibold text-slate-900 tabular-nums"
          data-testid="grand-total"
        >
          {formatSar(totals.grandTotal)}
        </dd>
      </div>
    </dl>
  );
}

function Row({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between py-1">
      <dt className={cn(muted ? 'text-slate-500' : 'text-slate-700')}>{label}</dt>
      <dd className={cn('tabular-nums', muted ? 'text-slate-500' : 'text-slate-900')}>{value}</dd>
    </div>
  );
}
