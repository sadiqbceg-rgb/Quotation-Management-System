import type { UseFormRegister, FieldErrors, UseFormWatch } from 'react-hook-form';
import { Card } from '@/components/common/Card';
import { Field } from '@/components/common/Field';
import { Input } from '@/components/common/Input';
import { Select } from '@/components/common/Select';
import { Checkbox } from '@/components/common/Checkbox';
import { QuotationNumberField } from './QuotationNumberField';
import type { QuotationFormValues } from '@/schemas/quotation-schema';

export interface QuotationInfoSectionProps {
  register: UseFormRegister<QuotationFormValues>;
  errors: FieldErrors<QuotationFormValues>;
  watch: UseFormWatch<QuotationFormValues>;
  quotationNumber: string | null;
  /** Backdating into a previous year is Admin-only (§26 UR-14). */
  canBackdateAcrossYears: boolean;
}

export function QuotationInfoSection({
  register,
  errors,
  watch,
  quotationNumber,
  canBackdateAcrossYears,
}: QuotationInfoSectionProps) {
  const vatEnabled = watch('vatEnabled');
  const discountEnabled = watch('discountEnabled');
  const quotationDate = watch('quotationDate');

  const currentYear = new Date().getFullYear();
  const selectedYear = Number.parseInt(quotationDate.slice(0, 4), 10);
  const backdatingAcrossYears =
    Number.isFinite(selectedYear) && selectedYear < currentYear && !canBackdateAcrossYears;

  return (
    <Card
      title="Quotation Information"
      description="The quotation number is issued automatically when you save."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <QuotationNumberField quotationNumber={quotationNumber} />

        <Field
          label="Quotation Date"
          required
          hint="Determines the quotation number's year and the Drive folder."
          {...(errors.quotationDate?.message === undefined
            ? {}
            : { error: errors.quotationDate.message })}
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type="date"
              invalid={invalid}
              aria-describedby={describedBy}
              {...register('quotationDate')}
            />
          )}
        </Field>

        <div className="sm:col-span-2">
          <Field
            label="Quotation For"
            required
            hint="Appears prominently at the top of the quotation."
            {...(errors.quotationFor?.message === undefined
              ? {}
              : { error: errors.quotationFor.message })}
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                placeholder="e.g. Manpower Supply – 40 Labours & 1 Supervisor"
                invalid={invalid}
                aria-describedby={describedBy}
                {...register('quotationFor')}
              />
            )}
          </Field>
        </div>

        {backdatingAcrossYears ? (
          <p role="alert" className="text-brand-red sm:col-span-2 text-xs">
            Only an administrator can date a quotation into a previous year, because it draws from
            that year&apos;s number sequence.
          </p>
        ) : null}

        <Field label="Pricing" required hint="Rate-only omits amounts and totals.">
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              options={[
                { value: 'amount', label: 'Quantity x rate, with totals' },
                { value: 'rate-only', label: 'Rates only, no totals' },
              ]}
              {...register('pricingMode')}
            />
          )}
        </Field>

        <div className="flex flex-col justify-end gap-3 pb-1">
          <Checkbox
            label="Apply VAT"
            description="15% is the standard KSA rate."
            {...register('vatEnabled')}
          />
          {vatEnabled ? (
            <Field label="VAT rate (%)" required>
              {({ id }) => (
                <Input
                  id={id}
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  {...register('vatRatePercent', { valueAsNumber: true })}
                />
              )}
            </Field>
          ) : null}

          <Checkbox label="Apply a discount" {...register('discountEnabled')} />
          {discountEnabled ? (
            <Field label="Discount rate (%)" required>
              {({ id }) => (
                <Input
                  id={id}
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  {...register('discountRatePercent', { valueAsNumber: true })}
                />
              )}
            </Field>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
