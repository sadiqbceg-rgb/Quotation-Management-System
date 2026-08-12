import { Spinner } from '@/components/common/Spinner';
import type { SignatureState } from '@/hooks/useAuthorizedPersons';
import type { AuthorizedPerson } from '@/services/signatories/signatory-service';
import { SignaturePreview } from './SignaturePreview';

export interface PersonDetailsCardProps {
  person: AuthorizedPerson;
  signature: SignatureState;
  onRetrySignature: () => void;
}

/**
 * The selected signatory's details, as they will print.
 *
 * PRD §24: "The user must not have to manually type these details." So these
 * are rendered as TEXT, not as disabled inputs. A disabled input still exists
 * in the DOM as a form control and invites the question of whether it can be
 * enabled; plain text cannot be edited at all, which is the actual requirement.
 *
 * The order matches the approved quotation's signature block: name,
 * designation, company, country, then mobile and email.
 */
export function PersonDetailsCard({
  person,
  signature,
  onRetrySignature,
}: PersonDetailsCardProps) {
  const lines: Array<{ label: string; value: string }> = [
    { label: 'Name', value: person.name },
    { label: 'Designation', value: person.designation },
    { label: 'Company', value: person.companyName },
    { label: 'Country', value: person.country },
    { label: 'Mobile', value: person.phone },
    { label: 'Email', value: person.email },
  ];

  return (
    <div className="flex flex-wrap items-start justify-between gap-6 rounded-md border border-slate-200 px-4 py-3">
      <dl className="min-w-0 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        {lines.map((line) => (
          <div key={line.label} className="contents">
            <dt className="text-slate-500">{line.label}</dt>
            <dd className="font-medium text-slate-900">{line.value}</dd>
          </div>
        ))}
      </dl>

      <div className="shrink-0">
        {signature.status === 'loading' ? (
          <Spinner label="Loading the signature" />
        ) : signature.status === 'ready' ? (
          <SignaturePreview image={signature.image} personName={person.name} />
        ) : signature.status === 'error' ? (
          <div className="max-w-xs">
            {/*
              A failure is stated plainly and blocks document generation. A
              quotation that quietly went out with no signature would be worse
              than one that refused to generate.
            */}
            <p role="alert" className="text-brand-red text-sm">
              The signature image could not be loaded, so this quotation cannot be issued yet.{' '}
              {signature.message}
            </p>
            <button
              type="button"
              className="text-brand-navy mt-1 text-sm underline"
              onClick={onRetrySignature}
            >
              Try again
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
