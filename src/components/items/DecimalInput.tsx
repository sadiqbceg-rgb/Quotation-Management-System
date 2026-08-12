import { useEffect, useRef, useState } from 'react';
import { cn } from '@/utils/cn';
import type { ParseResult } from '@/utils/parse-decimal';

export interface DecimalInputProps<T extends number> {
  /** The stored integer minor-unit value. */
  value: T;
  /** Render the stored value back to display text. */
  format: (value: T) => string;
  /** Parse typed text into the stored value. */
  parse: (text: string) => ParseResult<T>;
  /** Human message for a parse failure. */
  describe: (reason: Exclude<ParseResult<T>, { ok: true }>['reason']) => string;
  onChange: (value: T) => void;
  /** Reported so the row can mark itself invalid and block export. */
  onValidityChange?: (message: string | null) => void;
  label: string;
  placeholder?: string;
  className?: string;
  /** Suppress the error while the row is still blank and untouched. */
  allowEmptyWhileUntouched?: boolean;
}

/**
 * A numeric input over an integer minor-unit value.
 *
 * It holds the typed TEXT locally rather than reformatting on every keystroke.
 * Without that, typing "1." or "20.0" is impossible: the value round-trips
 * through the integer store and the trailing separator is erased under the
 * cursor. The stored value updates only when the text parses.
 */
export function DecimalInput<T extends number>({
  value,
  format,
  parse,
  describe,
  onChange,
  onValidityChange,
  label,
  placeholder,
  className,
  allowEmptyWhileUntouched = true,
}: DecimalInputProps<T>) {
  const [text, setText] = useState(() => format(value));
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-sync when the value changes from outside (a library pick, a reset).
  const lastEmitted = useRef<T>(value);
  useEffect(() => {
    if (value !== lastEmitted.current) {
      lastEmitted.current = value;
      setText(format(value));
    }
  }, [value, format]);

  const report = (message: string | null): void => {
    setError(message);
    onValidityChange?.(message);
  };

  const handleChange = (next: string): void => {
    setText(next);

    const result = parse(next);
    if (result.ok) {
      lastEmitted.current = result.value;
      onChange(result.value);
      report(null);
      return;
    }

    if (result.reason === 'empty' && allowEmptyWhileUntouched && !touched) {
      report(null);
      return;
    }

    report(describe(result.reason));
  };

  return (
    <div className={cn('flex flex-col gap-0.5', className)}>
      <input
        type="text"
        inputMode="decimal"
        aria-label={label}
        aria-invalid={error !== null || undefined}
        value={text}
        placeholder={placeholder}
        onChange={(event) => {
          handleChange(event.target.value);
        }}
        onBlur={() => {
          setTouched(true);
          const result = parse(text);
          if (result.ok) {
            // Normalise on blur: "20.5" stays, "20.50" tidies to the stored form.
            setText(format(result.value));
          } else {
            report(describe(result.reason));
          }
        }}
        className={cn(
          'h-9 w-full rounded-md border bg-white px-2 text-right text-sm tabular-nums',
          'focus:border-brand-navy focus:ring-brand-navy/20 focus:ring-2 focus:outline-none',
          error === null ? 'border-slate-300' : 'border-brand-red',
        )}
      />
      {error === null ? null : (
        <span role="alert" className="text-brand-red text-[11px]">
          {error}
        </span>
      )}
    </div>
  );
}
