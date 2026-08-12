/**
 * "Modified for this quotation" marker (PRD §22).
 *
 * The whole point of a quotation-local edit is that the library is untouched,
 * which is invisible unless the UI says so. Without this badge a user who edits
 * a term here would reasonably assume they had changed it everywhere.
 */
export interface TermOverrideBadgeProps {
  source: 'library' | 'library-overridden' | 'quotation-local';
}

const LABELS = {
  'library-overridden': {
    text: 'Modified for this quotation',
    title: 'The master library copy of this term is unchanged.',
    className: 'bg-amber-50 text-amber-800 ring-amber-200',
  },
  'quotation-local': {
    text: 'This quotation only',
    title: 'Created here. It is not in the Terms & Conditions library.',
    className: 'bg-slate-100 text-slate-600 ring-slate-200',
  },
} as const;

export function TermOverrideBadge({ source }: TermOverrideBadgeProps) {
  if (source === 'library') return null;

  const label = LABELS[source];

  return (
    <span
      title={label.title}
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${label.className}`}
    >
      {label.text}
    </span>
  );
}
