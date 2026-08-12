import { useCallback, useMemo, useState } from 'react';

import { calculateLineAmount } from '@shared/totals';
import { halalas, milli, type Halalas, type Milli } from '@shared/money';
import { ITEM_CATEGORIES, type ItemCategory } from '@shared/types';
import { QUOTATION_LIMITS } from '@shared/validation-rules';
import { unitsForCategory } from '@/config/units';
import { newLineItemId } from '@/utils/uuid';

/**
 * A line item as held in the editor.
 *
 * `amount` is DERIVED and recomputed on every change — never user-entered and
 * never trusted from storage. PRD §18: "Quantity x Unit Price = Amount".
 */
export interface EditorLineItem {
  id: string;
  category: ItemCategory;
  description: string;
  quantity: Milli;
  unit: string;
  unitPrice: Halalas;
  amount: Halalas;
  remarks: string;
}

export interface CategoryGroup {
  category: ItemCategory;
  items: EditorLineItem[];
  subtotal: Halalas;
  /** Sum of quantities, for the "Total Manpower: 41 Persons" line. */
  quantityTotal: Milli;
}

function withAmount(item: Omit<EditorLineItem, 'amount'>): EditorLineItem {
  return { ...item, amount: calculateLineAmount(item.quantity, item.unitPrice) };
}

function blankItem(category: ItemCategory): EditorLineItem {
  return withAmount({
    id: newLineItemId(),
    category,
    description: '',
    quantity: milli(0),
    // Default to the category's first seeded unit so the row starts valid-ish.
    unit: unitsForCategory(category)[0] ?? '',
    unitPrice: halalas(0),
    remarks: '',
  });
}

export interface UseLineItemsResult {
  items: EditorLineItem[];
  /** Only the categories the user has actually added, in PRD order. */
  categories: ItemCategory[];
  groups: CategoryGroup[];
  /** PRD §17: the Remarks column appears only if some item has a remark. */
  showRemarksColumn: boolean;
  addCategory: (category: ItemCategory) => void;
  removeCategory: (category: ItemCategory) => void;
  addItem: (category: ItemCategory) => void;
  updateItem: (id: string, patch: Partial<Omit<EditorLineItem, 'id' | 'amount'>>) => void;
  removeItem: (id: string) => void;
  moveItem: (id: string, direction: -1 | 1) => void;
  reset: (items: EditorLineItem[]) => void;
  atItemLimit: boolean;
}

/**
 * Line-item state for the quotation editor.
 *
 * Items live in one flat array with a stable client id each, and are grouped
 * for display. A flat array keeps reordering and the item-count ceiling simple,
 * and the stable id means a reorder does not remount the inputs and steal focus
 * mid-typing.
 */
export function useLineItems(initial: EditorLineItem[] = []): UseLineItemsResult {
  const [items, setItems] = useState<EditorLineItem[]>(initial);
  const [categories, setCategories] = useState<ItemCategory[]>(() =>
    ITEM_CATEGORIES.filter((category) => initial.some((item) => item.category === category)),
  );

  const addCategory = useCallback((category: ItemCategory) => {
    setCategories((current) => (current.includes(category) ? current : [...current, category]));
    setItems((current) =>
      current.some((item) => item.category === category)
        ? current
        : [...current, blankItem(category)],
    );
  }, []);

  const removeCategory = useCallback((category: ItemCategory) => {
    setCategories((current) => current.filter((entry) => entry !== category));
    setItems((current) => current.filter((item) => item.category !== category));
  }, []);

  const addItem = useCallback((category: ItemCategory) => {
    setItems((current) =>
      current.length >= QUOTATION_LIMITS.maxLineItems ? current : [...current, blankItem(category)],
    );
  }, []);

  const updateItem = useCallback(
    (id: string, patch: Partial<Omit<EditorLineItem, 'id' | 'amount'>>) => {
      setItems((current) =>
        current.map((item) => (item.id === id ? withAmount({ ...item, ...patch }) : item)),
      );
    },
    [],
  );

  const removeItem = useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  /** Move within the item's own category, so a row never jumps table. */
  const moveItem = useCallback((id: string, direction: -1 | 1) => {
    setItems((current) => {
      const item = current.find((entry) => entry.id === id);
      if (item === undefined) return current;

      const sameCategory = current.filter((entry) => entry.category === item.category);
      const position = sameCategory.findIndex((entry) => entry.id === id);
      const target = position + direction;
      if (target < 0 || target >= sameCategory.length) return current;

      const swapWith = sameCategory[target];
      if (swapWith === undefined) return current;

      const first = current.indexOf(item);
      const second = current.indexOf(swapWith);

      const next = [...current];
      next[first] = swapWith;
      next[second] = item;
      return next;
    });
  }, []);

  const reset = useCallback((next: EditorLineItem[]) => {
    setItems(next);
    setCategories(ITEM_CATEGORIES.filter((category) => next.some((i) => i.category === category)));
  }, []);

  const groups = useMemo<CategoryGroup[]>(
    () =>
      categories.map((category) => {
        const groupItems = items.filter((item) => item.category === category);
        let subtotal = 0;
        let quantityTotal = 0;

        for (const item of groupItems) {
          subtotal += item.amount;
          quantityTotal += item.quantity;
        }

        return {
          category,
          items: groupItems,
          subtotal: halalas(subtotal),
          quantityTotal: milli(quantityTotal),
        };
      }),
    [categories, items],
  );

  const showRemarksColumn = useMemo(
    () => items.some((item) => item.remarks.trim().length > 0),
    [items],
  );

  return {
    items,
    categories,
    groups,
    showRemarksColumn,
    addCategory,
    removeCategory,
    addItem,
    updateItem,
    removeItem,
    moveItem,
    reset,
    atItemLimit: items.length >= QUOTATION_LIMITS.maxLineItems,
  };
}
