/**
 * Unit options per category.
 *
 * PRD §16 is explicit that "the exact units must remain configurable", so these
 * are data rather than a hard-coded union type: a new unit is a list entry, not
 * a type change and a redeploy. The seed lists come from PRD §14–§16.
 *
 * A user may also enter a custom unit, which applies to that quotation
 * immediately. It is deliberately NOT promoted into the master list on its own
 * — a typo would otherwise become permanent company configuration.
 */

import { UNIT_OPTIONS } from '@shared/validation-rules';
import type { ItemCategory } from '@shared/types';

export const CUSTOM_UNIT_VALUE = '__custom__';

export function unitsForCategory(category: ItemCategory): readonly string[] {
  return UNIT_OPTIONS[category];
}

/** True when the unit is not one of the category's seeded options. */
export function isCustomUnit(category: ItemCategory, unit: string): boolean {
  return unit.length > 0 && !unitsForCategory(category).includes(unit);
}

/**
 * Column headings per category, taken verbatim from PRD §14–§16.
 *
 * The description and price headings genuinely differ between categories
 * ("Designation" vs "Equipment Description"; "Unit Price" vs "Rate"), so they
 * are declared here rather than generalised into one label that matches none of
 * the three.
 */
export interface CategoryColumns {
  description: string;
  price: string;
  /** Noun used in the category summary line, e.g. "41 Persons". */
  summaryNoun: string;
  /** Whether a summary line is printed for this category at all. */
  showSummaryLine: boolean;
}

export const CATEGORY_COLUMNS: Readonly<Record<ItemCategory, CategoryColumns>> = {
  Manpower: {
    description: 'Designation',
    price: 'Unit Price',
    // The approved quotation prints "Total Manpower: 41 Persons".
    summaryNoun: 'Persons',
    showSummaryLine: true,
  },
  Equipment: {
    description: 'Equipment Description',
    price: 'Rate',
    summaryNoun: 'Units',
    showSummaryLine: false,
  },
  Materials: {
    description: 'Material Description',
    price: 'Unit Price',
    summaryNoun: 'Items',
    showSummaryLine: false,
  },
};

export const CATEGORY_LABELS: Readonly<Record<ItemCategory, string>> = {
  Manpower: 'Manpower',
  Equipment: 'Equipment',
  Materials: 'Materials',
};
