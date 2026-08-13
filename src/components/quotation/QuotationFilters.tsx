import { Input } from '@/components/common/Input';
import { Select } from '@/components/common/Select';
import type { StatusFilter } from '@/hooks/useQuotationTracking';
import { QUOTATION_STATUSES } from '@shared/types';

export interface QuotationFiltersProps {
  search: string;
  status: StatusFilter;
  onSearchChange: (value: string) => void;
  onStatusChange: (value: StatusFilter) => void;
}

/**
 * Search and status filter for the register.
 *
 * Both are client-side over the loaded rows: the register is a few hundred rows
 * in V1, and a round trip per keystroke would be slower and would spend the
 * Apps Script execution budget on something the browser can do instantly.
 */
export function QuotationFilters({
  search,
  status,
  onSearchChange,
  onStatusChange,
}: QuotationFiltersProps) {
  return (
    <div className="flex gap-2">
      <Input
        value={search}
        onChange={(event) => {
          onSearchChange(event.target.value);
        }}
        placeholder="Search"
        aria-label="Search quotations"
        className="h-8 w-48 text-xs"
      />
      <Select
        value={status}
        aria-label="Filter by status"
        options={[
          { value: 'all', label: 'All statuses' },
          ...QUOTATION_STATUSES.map((value) => ({ value, label: value })),
        ]}
        onChange={(event) => {
          onStatusChange(event.target.value as StatusFilter);
        }}
        className="h-8 w-36 text-xs"
      />
    </div>
  );
}
