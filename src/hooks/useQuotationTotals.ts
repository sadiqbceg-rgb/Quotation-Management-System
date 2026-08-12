import { useMemo } from 'react';

import { calculateTotals, type TotalsInput } from '@shared/totals';
import type { Totals } from '@shared/types';
import type { EditorLineItem } from './useLineItems';

export interface UseQuotationTotalsInput {
  items: readonly EditorLineItem[];
  vatEnabled: boolean;
  vatRatePercent: number;
  discountEnabled: boolean;
  discountRatePercent: number;
}

/**
 * Live quotation totals.
 *
 * Computed by the SAME `shared/totals.ts` the backend uses to re-verify the
 * submission (IMPLEMENTATION_PLAN.md §8.6). Reimplementing the arithmetic here
 * for display would guarantee a TOTALS_MISMATCH the first time the two drifted.
 */
export function useQuotationTotals(input: UseQuotationTotalsInput): Totals {
  const { items, vatEnabled, vatRatePercent, discountEnabled, discountRatePercent } = input;

  return useMemo(() => {
    const totalsInput: TotalsInput = {
      lines: items.map((item) => ({
        category: item.category,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      })),
      vatRateBasisPoints: vatEnabled ? Math.round(vatRatePercent * 100) : 0,
      discountRateBasisPoints: discountEnabled ? Math.round(discountRatePercent * 100) : undefined,
    };

    return calculateTotals(totalsInput);
  }, [items, vatEnabled, vatRatePercent, discountEnabled, discountRatePercent]);
}
