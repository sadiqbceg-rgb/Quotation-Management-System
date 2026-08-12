import { Button } from '@/components/common/Button';
import type { AuthorizedPerson } from '@/services/signatories/signatory-service';
import { ActiveToggle } from './ActiveToggle';

export interface PersonListProps {
  persons: readonly AuthorizedPerson[];
  pendingId: string | null;
  onEdit: (person: AuthorizedPerson) => void;
  onManageSignature: (person: AuthorizedPerson) => void;
  onToggleActive: (person: AuthorizedPerson, active: boolean) => void;
}

/**
 * The signatory library.
 *
 * A person with no signature is shown with the reason stated, not hidden. PRD
 * §24 requires exactly that: they are listed but not selectable, and an Admin
 * needs to see which records are incomplete in order to fix them.
 */
export function PersonList({
  persons,
  pendingId,
  onEdit,
  onManageSignature,
  onToggleActive,
}: PersonListProps) {
  return (
    <ul className="flex flex-col gap-2">
      {persons.map((person) => (
        <li
          key={person.id}
          className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-slate-200 px-3 py-2.5"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-slate-900">{person.name}</span>
              <span className="text-sm text-slate-500">{person.designation}</span>

              {person.active ? null : (
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                  Inactive
                </span>
              )}

              {person.hasSignature ? (
                <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700">
                  Signature on file
                </span>
              ) : (
                <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800">
                  No signature — cannot be selected on a quotation
                </span>
              )}
            </div>

            <p className="mt-0.5 text-xs text-slate-500">
              {person.companyName} · {person.country} · {person.phone} · {person.email}
            </p>
          </div>

          <div className="flex shrink-0 gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onManageSignature(person);
              }}
            >
              {person.hasSignature ? 'Replace signature' : 'Add signature'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onEdit(person);
              }}
            >
              Edit
            </Button>
            <ActiveToggle
              personName={person.name}
              active={person.active}
              isPending={pendingId === person.id}
              onToggle={(active) => {
                onToggleActive(person, active);
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
