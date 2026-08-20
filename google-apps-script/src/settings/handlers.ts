/**
 * Company settings.
 *
 * Role enforcement is declared in the action table in main.ts, not here (§19.2):
 * `settings.get` is `authenticated` because producing a quotation needs the
 * defaults, and `settings.update` is `Admin`.
 *
 * ---------------------------------------------------------------------------
 * TWO KINDS OF CONFIGURATION, KEPT APART
 * ---------------------------------------------------------------------------
 * `business` is editable at runtime and stored in the `Settings` sheet.
 *
 * `deployment` is read-only and reported so an administrator can SEE what the
 * deployment is configured with without opening the Apps Script editor. It is
 * not editable here, and deliberately so:
 *
 *   - the numbering codes decide every quotation number ever issued and every
 *     Drive folder name; changing one would invalidate the archive;
 *   - the company's printed identity lives in the letterhead ARTWORK, which the
 *     PDF embeds directly. Text edited here would change the DOCX and not the
 *     PDF, and the two documents for one quotation would disagree about who
 *     issued it.
 *
 * Nothing secret is reported. Secrets and resource ids are named-and-checked by
 * `admin.diagnostics`, which says whether each is set and never what it is.
 */

import { DEFAULT_CLOSING_PARAGRAPH, DEFAULT_QUOTATION_VALIDITY_DAYS } from '@shared/company-defaults';
import { DEFAULT_VAT_RATE_BASIS_POINTS } from '@shared/totals';
import {
  QUOTATION_LIMITS,
  TEXT_LIMITS,
  isWithinLength,
  stripControlCharacters,
} from '@shared/validation-rules';
import { writeAudit } from '../audit/audit-log';
import { companyVatNumber, quotationCodes } from '../config/properties';
import { ApiError, type Caller, type HandlerContext } from '../errors';
import * as settings from '../sheets/settings-sheet';

function requireCaller(context: HandlerContext): Caller {
  if (context.caller === null) {
    throw new ApiError('AUTH_REQUIRED', 'Authentication is required.');
  }
  return context.caller;
}

function asRecord(payload: unknown): Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new ApiError('VALIDATION_FAILED', 'Invalid request payload.');
  }
  return payload as Record<string, unknown>;
}

/** Editable at runtime. Defaults for the NEXT quotation, never for an existing one. */
export interface BusinessSettings {
  /** Basis points. 1500 = 15%. */
  defaultVatRateBasisPoints: number;
  quotationValidityDays: number;
  defaultClosingParagraph: string;
}

/** Read-only. Set at deployment, shown so an operator can confirm it. */
export interface DeploymentSettings {
  companyCode: string;
  branchCode: string;
  documentTypeCode: string;
  vatNumber: string;
}

export interface SettingsResponse {
  business: BusinessSettings;
  deployment: DeploymentSettings;
}

/** Bounds. A rate outside 0–100% is a typo, not a business decision. */
export const VAT_RATE_MAX_BASIS_POINTS = 10_000;

/*
 * The validity bounds are the SHARED ones, not a second copy.
 *
 * The number an administrator types here is snapshotted onto every quotation
 * created afterwards, and the quotation validator bounds it too. If the two
 * lists of bounds ever drifted, Settings would accept a value that then made
 * every new quotation unsaveable.
 */
export const VALIDITY_DAYS_MIN = QUOTATION_LIMITS.validityDaysMin;
export const VALIDITY_DAYS_MAX = QUOTATION_LIMITS.validityDaysMax;

function toInteger(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.length === 0) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * The stored settings, falling back to the values this system ships with.
 *
 * An unset key is not an error: a deployment that has never opened this screen
 * still has to produce quotations, and the shipped constants are exactly what
 * it used before this module existed.
 */
