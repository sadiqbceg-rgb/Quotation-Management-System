import type { ReactNode } from 'react';
import { cn } from '@/utils/cn';

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

/**
 * Shown when a list genuinely has no records.
 *
 * The production system starts with zero quotations, zero clients, zero items,
 * zero terms and zero authorized persons (PRD §34). An empty state is the
 * correct thing to render — never placeholder or demo rows.
 */
export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 px-6 py-12 text-center',
        className,
      )}
    >
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {description !== undefined ? (
        <p className="mt-1 max-w-md text-sm text-slate-500">{description}</p>
      ) : null}
      {action !== undefined ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
