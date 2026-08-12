import { formatQuantity, type Milli } from '@shared/money';
import type { ItemCategory } from '@shared/types';
import { CATEGORY_COLUMNS } from '@/config/units';

export interface CategorySummaryLineProps {
  category: ItemCategory;
  quantityTotal: Milli;
}

/**
 * The per-category headcount line.
 *
 * The approved quotation prints "Total Manpower: 41 Persons" under the manpower
 * table (reference/quotation-sample.pdf page 1). It is auto-computed from the
 * quantities rather than typed, so it can never disagree with the table above
 * it. Only Manpower shows one by default — see CATEGORY_COLUMNS.
 */
export function CategorySummaryLine({ category, quantityTotal }: CategorySummaryLineProps) {
  const config = CATEGORY_COLUMNS[category];

  if (!config.showSummaryLine || quantityTotal === 0) {
    return null;
  }

  return (
    <span className="text-sm text-slate-700" data-testid={`summary-${category}`}>
      <span className="text-slate-500">Total {category}:</span>{' '}
      <span className="font-semibold tabular-nums">
        {formatQuantity(quantityTotal)} {config.summaryNoun}
      </span>
    </span>
  );
}
