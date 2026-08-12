import type { InputHTMLAttributes } from 'react';
import { useId } from 'react';
import { cn } from '@/utils/cn';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string;
  description?: string;
}

/**
 * A native checkbox with a label.
 *
 * Used for Terms & Conditions selection in PRD §20, so it must stay keyboard
 * accessible and announce its description to screen readers.
 */
export function Checkbox({ label, description, className, id, ...rest }: CheckboxProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const descriptionId = `${inputId}-description`;

  return (
    <div className={cn('flex items-start gap-2.5', className)}>
      <input
        id={inputId}
        type="checkbox"
        aria-describedby={description === undefined ? undefined : descriptionId}
        className={cn(
          'accent-brand-navy mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-slate-300',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
        {...rest}
      />
      <div className="min-w-0">
        <label htmlFor={inputId} className="cursor-pointer text-sm text-slate-800">
          {label}
        </label>
        {description !== undefined ? (
          <p id={descriptionId} className="mt-0.5 text-xs text-slate-500">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}
