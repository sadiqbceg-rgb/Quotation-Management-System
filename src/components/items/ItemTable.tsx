import { useCallback } from 'react';

import { formatQuantity, formatSar, halalasToSar } from '@shared/money';
import type { Halalas, Milli } from '@shared/money';
import type { ItemCategory, PricingMode } from '@shared/types';
import { TEXT_LIMITS } from '@shared/validation-rules';
import { CATEGORY_COLUMNS } from '@/config/units';
import type { CategoryGroup, EditorLineItem } from '@/hooks/useLineItems';
import {
  parsePrice,
  parseQuantity,
  priceParseMessage,
  quantityParseMessage,
} from '@/utils/parse-decimal';
import { Button } from '@/components/common/Button';
import { DecimalInput } from './DecimalInput';
import { UnitSelect } from './UnitSelect';
import { CategorySummaryLine } from './CategorySummaryLine';

export interface ItemTableProps {
  group: CategoryGroup;
  pricingMode: PricingMode;
  /** PRD §17 — resolved once for the whole quotation, applied identically here. */
  showRemarksColumn: boolean;
  onUpdate: (id: string, patch: Partial<Omit<EditorLineItem, 'id' | 'amount'>>) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onAdd: (category: ItemCategory) => void;
  onRemoveCategory: (category: ItemCategory) => void;
  atItemLimit: boolean;
}

const formatQuantityText = (value: Milli): string => (value === 0 ? '' : formatQuantity(value));

const formatPriceText = (value: Halalas): string =>
  value === 0 ? '' : halalasToSar(value).toFixed(2);

export function ItemTable({
  group,
  pricingMode,
  showRemarksColumn,
  onUpdate,
  onRemove,
  onMove,
  onAdd,
  onRemoveCategory,
  atItemLimit,
}: ItemTableProps) {
  const columns = CATEGORY_COLUMNS[group.category];
  const showAmount = pricingMode === 'amount';

  const handleAdd = useCallback(() => {
    onAdd(group.category);
  }, [onAdd, group.category]);

  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
        <h3 className="text-sm font-semibold text-slate-900">{group.category}</h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            onRemoveCategory(group.category);
          }}
        >
          Remove {group.category}
        </Button>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{group.category} items</caption>
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left">
              <th scope="col" className="w-14 px-3 py-2 font-semibold text-slate-700">
                Sl. No.
              </th>
              <th scope="col" className="px-3 py-2 font-semibold text-slate-700">
                {columns.description}
              </th>
              <th scope="col" className="w-28 px-3 py-2 text-right font-semibold text-slate-700">
                Qty
              </th>
              <th scope="col" className="w-36 px-3 py-2 font-semibold text-slate-700">
                Unit
              </th>
              <th scope="col" className="w-32 px-3 py-2 text-right font-semibold text-slate-700">
                {columns.price}
              </th>
              {showAmount ? (
                <th scope="col" className="w-32 px-3 py-2 text-right font-semibold text-slate-700">
                  Amount
                </th>
              ) : null}
              {showRemarksColumn ? (
                <th scope="col" className="px-3 py-2 font-semibold text-slate-700">
                  Remarks
                </th>
              ) : null}
              <th scope="col" className="w-28 px-3 py-2">
                <span className="sr-only">Row actions</span>
              </th>
            </tr>
          </thead>

          <tbody>
            {group.items.map((item, index) => (
              <tr key={item.id} className="border-b border-slate-100 align-top last:border-b-0">
                {/* Sl. No. restarts at 1 per category and follows reordering. */}
                <td className="px-3 py-2 text-slate-500 tabular-nums">{index + 1}</td>

                <td className="px-3 py-2">
                  <input
                    type="text"
                    aria-label={`${columns.description} ${String(index + 1)}`}
                    value={item.description}
                    maxLength={TEXT_LIMITS.itemDescription.max}
                    onChange={(event) => {
                      onUpdate(item.id, { description: event.target.value });
                    }}
                    className="focus:border-brand-navy focus:ring-brand-navy/20 h-9 w-full rounded-md border border-slate-300 px-2 text-sm focus:ring-2 focus:outline-none"
                  />
                </td>

                <td className="px-3 py-2">
                  <DecimalInput<Milli>
                    label={`Quantity ${String(index + 1)}`}
                    value={item.quantity}
                    format={formatQuantityText}
                    parse={parseQuantity}
                    describe={quantityParseMessage}
                    onChange={(quantity) => {
                      onUpdate(item.id, { quantity });
                    }}
                  />
                </td>

                <td className="px-3 py-2">
                  <UnitSelect
                    category={group.category}
                    value={item.unit}
                    onChange={(unit) => {
                      onUpdate(item.id, { unit });
                    }}
                  />
                </td>

                <td className="px-3 py-2">
                  <DecimalInput<Halalas>
                    label={`${columns.price} ${String(index + 1)}`}
                    value={item.unitPrice}
                    format={formatPriceText}
                    parse={parsePrice}
                    describe={priceParseMessage}
                    onChange={(unitPrice) => {
                      onUpdate(item.id, { unitPrice });
                    }}
                  />
                </td>

                {showAmount ? (
                  /*
                   * Derived, never editable. A user-entered amount could
                   * disagree with quantity x price, and the printed column
                   * would stop adding up to the printed total.
                   */
                  <td
                    className="px-3 py-2 text-right font-medium text-slate-900 tabular-nums"
                    data-testid={`amount-${group.category}-${String(index)}`}
                  >
                    {formatSar(item.amount)}
                  </td>
                ) : null}

                {showRemarksColumn ? (
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      aria-label={`Remarks ${String(index + 1)}`}
                      value={item.remarks}
                      maxLength={TEXT_LIMITS.remarks.max}
                      onChange={(event) => {
                        onUpdate(item.id, { remarks: event.target.value });
                      }}
                      className="focus:border-brand-navy focus:ring-brand-navy/20 h-9 w-full rounded-md border border-slate-300 px-2 text-sm focus:ring-2 focus:outline-none"
                    />
                  </td>
                ) : null}

                <td className="px-3 py-2">
                  <div className="flex justify-end gap-1">
                    <button
                      type="button"
                      aria-label={`Move row ${String(index + 1)} up`}
                      disabled={index === 0}
                      onClick={() => {
                        onMove(item.id, -1);
                      }}
                      className="rounded px-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`Move row ${String(index + 1)} down`}
                      disabled={index === group.items.length - 1}
                      onClick={() => {
                        onMove(item.id, 1);
                      }}
                      className="rounded px-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete row ${String(index + 1)}`}
                      onClick={() => {
                        onRemove(item.id);
                      }}
                      className="hover:text-brand-red rounded px-1.5 text-slate-500 hover:bg-red-50"
                    >
                      ×
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={handleAdd} disabled={atItemLimit}>
            Add row
          </Button>
          {atItemLimit ? <span className="text-xs text-slate-500">Item limit reached.</span> : null}
        </div>

        <div className="flex items-center gap-5">
          <CategorySummaryLine category={group.category} quantityTotal={group.quantityTotal} />
          {showAmount ? (
            <span className="text-sm text-slate-700" data-testid={`subtotal-${group.category}`}>
              <span className="text-slate-500">{group.category} subtotal:</span>{' '}
              <span className="font-semibold tabular-nums">{formatSar(group.subtotal)}</span>
            </span>
          ) : null}
        </div>
      </footer>
    </section>
  );
}
