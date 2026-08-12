import { Checkbox } from '@/components/common/Checkbox';
import type { TermTemplate } from '@/services/terms/terms-service';

export interface TermCheckboxProps {
  term: TermTemplate;
  checked: boolean;
  disabled?: boolean;
  onToggle: (term: TermTemplate) => void;
}

/** Truncate the body for the checkbox description, without cutting mid-word. */
function preview(text: string, limit = 110): string {
  const single = text.replace(/\s+/g, ' ').trim();
  if (single.length <= limit) return single;

  const cut = single.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  return `${lastSpace > 40 ? cut.slice(0, lastSpace) : cut}…`;
}

/**
 * One selectable library term (PRD §20).
 *
 * The description shows the template text with its `{{tokens}}` unresolved on
 * purpose: at selection time there is often no client or number yet, and
 * showing a resolved-looking body with blanks in it would misrepresent what the
 * term will say.
 */
export function TermCheckbox({ term, checked, disabled = false, onToggle }: TermCheckboxProps) {
  return (
    <Checkbox
      label={term.title}
      description={preview(term.bodyTemplate)}
      checked={checked}
      disabled={disabled}
      onChange={() => {
        onToggle(term);
      }}
    />
  );
}
