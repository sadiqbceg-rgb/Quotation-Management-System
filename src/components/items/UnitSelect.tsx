import { useState } from 'react';
import type { ItemCategory } from '@shared/types';
import { PATTERNS, TEXT_LIMITS } from '@shared/validation-rules';
import { CUSTOM_UNIT_VALUE, isCustomUnit, unitsForCategory } from '@/config/units';
import { cn } from '@/utils/cn';

export interface UnitSelectProps {
  category: ItemCategory;
  value: string;
  onChange: (unit: string) => void;
}

/**
 * Unit picker with a custom option.
 *
 * PRD §14–§16 list seeded units per category and require them to stay
 * configurable, including a free-text "Custom" entry. A custom unit applies to
 * this quotation only — it is not written back into the master list, because a
 * typo would otherwise become permanent company configuration.
 */
export function UnitSelect({ category, value, onChange }: UnitSelectProps) {
  const options = unitsForCategory(category);
  const [custom, setCustom] = useState(() => (isCustomUnit(category, value) ? value : ''));
  const [showCustom, setShowCustom] = useState(() => isCustomUnit(category, value));

  const invalidCustom =
    showCustom && custom.trim().length > 0 && !PATTERNS.customUnit.test(custom.trim());

  return (
    <div className="flex flex-col gap-1">
      <select
        aria-label="Unit"
        value={showCustom ? CUSTOM_UNIT_VALUE : value}
        onChange={(event) => {
          if (event.target.value === CUSTOM_UNIT_VALUE) {
            setShowCustom(true);
            onChange(custom.trim());
            return;
          }
          setShowCustom(false);
          onChange(event.target.value);
        }}
        className={cn(
          'h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm',
          'focus:border-brand-navy focus:ring-brand-navy/20 focus:ring-2 focus:outline-none',
        )}
      >
        {options.map((unit) => (
          <option key={unit} value={unit}>
            {unit}
          </option>
        ))}
        <option value={CUSTOM_UNIT_VALUE}>Custom…</option>
      </select>

      {showCustom ? (
        <>
          <input
            type="text"
            aria-label="Custom unit"
            value={custom}
            maxLength={TEXT_LIMITS.unit.max}
            placeholder="e.g. Shift"
            aria-invalid={invalidCustom || undefined}
            onChange={(event) => {
              setCustom(event.target.value);
              onChange(event.target.value.trim());
            }}
            className={cn(
              'h-9 w-full rounded-md border bg-white px-2 text-sm',
              'focus:border-brand-navy focus:ring-brand-navy/20 focus:ring-2 focus:outline-none',
              invalidCustom ? 'border-brand-red' : 'border-slate-300',
            )}
          />
          {invalidCustom ? (
            <span role="alert" className="text-brand-red text-[11px]">
              Enter a short unit without symbols
            </span>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
