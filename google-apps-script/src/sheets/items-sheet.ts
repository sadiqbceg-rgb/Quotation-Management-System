/**
 * The `Items` sheet — the reusable manpower / equipment / materials library.
 *
 * See PRD §40. Selecting a library item prefills a row's description and unit;
 * quantity and price are always entered per quotation, because they are the
 * whole point of quoting.
 *
 * The sheet ships EMPTY. The example names in PRD §40 (Carpenter, Excavator,
 * Cement …) illustrate the shape and are not seed data — inserting them would
 * violate PRD §34's no-dummy-data rule and put invented rates in front of staff.
 */

import { ITEM_CATEGORIES, type ItemCategory } from '@shared/types';
import {
  appendRow,
  asBoolean,
  asText,
  findRow,
  getOrCreateSheet,
  readRows,
  setCell,
} from './sheet-access';

export const ITEMS_SHEET_NAME = 'Items';

export const ITEMS_HEADERS = [
  'ID',
  'Category',
  'Name',
  'Default Unit',
  'Active',
  'Created At',
  'Updated At',
] as const;

const COLUMN = {
  id: 0,
  category: 1,
  name: 2,
  defaultUnit: 3,
  active: 4,
  createdAt: 5,
  updatedAt: 6,
} as const;

export interface CatalogItemRecord {
  id: string;
  category: ItemCategory;
  name: string;
  defaultUnit: string;
  active: boolean;
  rowNumber: number;
}

function sheet(): GoogleAppsScript.Spreadsheet.Sheet {
  return getOrCreateSheet(ITEMS_SHEET_NAME, ITEMS_HEADERS);
}

function toCategory(value: unknown): ItemCategory {
  const text = asText(value);
  return (ITEM_CATEGORIES as readonly string[]).includes(text)
    ? (text as ItemCategory)
    : 'Materials';
}

function toRecord(values: unknown[], rowNumber: number): CatalogItemRecord {
  return {
    id: asText(values[COLUMN.id]),
    category: toCategory(values[COLUMN.category]),
    name: asText(values[COLUMN.name]),
    defaultUnit: asText(values[COLUMN.defaultUnit]),
    active: asBoolean(values[COLUMN.active]),
    rowNumber,
  };
}

/** Active items only by default — a deactivated item stays out of the picker. */
export function listItems(includeInactive = false): CatalogItemRecord[] {
  const rows = readRows(sheet());
  const items: CatalogItemRecord[] = [];

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (row === undefined) continue;
    if (asText(row[COLUMN.id]).length === 0) continue;

    const record = toRecord(row, index + 2);
    if (includeInactive || record.active) items.push(record);
  }

  return items;
}

export function findById(id: string): CatalogItemRecord | null {
  const found = findRow(sheet(), COLUMN.id, id);
  return found === null ? null : toRecord(found.values, found.rowNumber);
}

/** True when the category already has an item of that name (case-insensitive). */
export function nameExists(category: ItemCategory, name: string, exceptId = ''): boolean {
  const target = name.trim().toLowerCase();
  return listItems(true).some(
    (item) =>
      item.id !== exceptId &&
      item.category === category &&
      item.name.trim().toLowerCase() === target,
  );
}

export interface CreateItemInput {
  id: string;
  category: ItemCategory;
  name: string;
  defaultUnit: string;
}

export function createItem(input: CreateItemInput): CatalogItemRecord {
  const now = new Date().toISOString();

  appendRow(sheet(), [input.id, input.category, input.name, input.defaultUnit, true, now, now]);

  return { ...input, active: true, rowNumber: sheet().getLastRow() };
}

export function updateItem(existing: CatalogItemRecord, name: string, defaultUnit: string): void {
  const target = sheet();
  setCell(target, existing.rowNumber, COLUMN.name + 1, name);
  setCell(target, existing.rowNumber, COLUMN.defaultUnit + 1, defaultUnit);
  setCell(target, existing.rowNumber, COLUMN.updatedAt + 1, new Date().toISOString());
}

/**
 * Soft delete.
 *
 * A hard delete would strand any historic quotation that referenced the item,
 * so deactivation just removes it from the picker.
 */
export function setActive(existing: CatalogItemRecord, active: boolean): void {
  const target = sheet();
  setCell(target, existing.rowNumber, COLUMN.active + 1, active);
  setCell(target, existing.rowNumber, COLUMN.updatedAt + 1, new Date().toISOString());
}
