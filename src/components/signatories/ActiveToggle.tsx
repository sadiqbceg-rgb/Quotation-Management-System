import { Button } from '@/components/common/Button';

export interface ActiveToggleProps {
  personName: string;
  active: boolean;
  isPending: boolean;
  onToggle: (active: boolean) => void;
}

/**
 * Deactivate or reactivate a signatory.
 *
 * Deliberately not called "Delete". The row is never removed: a quotation
 * issued last year names this person, and that document has to stay
 * explicable long after they leave the company.
 */
export function ActiveToggle({ personName, active, isPending, onToggle }: ActiveToggleProps) {
  return (
    <Button
      variant="ghost"
      size="sm"
      isLoading={isPending}
      aria-label={`${active ? 'Deactivate' : 'Reactivate'} ${personName}`}
      onClick={() => {
        onToggle(!active);
      }}
    >
      {active ? 'Deactivate' : 'Reactivate'}
    </Button>
  );
}
