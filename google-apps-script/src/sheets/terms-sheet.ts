/**
 * The `Terms` sheet — the reusable Terms & Conditions library.
 *
 * See PRD §20–§22 and IMPLEMENTATION_PLAN.md §10.
 *
 * The sheet ships EMPTY. The company's 11 real terms arrive only through the
 * explicit Admin "import reference terms" action (import-reference-terms.ts),
 * never automatically on first load — PRD §21 is emphatic that existing terms
 * must not be modified behind the user's back, and auto-seeding would be the
 * same class of surprise.
 *
 * Deletion is a SOFT delete. A hard delete would strand any historic quotation
 * that cited the term, leaving an issued document unexplainable.
 */

import type { ItemCategory } from '@shared/types';
import {
  appendRow,
  asBoolean,
  asInteger,
  asText,
  findRow,
  getOrCreateSheet,
  readRows,
  setCell,
} from './sheet-access';

export const TERMS_SHEET_NAME = 'Terms';

export const TERMS_HEADERS = [
  'ID',
  'Title',
  'Body Template',
  'Category',
  'Sort Order',
  'Active',
  'Updated At',
  'Updated By',
] as const;

const COLUMN = {
  id: 0,
  title: 1,
  bodyTemplate: 2,
  category: 3,
  sortOrder: 4,
  active: 5,
  updatedAt: 6,
  updatedBy: 7,
} as const;

export type TermCategory = ItemCategory | 'General';

export interface TermRecord {
  id: string;
  title: string;
  bodyTemplate: string;
  category: TermCategory;
  sortOrder: number;
  active: boolean;
  updatedAt: string;
  updatedBy: string;
  rowNumber: number;
}

function sheet(): GoogleAppsScript.Spreadsheet.Sheet {
  return getOrCreateSheet(TERMS_SHEET_NAME, TERMS_HEADERS);
}

function toCategory(value: unknown): TermCategory {
  const text = asText(value);
  return text === 'Manpower' || text === 'Equipment' || text === 'Materials' ? text : 'General';
}

function toRecord(values: unknown[], rowNumber: number): TermRecord {
  return {
    id: asText(values[COLUMN.id]),
    title: asText(values[COLUMN.title]),
    bodyTemplate: asText(values[COLUMN.bodyTemplate]),
    category: toCategory(values[COLUMN.category]),
    sortOrder: asInteger(values[COLUMN.sortOrder], 0),
    active: asBoolean(values[COLUMN.active]),
    updatedAt: asText(values[COLUMN.updatedAt]),
    updatedBy: asText(values[COLUMN.updatedBy]),
    rowNumber,
  };
}

/** Library terms in display order. Active only unless asked otherwise. */
export function listTerms(includeInactive = false): TermRecord[] {
  const rows = readRows(sheet());
  const terms: TermRecord[] = [];

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (row === undefined) continue;
    if (asText(row[COLUMN.id]).length === 0) continue;

    const record = toRecord(row, index + 2);
    if (includeInactive || record.active) terms.push(record);
  }

  return terms.sort((a, b) => a.sortOrder - b.sortOrder);
}

export function findById(id: string): TermRecord | null {
  const found = findRow(sheet(), COLUMN.id, id);
  return found === null ? null : toRecord(found.values, found.rowNumber);
}

/** Case-insensitive title check among ACTIVE terms — PRD §20 selects by title. */
export function titleExists(title: string, exceptId = ''): boolean {
  const target = title.trim().toLowerCase();
  return listTerms(true).some(
    (term) => term.id !== exceptId && term.active && term.title.trim().toLowerCase() === target,
  );
}

export function nextSortOrder(): number {
  const terms = listTerms(true);
  return terms.reduce((highest, term) => Math.max(highest, term.sortOrder), 0) + 10;
}

export interface CreateTermInput {
  id: string;
  title: string;
  bodyTemplate: string;
  category: TermCategory;
  sortOrder: number;
  updatedBy: string;
}

export function createTerm(input: CreateTermInput): TermRecord {
  const now = new Date().toISOString();

  appendRow(sheet(), [
    input.id,
    input.title,
    input.bodyTemplate,
    input.category,
    input.sortOrder,
    true,
    now,
    input.updatedBy,
  ]);

  return { ...input, active: true, updatedAt: now, rowNumber: sheet().getLastRow() };
}

export function updateTerm(
  existing: TermRecord,
  title: string,
  bodyTemplate: string,
  updatedBy: string,
): void {
  const target = sheet();
  setCell(target, existing.rowNumber, COLUMN.title + 1, title);
  setCell(target, existing.rowNumber, COLUMN.bodyTemplate + 1, bodyTemplate);
  setCell(target, existing.rowNumber, COLUMN.updatedAt + 1, new Date().toISOString());
  setCell(target, existing.rowNumber, COLUMN.updatedBy + 1, updatedBy);
}

export function setSortOrder(existing: TermRecord, sortOrder: number, updatedBy: string): void {
  const target = sheet();
  setCell(target, existing.rowNumber, COLUMN.sortOrder + 1, sortOrder);
  setCell(target, existing.rowNumber, COLUMN.updatedAt + 1, new Date().toISOString());
  setCell(target, existing.rowNumber, COLUMN.updatedBy + 1, updatedBy);
}

export function setActive(existing: TermRecord, active: boolean, updatedBy: string): void {
  const target = sheet();
  setCell(target, existing.rowNumber, COLUMN.active + 1, active);
  setCell(target, existing.rowNumber, COLUMN.updatedAt + 1, new Date().toISOString());
  setCell(target, existing.rowNumber, COLUMN.updatedBy + 1, updatedBy);
}

export function isEmpty(): boolean {
  return listTerms(true).length === 0;
}
