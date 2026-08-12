import type { SelectHTMLAttributes } from 'react';
import { cn } from '@/utils/cn';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  options: readonly SelectOption[];
  placeholder?: string;
  invalid?: boolean;
}

/**
 * A native `<select>`.
 *
 * Deliberately native rather than a custom listbox: it is fully accessible with
 * no extra work, keyboard- and screen-reader-friendly by default, and matches
 * PRD §38's "simple, fast, easy for non-technical staff". Radix is reserved for
 * the cases the platform does not cover, such as the modal in PRD §21.
 */
export function Select({
  options,
  placeholder,
  invalid = false,
  className,
  value,
  ...rest
}: SelectProps) {
  return (
    <select
      value={value}
      aria-invalid={invalid || undefined}
      className={cn(
        'h-10 w-full rounded-md border bg-white px-3 text-sm text-slate-900',
        'focus:border-brand-navy focus:ring-brand-navy/20 focus:ring-2 focus:outline-none',
        'disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500',
        invalid ? 'border-brand-red' : 'border-slate-300',
        className,
      )}
      {...rest}
    >
      {placeholder !== undefined ? (
        <option value="" disabled>
          {placeholder}
        </option>
      ) : null}
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled ?? false}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
