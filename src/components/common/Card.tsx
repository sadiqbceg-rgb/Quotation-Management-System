import type { ReactNode } from 'react';
import { cn } from '@/utils/cn';

export interface CardProps {
  title?: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}

/**
 * A plain bordered container used to group a form section.
 *
 * PRD §38 warns against "excessive cards", so this is intentionally flat:
 * a hairline border, no shadow, no gradient, no decoration.
 */
export function Card({
  title,
  description,
  actions,
  className,
  bodyClassName,
  children,
}: CardProps) {
  const hasHeader = title !== undefined || actions !== undefined;

  return (
    <section className={cn('rounded-lg border border-slate-200 bg-white', className)}>
      {hasHeader ? (
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-3.5">
          <div className="min-w-0">
            {title !== undefined ? (
              <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
            ) : null}
            {description !== undefined ? (
              <p className="mt-0.5 text-xs text-slate-500">{description}</p>
            ) : null}
          </div>
          {actions !== undefined ? <div className="shrink-0">{actions}</div> : null}
        </header>
      ) : null}
      <div className={cn('px-5 py-4', bodyClassName)}>{children}</div>
    </section>
  );
}
