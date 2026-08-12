import { Button } from '@/components/common/Button';
import { EmptyState } from '@/components/common/EmptyState';
import { Spinner } from '@/components/common/Spinner';
import type { TermTemplate } from '@/services/terms/terms-service';
import { TermCheckbox } from './TermCheckbox';

export interface TermsSelectorProps {
  templates: readonly TermTemplate[];
  isLoading: boolean;
  /** Non-null when the library could not be loaded. Never blocks the quotation. */
  loadError: string | null;
  isSelected: (id: string) => boolean;
  onToggle: (term: TermTemplate) => void;
  onRetry: () => void;
  atTermLimit: boolean;
}

/**
 * Checkbox multi-select over the library (PRD §20).
 *
 * A failed library load is a WARNING, not an error state: the user can still
 * write quotation-local terms and finish the document. Blocking the whole
 * section because a list did not load would cost them the quotation.
 */
export function TermsSelector({
  templates,
  isLoading,
  loadError,
  isSelected,
  onToggle,
  onRetry,
  atTermLimit,
}: TermsSelectorProps) {
  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner label="Loading the Terms & Conditions library" />
      </div>
    );
  }

  if (loadError !== null) {
    return (
      <div
        role="status"
        className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5"
      >
        <p className="text-sm text-amber-900">
          The Terms &amp; Conditions library could not be loaded. You can still add terms for this
          quotation. {loadError}
        </p>
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }

  if (templates.length === 0) {
    return (
      <EmptyState
        title="The Terms & Conditions library is empty"
        description="An administrator can import the company's standard terms from the Terms & Conditions page, or you can add a term for this quotation only."
      />
    );
  }

  return (
    <fieldset className="min-w-0">
      <legend className="sr-only">Select Terms &amp; Conditions</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {templates.map((term) => {
          const checked = isSelected(term.id);
          return (
            <TermCheckbox
              key={term.id}
              term={term}
              checked={checked}
              disabled={atTermLimit && !checked}
              onToggle={onToggle}
            />
          );
        })}
      </div>
    </fieldset>
  );
}
