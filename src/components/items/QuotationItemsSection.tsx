import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { Checkbox } from '@/components/common/Checkbox';
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
        <div className="flex flex-wrap items-center gap-3">
          {lineItems.categories.length === 0 ? null : (
            /*
             * PRD §45.11 — "Add optional remarks".
             *
             * The column has to be switchable, because the printed rule (§17:
             * print Remarks only when an item has one) cannot also govern the
             * editor. When it did, the column appeared only once an item had a
             * remark and the only way to give an item a remark was to type in
             * that column — so the first remark could never be entered.
             */
            <Checkbox
              label="Remarks column"
              checked={lineItems.remarksColumnVisible}
              onChange={(event) => {
                lineItems.setRemarksColumnVisible(event.target.checked);
              }}
            />
          )}
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
              showRemarksColumn={lineItems.remarksColumnVisible}
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
