/**
 * The `Settings` sheet — company-level business defaults.
 *
 * ---------------------------------------------------------------------------
 * KEY/VALUE, NOT A COLUMN PER SETTING
 * ---------------------------------------------------------------------------
 * A column per setting means altering a populated sheet every time one is
 * added, and `getOrCreateSheet` deliberately never rewrites headers on a sheet
 * that already has rows. Key/value grows without that problem.
 *
 * ---------------------------------------------------------------------------
 * WHAT LIVES HERE AND WHAT DOES NOT
 * ---------------------------------------------------------------------------
 * Only values an administrator may change at runtime. Script Properties keep
 * everything that is deployment configuration — the numbering codes, the VAT
 * registration, the Drive and spreadsheet ids, and every secret. None of those
 * is readable or writable through this sheet.
 *
 * ---------------------------------------------------------------------------
 * THESE ARE DEFAULTS FOR THE NEXT QUOTATION
 * ---------------------------------------------------------------------------
 * Every quotation stores its own VAT rate and its own closing paragraph, and
 * the server recomputes its totals from the rate ON THAT QUOTATION. So changing
 * a default here cannot alter a quotation that already exists — the same
 * snapshot discipline the terms, the authorized person and the client already
 * follow.
 */

import { appendRow, asText, findRow, getOrCreateSheet, readRows, setCell } from './sheet-access';

export const SETTINGS_SHEET_NAME = 'Settings';

export const SETTINGS_HEADERS = ['Key', 'Value', 'Updated At', 'Updated By'] as const;

const COLUMN = { key: 0, value: 1, updatedAt: 2, updatedBy: 3 } as const;

/**
 * The keys this system understands.
 *
 * An unknown key cannot be written — `settings/handlers.ts` validates against
 * this list — so the sheet cannot become a dumping ground that later code has
 * to guess the meaning of.
 */
export const SETTING_KEYS = [
  'defaultVatRateBasisPoints',
  'quotationValidityDays',
  'defaultClosingParagraph',
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

function sheet(): GoogleAppsScript.Spreadsheet.Sheet {
  return getOrCreateSheet(SETTINGS_SHEET_NAME, SETTINGS_HEADERS);
}

/** Every stored setting, as raw strings. Unset keys are simply absent. */
export function readAll(): Record<string, string> {
  const stored: Record<string, string> = {};

  for (const row of readRows(sheet())) {
    const key = asText(row[COLUMN.key]);
    if (key.length === 0) continue;
    stored[key] = asText(row[COLUMN.value]);
  }

  return stored;
}

/**
 * Write one setting, creating its row on first use.
 *
 * Upsert rather than append: a settings sheet that grows a row per edit would
 * make "the current value" a question about ordering.
 */
export function write(key: SettingKey, value: string, actor: string): void {
  const target = sheet();
  const now = new Date().toISOString();
  const found = findRow(target, COLUMN.key, key);

  if (found === null) {
    appendRow(target, [key, value, now, actor]);
    return;
  }

  setCell(target, found.rowNumber, COLUMN.value + 1, value);
  setCell(target, found.rowNumber, COLUMN.updatedAt + 1, now);
  setCell(target, found.rowNumber, COLUMN.updatedBy + 1, actor);
}
