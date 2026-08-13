import { Select } from '@/components/common/Select';
import { StatusBadge } from '@/components/quotation/StatusBadge';
import { QUOTATION_STATUSES, type QuotationStatus } from '@shared/types';

export interface StatusSelectProps {
  quotationNumber: string;
  status: QuotationStatus;
  disabled?: boolean;
  onChange: (status: QuotationStatus) => void;
}

/**
 * The Status control (PRD §31).
 *
 * A draft — no number yet — gets a BADGE rather than a dropdown. Status belongs
 * to the register, the register is keyed by quotation number, and offering to
 * change the status of something that has no row is offering an action that
 * cannot be carried out.
 *
 * The three values come from the shared union, so this control and the Sheet's
 * own data validation cannot drift apart.
 */
export function StatusSelect({
  quotationNumber,
  status,
  disabled = false,
  onChange,
}: StatusSelectProps) {
  if (quotationNumber.length === 0) {
    return <StatusBadge status={status} />;
  }

  return (
    <Select
      aria-label={`Status for ${quotationNumber}`}
      value={status}
      disabled={disabled}
      options={QUOTATION_STATUSES.map((value) => ({ value, label: value }))}
      onChange={(event) => {
        onChange(event.target.value as QuotationStatus);
      }}
      className="h-8 w-32 text-xs"
    />
  );
}
