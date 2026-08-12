import type { InputHTMLAttributes } from 'react';
import { cn } from '@/utils/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const inputClasses = (invalid = false, className?: string): string =>
  cn(
    'h-10 w-full rounded-md border bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400',
    'focus:border-brand-navy focus:ring-brand-navy/20 focus:ring-2 focus:outline-none',
    'disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500',
    'read-only:bg-slate-50 read-only:text-slate-600',
    invalid ? 'border-brand-red' : 'border-slate-300',
    className,
  );

export function Input({ invalid = false, className, ...rest }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={inputClasses(invalid, className)}
      {...rest}
    />
  );
}
