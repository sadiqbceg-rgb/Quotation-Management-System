import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { EmptyState } from '@/components/common/EmptyState';
import { ITEM_CATEGORIES, type ItemCategory, type PricingMode, type Totals } from '@shared/types';
import type { UseLineItemsResult } from '@/hooks/useLineItems';
import { ItemTable } from './ItemTable';
import { TotalsPanel } from './TotalsPanel';

export interface QuotationItemsSectionProps {
  lineItems: UseLineItemsResult;
  totals: Totals;
  pricingMode: PricingMode;
}

/**
 * The Quotation Items section.
 *
 * PRD §13: the user picks a category before adding items, multiple categories
 * may appear in one quotation, and each gets its own table.
 */
export function QuotationItemsSection({
  lineItems,
  totals,
  pricingMode,
}: QuotationItemsSectionProps) {
  const available = ITEM_CATEGORIES.filter((category) => !lineItems.categories.includes(category));

  return (
    <Card
      title="Quotation Items"
      description="Add a category, then its rows. Amounts and totals update as you type."
      actions={
        <div className="flex flex-wrap gap-2">
          {available.map((category: ItemCategory) => (
            <Button
              key={category}
              variant="secondary"
              size="sm"
              onClick={() => {
                lineItems.addCategory(category);
              }}
            >
              + {category}
            </Button>
          ))}
        </div>
      }
    >
      {lineItems.categories.length === 0 ? (
        <EmptyState
          title="No items yet"
          description="Add Manpower, Equipment or Materials to begin. Each category gets its own table on the quotation."
        />
      ) : (
        <div className="flex flex-col gap-5">
          {lineItems.groups.map((group) => (
            <ItemTable
              key={group.category}
              group={group}
              pricingMode={pricingMode}
              showRemarksColumn={lineItems.showRemarksColumn}
              onUpdate={lineItems.updateItem}
              onRemove={lineItems.removeItem}
              onMove={lineItems.moveItem}
              onAdd={lineItems.addItem}
              onRemoveCategory={lineItems.removeCategory}
              atItemLimit={lineItems.atItemLimit}
            />
          ))}

          <div className="border-t border-slate-200 pt-4">
            <TotalsPanel totals={totals} pricingMode={pricingMode} />
          </div>
        </div>
      )}
    </Card>
  );
}
