import { EmptyState } from './EmptyState';

export interface PhasePlaceholderProps {
  /** The implementation phase that will build this section. */
  phase: string;
  feature: string;
}

/**
 * A genuine "not built yet" marker for a route that exists but whose feature
 * belongs to a later phase.
 *
 * This is deliberately NOT sample content. PRD §34 forbids demo quotations,
 * fake clients and placeholder customer data; an honest empty state is the
 * correct thing to render until the owning phase implements the section.
 */
export function PhasePlaceholder({ phase, feature }: PhasePlaceholderProps) {
  return (
    <EmptyState
      title={`${feature} is not implemented yet`}
      description={`This section is built in Phase ${phase}. No sample or demo data is shown here by design.`}
    />
  );
}
