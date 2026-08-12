import type { ReactNode } from 'react';
import { useId } from 'react';
import { cn } from '@/utils/cn';

export interface FieldProps {
  label: string;
  /**
   * PRD §12 requires required and optional fields to be visually distinguished.
   * Required fields carry a marker; optional fields carry an explicit "(optional)".
   */
  required?: boolean;
  hint?: string;
  error?: string;
  className?: string;
  children: (props: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}

export function Field({ label, required = false, hint, error, className, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  const describedBy =
    [error !== undefined ? errorId : null, hint !== undefined ? hintId : null]
      .filter((value): value is string => value !== null)
      .join(' ') || undefined;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-slate-700">
        {label}
        {required ? (
          <span className="text-brand-red ml-1" aria-hidden="true">
            *
          </span>
        ) : (
          <span className="ml-1 font-normal text-slate-400">(optional)</span>
        )}
      </label>

      {children({ id, describedBy, invalid: error !== undefined })}

      {hint !== undefined ? (
        <p id={hintId} className="text-xs text-slate-500">
          {hint}
        </p>
      ) : null}

      {error !== undefined ? (
        <p id={errorId} role="alert" className="text-brand-red text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}
