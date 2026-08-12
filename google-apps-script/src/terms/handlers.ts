/**
 * Terms & Conditions library actions.
 *
 * Role enforcement is declared in the action table in main.ts, not here (§19.2).
 *
 * Note what is NOT here: editing a term for one quotation. PRD §22 requires
 * that to stay on the quotation and never touch the master library, so it lives
 * entirely in the quotation payload — a quotation-local edit never reaches
 * these handlers at all.
 */

import { writeAudit } from '../audit/audit-log';
import { ApiError, type Caller, type HandlerContext } from '../errors';
import { assertValidTermTemplate, cleanTermText } from '../validation/term-validator';
import { importReferenceTerms } from './import-reference-terms';
import * as terms from '../sheets/terms-sheet';
import type { TermCategory } from '../sheets/terms-sheet';

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

function readString(payload: Record<string, unknown>, key: string): string {
  return cleanTermText(payload[key]);
}

export interface PublicTerm {
  id: string;
  title: string;
  bodyTemplate: string;
  category: TermCategory;
  sortOrder: number;
  active: boolean;
}

function toPublic(record: terms.TermRecord): PublicTerm {
  return {
    id: record.id,
    title: record.title,
    bodyTemplate: record.bodyTemplate,
    category: record.category,
    sortOrder: record.sortOrder,
    active: record.active,
  };
}

export function list(payload: unknown, context: HandlerContext): PublicTerm[] {
  requireCaller(context);
  const body = asRecord(payload);
  const includeInactive = body['includeInactive'] === true;

  return terms.listTerms(includeInactive).map(toPublic);
}

export function create(payload: unknown, context: HandlerContext): PublicTerm {
  const caller = requireCaller(context);
  const body = asRecord(payload);

  const title = readString(body, 'title');
  const bodyTemplate = readString(body, 'bodyTemplate');
  const categoryText = readString(body, 'category');
  const category: TermCategory =
    categoryText === 'Manpower' || categoryText === 'Equipment' || categoryText === 'Materials'
      ? categoryText
      : 'General';

  assertValidTermTemplate(title, bodyTemplate);

  if (terms.titleExists(title)) {
    throw new ApiError('VALIDATION_FAILED', 'A term with that title already exists.', {
      title: 'A term with that title already exists.',
    });
  }

  const created = terms.createTerm({
    id: Utilities.getUuid(),
    title,
    bodyTemplate,
    category,
    sortOrder: terms.nextSortOrder(),
    updatedBy: caller.email,
  });

  writeAudit({
    actor: caller.email,
    action: 'terms.create',
    target: title,
    outcome: 'success',
    requestId: context.requestId,
  });

  return toPublic(created);
}

export function update(payload: unknown, context: HandlerContext): PublicTerm {
  const caller = requireCaller(context);
  const body = asRecord(payload);

  const existing = terms.findById(readString(body, 'id'));
  if (existing === null) {
    throw new ApiError('VALIDATION_FAILED', 'That term could not be found.');
  }

  const title = readString(body, 'title');
  const bodyTemplate = readString(body, 'bodyTemplate');

  assertValidTermTemplate(title, bodyTemplate);

  if (terms.titleExists(title, existing.id)) {
    throw new ApiError('VALIDATION_FAILED', 'A term with that title already exists.', {
      title: 'A term with that title already exists.',
    });
  }

  terms.updateTerm(existing, title, bodyTemplate, caller.email);

  writeAudit({
    actor: caller.email,
    action: 'terms.update',
    target: existing.id,
    outcome: 'success',
    requestId: context.requestId,
  });

  return { ...toPublic(existing), title, bodyTemplate };
}

export function deactivate(payload: unknown, context: HandlerContext): { id: string } {
  const caller = requireCaller(context);
  const body = asRecord(payload);

  const existing = terms.findById(readString(body, 'id'));
  if (existing === null) {
    throw new ApiError('VALIDATION_FAILED', 'That term could not be found.');
  }

  const active = body['active'] === true;
  terms.setActive(existing, active, caller.email);

  writeAudit({
    actor: caller.email,
    action: active ? 'terms.activate' : 'terms.deactivate',
    target: existing.id,
    outcome: 'success',
    requestId: context.requestId,
  });

  return { id: existing.id };
}

/** Reorder the library. The quotation keeps its own order independently. */
export function reorder(payload: unknown, context: HandlerContext): { ordered: number } {
  const caller = requireCaller(context);
  const body = asRecord(payload);

  const ids = body['ids'];
  if (!Array.isArray(ids)) {
    throw new ApiError('VALIDATION_FAILED', 'An ordered list of term ids is required.');
  }

  let sortOrder = 10;
  let ordered = 0;

  for (const value of ids) {
    if (typeof value !== 'string') continue;
    const existing = terms.findById(value);
    if (existing === null) continue;

    terms.setSortOrder(existing, sortOrder, caller.email);
    sortOrder += 10;
    ordered += 1;
  }

  writeAudit({
    actor: caller.email,
    action: 'terms.reorder',
    target: String(ordered),
    outcome: 'success',
    requestId: context.requestId,
  });

  return { ordered };
}

/**
 * Import the company's real terms from the reference document. Admin only.
 *
 * Idempotent and non-destructive — see import-reference-terms.ts.
 */
export function importReference(
  _payload: unknown,
  context: HandlerContext,
): { imported: number; skipped: number; total: number } {
  const caller = requireCaller(context);
  const result = importReferenceTerms(caller.email);

  writeAudit({
    actor: caller.email,
    action: 'admin.importReferenceTerms',
    target: `imported:${String(result.imported)} skipped:${String(result.skipped)}`,
    outcome: 'success',
    requestId: context.requestId,
  });

  return result;
}
