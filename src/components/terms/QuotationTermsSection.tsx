import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/useToast';
import { resolveTerms, isLocalTerm, type UseQuotationTermsResult } from '@/hooks/useQuotationTerms';
import { AppError, messageOf } from '@/services/api/errors';
import { createTerm, listTerms, type TermTemplate } from '@/services/terms/terms-service';
import type { TermTokenContext } from '@shared/term-tokens';
import { QUOTATION_LIMITS } from '@shared/validation-rules';
import { ClosingParagraphEditor } from './ClosingParagraphEditor';
import { CreateTermModal, type CreateTermSubmit } from './CreateTermModal';
import { TermList } from './TermList';
import { TermsSelector } from './TermsSelector';

export const TERMS_QUERY_KEY = ['terms'] as const;

export interface QuotationTermsSectionProps {
  terms: UseQuotationTermsResult;
  tokenContext: TermTokenContext;
  closingParagraph: string;
  closingParagraphDefault: string;
  closingParagraphError?: string | undefined;
  onClosingParagraphChange: (value: string) => void;
}

/**
 * The Terms & Conditions section of the quotation form (PRD §20–§23).
 *
 * Everything here is quotation-scoped except one path: the "Save to Library"
 * checkbox in the create modal, which is the single deliberate write to the
 * master library from this screen.
 */
export function QuotationTermsSection({
  terms,
  tokenContext,
  closingParagraph,
  closingParagraphDefault,
  closingParagraphError,
  onClosingParagraphChange,
}: QuotationTermsSectionProps) {
  const { state } = useAuth();
  const { show } = useToast();
  const queryClient = useQueryClient();

  const token = state.status === 'authenticated' ? state.token : null;

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createFieldErrors, setCreateFieldErrors] = useState<Record<string, string> | null>(null);

  const library = useQuery({
    queryKey: TERMS_QUERY_KEY,
    queryFn: () => listTerms(token ?? ''),
    enabled: token !== null,
  });

  const templates = useMemo<TermTemplate[]>(() => library.data ?? [], [library.data]);

  const resolved = useMemo(
    () => resolveTerms(terms.terms, tokenContext),
    [terms.terms, tokenContext],
  );

  /**
   * Library terms this quotation cites that are no longer in the active list.
   *
   * Deactivating a term is a soft delete, so the quotation keeps its snapshot
   * and still prints correctly. Saying so is the point: a term silently
   * vanishing from a document nobody re-read is the failure to avoid.
   */
  const withdrawn = useMemo(
    () =>
      terms.terms.filter(
        (term) =>
          !isLocalTerm(term.id) &&
          templates.length > 0 &&
          !templates.some((template) => template.id === term.id),
      ),
    [terms.terms, templates],
  );

  const unresolvedCount = resolved.reduce(
    (total, term) => total + term.unresolvedTokens.length,
    0,
  );

  const saveToLibrary = useMutation({
    mutationFn: (values: CreateTermSubmit) =>
      createTerm(
        { title: values.title, bodyTemplate: values.bodyTemplate, category: values.category },
        token ?? '',
      ),
  });

  const submitNewTerm = (values: CreateTermSubmit): void => {
    setCreateError(null);
    setCreateFieldErrors(null);

    // Available on this quotation immediately, whether or not it is promoted.
    const local = terms.addLocal({ title: values.title, bodyTemplate: values.bodyTemplate });

    if (!values.saveToLibrary) {
      setCreating(false);
      return;
    }

    saveToLibrary.mutate(values, {
      onSuccess: (template) => {
        terms.adoptLibraryId(local.id, template);
        void queryClient.invalidateQueries({ queryKey: TERMS_QUERY_KEY });
        show({ variant: 'success', message: 'Term added to this quotation and to the library.' });
        setCreating(false);
      },
      onError: (error: unknown) => {
        // The term stays on the quotation; only the library write failed. Keep
        // the modal open so the user can correct a duplicate title and retry.
        terms.remove(local.id);

        if (error instanceof AppError && error.fields !== undefined) {
          setCreateFieldErrors(error.fields);
        }
        setCreateError(messageOf(error));
      },
    });
  };

  return (
    <Card
      title="Terms & Conditions"
      description="Tick the terms that apply. Order them as they should print — the document numbers them 1, 2, 3."
      actions={
        <Button
          variant="secondary"
          size="sm"
          disabled={terms.atTermLimit}
          onClick={() => {
            setCreateError(null);
            setCreateFieldErrors(null);
            setCreating(true);
          }}
        >
          + Create New Term
        </Button>
      }
    >
      <div className="flex flex-col gap-5">
        <TermsSelector
          templates={templates}
          isLoading={library.isPending && token !== null}
          loadError={library.isError ? messageOf(library.error) : null}
          isSelected={terms.isSelected}
          onToggle={terms.toggle}
          onRetry={() => {
            void library.refetch();
          }}
          atTermLimit={terms.atTermLimit}
        />

        {terms.atTermLimit ? (
          <p role="status" className="text-xs text-amber-700">
            A quotation may carry at most {QUOTATION_LIMITS.maxTerms} terms.
          </p>
        ) : null}

        {withdrawn.length > 0 ? (
          <p role="status" className="text-xs text-amber-700">
            {withdrawn.length === 1 ? 'One term' : `${String(withdrawn.length)} terms`} on this
            quotation{' '}
            {withdrawn.length === 1 ? 'is no longer in' : 'are no longer in'} the library:{' '}
            {withdrawn.map((term) => term.title).join(', ')}. The wording saved here is kept and
            will still print.
          </p>
        ) : null}

        <div className="border-t border-slate-200 pt-5">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">
            On this quotation
            <span className="ml-2 font-normal text-slate-500">
              {resolved.length === 0
                ? 'none selected'
                : `${String(resolved.length)} ${resolved.length === 1 ? 'term' : 'terms'}`}
            </span>
          </h3>

          {unresolvedCount > 0 ? (
            <p role="status" className="mb-2 text-xs text-amber-700">
              {unresolvedCount === 1 ? 'One placeholder still needs' : 'Some placeholders still need'}{' '}
              a value. They are shown below and will print exactly as they appear unless you edit
              them.
            </p>
          ) : null}

          <TermList
            terms={resolved}
            onMove={terms.move}
            onRemove={terms.remove}
            onEdit={terms.edit}
            onRevert={terms.revert}
          />
        </div>

        <div className="border-t border-slate-200 pt-5">
          <ClosingParagraphEditor
            value={closingParagraph}
            defaultValue={closingParagraphDefault}
            error={closingParagraphError}
            onChange={onClosingParagraphChange}
          />
        </div>
      </div>

      <CreateTermModal
        open={creating}
        onOpenChange={(next) => {
          setCreating(next);
          if (!next) {
            setCreateError(null);
            setCreateFieldErrors(null);
          }
        }}
        onSubmit={submitNewTerm}
        isSaving={saveToLibrary.isPending}
        error={createError}
        fieldErrors={createFieldErrors}
      />
    </Card>
  );
}
