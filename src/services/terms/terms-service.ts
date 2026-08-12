/**
 * Terms & Conditions library actions, over the shared API client.
 *
 * Note what is missing: there is no "save a quotation's edit back to the
 * library" call. PRD §22 requires an in-quotation edit to affect only that
 * quotation, so a quotation-local edit never leaves the quotation payload — the
 * absence of a function is what enforces it.
 */

import { callAction } from '@/services/api/client';
import type { ItemCategory } from '@shared/types';

export type TermCategory = ItemCategory | 'General';

export interface TermTemplate {
  id: string;
  title: string;
  /** May contain whitelisted `{{tokens}}` — see `shared/term-tokens.ts`. */
  bodyTemplate: string;
  category: TermCategory;
  sortOrder: number;
  active: boolean;
}

export async function listTerms(token: string, includeInactive = false): Promise<TermTemplate[]> {
  return callAction<{ includeInactive: boolean }, TermTemplate[]>(
    'terms.list',
    { includeInactive },
    { token },
  );
}

export interface CreateTermInput {
  title: string;
  bodyTemplate: string;
  category: TermCategory;
}

export async function createTerm(input: CreateTermInput, token: string): Promise<TermTemplate> {
  return callAction<CreateTermInput, TermTemplate>('terms.create', input, { token });
}

export async function updateTerm(
  input: { id: string; title: string; bodyTemplate: string },
  token: string,
): Promise<TermTemplate> {
  return callAction<typeof input, TermTemplate>('terms.update', input, { token });
}

/** Soft delete / restore. The row survives so historic quotations stay explicable. */
export async function setTermActive(
  id: string,
  active: boolean,
  token: string,
): Promise<{ id: string }> {
  return callAction<{ id: string; active: boolean }, { id: string }>(
    'terms.deactivate',
    { id, active },
    { token },
  );
}

/** Reorder the LIBRARY. A quotation's own order is stored on the quotation. */
export async function reorderTerms(ids: string[], token: string): Promise<{ ordered: number }> {
  return callAction<{ ids: string[] }, { ordered: number }>('terms.reorder', { ids }, { token });
}

export interface ImportResult {
  imported: number;
  skipped: number;
  total: number;
}

/** Admin only, enforced server-side in the router's action table. */
export async function importReferenceTerms(token: string): Promise<ImportResult> {
  return callAction<Record<string, never>, ImportResult>(
    'admin.importReferenceTerms',
    {},
    { token },
  );
}
