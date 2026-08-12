import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { EmptyState } from '@/components/common/EmptyState';
import { Spinner } from '@/components/common/Spinner';
import type { UseAuthorizedPersonsResult } from '@/hooks/useAuthorizedPersons';
import { PersonDetailsCard } from './PersonDetailsCard';
import { PersonSelector } from './PersonSelector';

export interface AuthorizedPersonSectionProps {
  signatories: UseAuthorizedPersonsResult;
  error?: string | undefined;
}

/**
 * The Authorized Person section of the quotation form (PRD §24).
 *
 * Selecting a person fills every display field automatically and renders them
 * read-only, then fetches the signature through the authenticated endpoint.
 *
 * This phase supplies the DATA — six text lines and the image bytes — and
 * records the layout intent (details on the left, seal and signature on the
 * right, per the approved document). The geometry itself is Phase 07's.
 */
export function AuthorizedPersonSection({ signatories, error }: AuthorizedPersonSectionProps) {
  return (
    <Card
      title="Authorized Person"
      description="Who signs this quotation. Their details are filled in for you and printed in the signature block."
    >
      {signatories.isLoading ? (
        <div className="flex justify-center py-8">
          <Spinner label="Loading authorized persons" />
        </div>
      ) : signatories.loadError !== null ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5"
        >
          <p className="text-sm text-amber-900">
            The authorized persons could not be loaded. {signatories.loadError}
          </p>
          <Button variant="secondary" size="sm" onClick={signatories.refetch}>
            Try again
          </Button>
        </div>
      ) : signatories.persons.length === 0 ? (
        <EmptyState
          title="No authorized persons yet"
          description="An administrator adds signatories and uploads their signature images on the Authorized Persons page. A quotation cannot be issued without one."
        />
      ) : (
        <div className="flex flex-col gap-4">
          <PersonSelector
            persons={signatories.persons}
            selectedId={signatories.selected?.id ?? null}
            error={error}
            onSelect={signatories.select}
          />

          {signatories.selected === null ? null : (
            <PersonDetailsCard
              person={signatories.selected}
              signature={signatories.signature}
              onRetrySignature={() => {
                signatories.select(signatories.selected?.id ?? '');
              }}
            />
          )}
        </div>
      )}
    </Card>
  );
}
