import { useCallback, useMemo, useState } from 'react';

import { QUOTATION_LIMITS } from '@shared/validation-rules';
import { resolveTermTokens, type TermTokenContext } from '@shared/term-tokens';
import type { TermSource } from '@shared/types';
import type { TermTemplate } from '@/services/terms/terms-service';
import { newLineItemId } from '@/utils/uuid';

/**
 * A term as held in the quotation editor.
 *
 * `bodyTemplate` is what the user edits; `body` — the resolved text — is
 * derived at payload time. Keeping both is what lets a saved quotation be
 * reopened and re-edited while still storing the exact text it was issued with
 * (IMPLEMENTATION_PLAN.md §6.3, §10.4).
 *
 * `libraryTitle` / `libraryBody` are the master text as it was when the term
 * was selected. They exist only so "revert to library version" has something
 * true to revert to; they are never sent to the server.
 */
export interface EditorTerm {
  /** A library id, or `local:<uuid>` for a term created on this quotation. */
  id: string;
  title: string;
  bodyTemplate: string;
  source: TermSource;
  libraryTitle: string | null;
  libraryBody: string | null;
}

/** The `local:` prefix is how a quotation-local term is told from a library id. */
export const LOCAL_TERM_PREFIX = 'local:';

export function isLocalTerm(id: string): boolean {
  return id.indexOf(LOCAL_TERM_PREFIX) === 0;
}

function fromTemplate(template: TermTemplate): EditorTerm {
  return {
    id: template.id,
    title: template.title,
    bodyTemplate: template.bodyTemplate,
    source: 'library',
    libraryTitle: template.title,
    libraryBody: template.bodyTemplate,
  };
}

export interface ResolvedTerm extends EditorTerm {
  /** 1-based, positional — the document numbers terms by position (§10.3). */
  position: number;
  /** Token-resolved text, as it will appear in the document. */
  body: string;
  /** Tokens the system could not fill in. Warned about, never blanked. */
  unresolvedTokens: string[];
}

export interface UseQuotationTermsResult {
  terms: EditorTerm[];
  selectedIds: string[];
  isSelected: (id: string) => boolean;
  toggle: (template: TermTemplate) => void;
  remove: (id: string) => void;
  move: (id: string, direction: -1 | 1) => void;
  /** Quotation-only edit. Marks the term overridden; the library is untouched. */
  edit: (id: string, patch: { title?: string; bodyTemplate?: string }) => void;
  revert: (id: string) => void;
  addLocal: (input: { title: string; bodyTemplate: string }) => EditorTerm;
  /** Adopt a locally-created term that has just been saved to the library. */
  adoptLibraryId: (localId: string, template: TermTemplate) => void;
  reset: (terms: EditorTerm[]) => void;
  atTermLimit: boolean;
}

/**
 * Term state for the quotation editor.
 *
 * Everything here is quotation-scoped. There is no code path from this hook to
 * a library mutation, which is how PRD §22 — "editing a term in a quotation
 * must not change the master library" — is enforced structurally rather than by
 * remembering not to.
 */
export function useQuotationTerms(initial: EditorTerm[] = []): UseQuotationTermsResult {
  const [terms, setTerms] = useState<EditorTerm[]>(initial);

  const selectedIds = useMemo(() => terms.map((term) => term.id), [terms]);

  const isSelected = useCallback((id: string) => terms.some((term) => term.id === id), [terms]);

  const toggle = useCallback((template: TermTemplate) => {
    setTerms((current) => {
      if (current.some((term) => term.id === template.id)) {
        return current.filter((term) => term.id !== template.id);
      }
      if (current.length >= QUOTATION_LIMITS.maxTerms) return current;
      return [...current, fromTemplate(template)];
    });
  }, []);

  const remove = useCallback((id: string) => {
    setTerms((current) => current.filter((term) => term.id !== id));
  }, []);

  const move = useCallback((id: string, direction: -1 | 1) => {
    setTerms((current) => {
      const position = current.findIndex((term) => term.id === id);
      const target = position + direction;
      if (position === -1 || target < 0 || target >= current.length) return current;

      const next = [...current];
      const moving = next[position];
      const displaced = next[target];
      if (moving === undefined || displaced === undefined) return current;

      next[position] = displaced;
      next[target] = moving;
      return next;
    });
  }, []);

  const edit = useCallback((id: string, patch: { title?: string; bodyTemplate?: string }) => {
    setTerms((current) =>
      current.map((term) => {
        if (term.id !== id) return term;

        const next: EditorTerm = {
          ...term,
          ...(patch.title === undefined ? {} : { title: patch.title }),
          ...(patch.bodyTemplate === undefined ? {} : { bodyTemplate: patch.bodyTemplate }),
        };

        // A quotation-local term has no master row, so it can never be
        // "overridden" — it is already only this quotation's.
        if (next.source === 'quotation-local') return next;

        const changed =
          next.title !== (term.libraryTitle ?? term.title) ||
          next.bodyTemplate !== (term.libraryBody ?? term.bodyTemplate);

        return { ...next, source: changed ? 'library-overridden' : 'library' };
      }),
    );
  }, []);

  const revert = useCallback((id: string) => {
    setTerms((current) =>
      current.map((term) =>
        term.id === id && term.libraryTitle !== null && term.libraryBody !== null
          ? { ...term, title: term.libraryTitle, bodyTemplate: term.libraryBody, source: 'library' }
          : term,
      ),
    );
  }, []);

  const addLocal = useCallback((input: { title: string; bodyTemplate: string }) => {
    const term: EditorTerm = {
      id: `${LOCAL_TERM_PREFIX}${newLineItemId()}`,
      title: input.title,
      bodyTemplate: input.bodyTemplate,
      source: 'quotation-local',
      libraryTitle: null,
      libraryBody: null,
    };

    setTerms((current) => (current.length >= QUOTATION_LIMITS.maxTerms ? current : [...current, term]));
    return term;
  }, []);

  /**
   * Swap a local id for the library id it was just saved under.
   *
   * Without this the quotation would keep citing `local:…` for a term that now
   * has a real master row, and the selector would show it unchecked while it
   * sits in the list.
   */
  const adoptLibraryId = useCallback((localId: string, template: TermTemplate) => {
    setTerms((current) =>
      current.map((term) =>
        term.id === localId
          ? {
              ...term,
              id: template.id,
              source: 'library',
              libraryTitle: template.title,
              libraryBody: template.bodyTemplate,
            }
          : term,
      ),
    );
  }, []);

  const reset = useCallback((next: EditorTerm[]) => {
    setTerms(next);
  }, []);

  return {
    terms,
    selectedIds,
    isSelected,
    toggle,
    remove,
    move,
    edit,
    revert,
    addLocal,
    adoptLibraryId,
    reset,
    atTermLimit: terms.length >= QUOTATION_LIMITS.maxTerms,
  };
}

/**
 * Resolve every term against the current quotation, numbering positionally.
 *
 * Pure, and driven by the one shared resolver, so the preview, the PDF and the
 * DOCX cannot disagree about what a term says (§10.2).
 */
export function resolveTerms(
  terms: readonly EditorTerm[],
  context: TermTokenContext,
): ResolvedTerm[] {
  return terms.map((term, index) => {
    const resolution = resolveTermTokens(term.bodyTemplate, context);

    return {
      ...term,
      position: index + 1,
      body: resolution.text,
      unresolvedTokens: [...resolution.unknownTokens, ...resolution.emptyTokens],
    };
  });
}
