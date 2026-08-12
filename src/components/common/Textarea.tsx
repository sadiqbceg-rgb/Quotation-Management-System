import type { TextareaHTMLAttributes } from 'react';
import { cn } from '@/utils/cn';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export function Textarea({ invalid = false, className, rows = 4, ...rest }: TextareaProps) {
  return (
    <textarea
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(
        'w-full rounded-md border bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400',
        'focus:border-brand-navy focus:ring-brand-navy/20 focus:ring-2 focus:outline-none',
        'disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500',
        invalid ? 'border-brand-red' : 'border-slate-300',
        className,
      )}
      {...rest}
    />
  );
}