export function currentBusinessSettings(): BusinessSettings {
  const stored = settings.readAll();
  const closing = stored['defaultClosingParagraph'];

  return {
    defaultVatRateBasisPoints: toInteger(
      stored['defaultVatRateBasisPoints'],
      DEFAULT_VAT_RATE_BASIS_POINTS,
    ),
    quotationValidityDays: toInteger(
      stored['quotationValidityDays'],
      DEFAULT_QUOTATION_VALIDITY_DAYS,
    ),
    defaultClosingParagraph:
      closing === undefined || closing.length === 0 ? DEFAULT_CLOSING_PARAGRAPH : closing,
  };
}

export function get(_payload: unknown, context: HandlerContext): SettingsResponse {
  requireCaller(context);

  const codes = quotationCodes();

  return {
    business: currentBusinessSettings(),
    deployment: {
      companyCode: codes.company,
      branchCode: codes.branch,
      documentTypeCode: codes.documentType,
      // Printed on every quotation, so this is not a disclosure. The secrets
      // and the resource ids are not here and never will be.
      vatNumber: companyVatNumber(),
    },
  };
}

function validate(body: Record<string, unknown>): BusinessSettings {
  const fields: Record<string, string> = {};

  const rate = body['defaultVatRateBasisPoints'];
  const days = body['quotationValidityDays'];
  const closingRaw = body['defaultClosingParagraph'];

  if (typeof rate !== 'number' || !Number.isInteger(rate) || rate < 0 || rate > VAT_RATE_MAX_BASIS_POINTS) {
    fields['defaultVatRateBasisPoints'] = 'Enter a VAT rate between 0 and 100%.';
  }
  if (
    typeof days !== 'number' ||
    !Number.isInteger(days) ||
    days < VALIDITY_DAYS_MIN ||
    days > VALIDITY_DAYS_MAX
  ) {
    fields['quotationValidityDays'] =
      `Enter a number of days between ${String(VALIDITY_DAYS_MIN)} and ${String(VALIDITY_DAYS_MAX)}.`;
  }

  // `stripControlCharacters` leaves \n and \r intact — the closing paragraph is
  // two paragraphs separated by a blank line, and flattening it would change
  // what prints on the document.
  const closing = typeof closingRaw === 'string' ? stripControlCharacters(closingRaw).trim() : '';
  if (!isWithinLength(closing, TEXT_LIMITS.closingParagraph)) {
    fields['defaultClosingParagraph'] =
      `The closing paragraph must be ${String(TEXT_LIMITS.closingParagraph.min)}-${String(TEXT_LIMITS.closingParagraph.max)} characters.`;
  }

  if (Object.keys(fields).length > 0) {
    throw new ApiError('VALIDATION_FAILED', 'Please correct the highlighted fields.', fields);
  }

  return {
    defaultVatRateBasisPoints: rate as number,
    quotationValidityDays: days as number,
    defaultClosingParagraph: closing,
  };
}

/**
 * Replace the editable settings. Admin only.
 *
 * Deliberately writes all three together: they are one screen and one save, and
 * a partial write would leave the sheet in a state no operator asked for.
 */
export function update(payload: unknown, context: HandlerContext): SettingsResponse {
  const caller = requireCaller(context);
  const validated = validate(asRecord(payload));

  settings.write(
    'defaultVatRateBasisPoints',
    String(validated.defaultVatRateBasisPoints),
    caller.email,
  );
  settings.write('quotationValidityDays', String(validated.quotationValidityDays), caller.email);
  settings.write('defaultClosingParagraph', validated.defaultClosingParagraph, caller.email);

  writeAudit({
    actor: caller.email,
    action: 'settings.update',
    // Which settings changed and to what for the two numbers; the closing
    // paragraph is prose and belongs in the sheet, not repeated in the log.
    target: `vat:${String(validated.defaultVatRateBasisPoints)} validity:${String(validated.quotationValidityDays)}`,
    outcome: 'success',
    requestId: context.requestId,
  });

  return get(payload, context);
}
