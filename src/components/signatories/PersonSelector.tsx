import { Field } from '@/components/common/Field';
import { Select } from '@/components/common/Select';
import type { AuthorizedPerson } from '@/services/signatories/signatory-service';

export interface PersonSelectorProps {
  persons: readonly AuthorizedPerson[];
  selectedId: string | null;
  error?: string | undefined;
  onSelect: (id: string) => void;
}

/**
 * Choose the signatory for this quotation (PRD §24).
 *
 * Only ACTIVE people with a signature are offered. A person without one is
 * excluded rather than listed-and-disabled — but the count is reported below,
 * because "the person I need is missing" with no explanation is the reason
 * someone gives up and types the details by hand somewhere else.
 */
export function PersonSelector({ persons, selectedId, error, onSelect }: PersonSelectorProps) {
  const selectable = persons.filter((person) => person.selectable);

  const missingSignature = persons.filter((person) => person.active && !person.hasSignature);

  return (
    <div className="flex flex-col gap-2">
      <Field
        label="Authorized person"
        required
        hint="Their details fill in automatically and print in the signature block."
        {...(error === undefined ? {} : { error })}
      >
        {({ id, invalid, describedBy }) => (
          <Select
            id={id}
            value={selectedId ?? ''}
            invalid={invalid}
            aria-describedby={describedBy}
            options={[
              { value: '', label: 'Select a person…' },
              ...selectable.map((person) => ({
                value: person.id,
                label: `${person.name} — ${person.designation}`,
              })),
            ]}
            onChange={(event) => {
              onSelect(event.target.value);
            }}
          />
        )}
      </Field>

      {missingSignature.length > 0 ? (
        <p role="status" className="text-xs text-amber-700">
          {missingSignature.length === 1
            ? `${missingSignature[0]?.name ?? 'One person'} is not listed because they have no signature image yet.`
            : `${String(missingSignature.length)} people are not listed because they have no signature image yet.`}{' '}
          An administrator can upload one on the Authorized Persons page.
        </p>
      ) : null}
    </div>
  );
}
