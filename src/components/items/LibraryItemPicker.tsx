import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { Modal } from '@/components/common/Modal';
import { Spinner } from '@/components/common/Spinner';
import { useAuth } from '@/hooks/useAuth';
import { messageOf } from '@/services/api/errors';
import { listItems, type CatalogItem } from '@/services/items/item-service';
import type { ItemCategory } from '@shared/types';

export interface LibraryItemPickerProps {
  /** Only this category's items are offered. */
  category: ItemCategory;
  /** Identifies the row in the accessible name, so every button is distinct. */
  rowLabel: string;
  /** Receives the description and unit. The item's ID is deliberately not passed. */
  onSelect: (choice: { description: string; unit: string }) => void;
}

/**
 * Fill one quotation row from the item library (PRD §40).
 *
 * ---------------------------------------------------------------------------
 * IT PREFILLS TWO FIELDS. THAT IS ALL.
 * ---------------------------------------------------------------------------
 * The description and the unit are copied into the row and the picker is done.
 * Quantity and price are always typed per quotation, because they are the whole
 * point of quoting — PRD §40 says so, and the Items page has always said so.
 *
 * NO ITEM ID TRAVELS WITH THE QUOTATION. `EditorLineItem` has no field for one
 * and the payload has none either, so:
 *
 *   - editing or deactivating a library item cannot change a quotation that
 *     already exists — there is no reference to follow;
 *   - a client cannot inject an item id to bypass validation, because the
 *     server never reads one. It validates the description, unit, quantity and
 *     price it was actually sent, exactly as it does for a hand-typed row.
 *
 * Every field stays editable afterwards. A one-off variation on a description
 * is normal and must not require editing the library record other quotations
 * draw from.
 */
export function LibraryItemPicker({ category, rowLabel, onSelect }: LibraryItemPickerProps) {
  const { state } = useAuth();
  const token = state.status === 'authenticated' ? state.token : null;

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const items = useQuery({
    queryKey: ['items', 'active'],
    // Active only: `listItems` defaults to it, so a deactivated item is never
    // offered on a new quotation.
    queryFn: () => listItems(token ?? ''),
    // Nothing is fetched until the picker is opened — PRD §35, opening the New
    // Quotation page must not do work of its own.
    enabled: token !== null && open,
  });

  const all = useMemo(() => items.data ?? [], [items.data]);
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return all.filter(
      (item: CatalogItem) =>
        item.category === category &&
        (needle.length === 0 || item.name.toLowerCase().includes(needle)),
    );
  }, [all, category, search]);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={`Choose a library item for ${rowLabel}`}
        onClick={() => {
          setOpen(true);
        }}
      >
        Library
      </Button>

      <Modal
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setSearch('');
        }}
        title={`Choose a ${category.toLowerCase()} item`}
        description="The description and unit are copied into the row and stay editable. Quantity and price are always entered per quotation."
      >
        <div className="flex flex-col gap-4">
          <Input
            type="search"
            placeholder="Search items"
            aria-label="Search items"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />

          {items.isPending ? (
            <div className="flex justify-center py-10">
              <Spinner size="lg" label="Loading items" />
            </div>
          ) : items.isError ? (
            <p role="alert" className="text-brand-red text-sm">
              {messageOf(items.error)}
            </p>
          ) : rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">
              {all.length === 0
                ? 'No items yet. Add them under Items / Services, or just type the description below.'
                : `No ${category.toLowerCase()} item matches “${search}”.`}
            </p>
          ) : (
            <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto">
              {rows.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="flex w-full items-baseline justify-between gap-3 rounded-md border border-slate-100 p-3 text-left transition-colors hover:bg-slate-50"
                    onClick={() => {
                      // The values only. The id stops here.
                      onSelect({ description: item.name, unit: item.defaultUnit });
                      setOpen(false);
                      setSearch('');
                    }}
                  >
                    <span className="font-medium text-slate-900">{item.name}</span>
                    <span className="shrink-0 text-xs text-slate-500">{item.defaultUnit}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>
    </>
  );
}
