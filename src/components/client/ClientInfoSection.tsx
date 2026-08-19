import type { UseFormRegister, FieldErrors } from 'react-hook-form';
import { Card } from '@/components/common/Card';
import { CustomerPicker } from '@/components/client/CustomerPicker';
import { Field } from '@/components/common/Field';
import { Input } from '@/components/common/Input';
import { Textarea } from '@/components/common/Textarea';
import type { QuotationFormValues } from '@/schemas/quotation-schema';

export interface ClientInfoSectionProps {
  register: UseFormRegister<QuotationFormValues>;
  errors: FieldErrors<QuotationFormValues>;
  /**
   * Fill the fields below from a saved customer.
   *
   * Optional: omitting it hides the picker and leaves this section exactly as
   * it was, which is what every existing test renders.
   */
  onPickCustomer?: (customer: {
    clientName: string;
    companyName: string;
    address: string;
    contactPerson: string;
    email: string;
    phone: string;
  }) => void;
}

/**
 * Client details.
 *
 * PRD §12 requires the interface to distinguish required from optional fields;
 * the shared `Field` component does that with a marker and an explicit
 * "(optional)" label, so the distinction is never left to placement alone.
 *
 * "Contact Person" is labelled as it appears on the approved quotation —
 * `Attention:` — so the person filling the form sees the same wording the
 * client will see on the document.
 */
export function ClientInfoSection({ register, errors, onPickCustomer }: ClientInfoSectionProps) {
  return (
    <Card
      title="Client Information"
      description="Required fields appear on the quotation header."
      /*
       * The picker PREFILLS these fields; it does not bind them. The quotation
       * stores the values saved here, and no customer id travels with it, so a
       * later edit to the customer record cannot change this quotation.
       */
      actions={
        onPickCustomer === undefined ? undefined : <CustomerPicker onSelect={onPickCustomer} />
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Client Name"
          required
          {...(errors.client?.clientName?.message === undefined
            ? {}
            : { error: errors.client.clientName.message })}
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              invalid={invalid}
              aria-describedby={describedBy}
              {...register('client.clientName')}
            />
          )}
        </Field>

        <Field
          label="Company Name"
          required
          {...(errors.client?.companyName?.message === undefined
            ? {}
            : { error: errors.client.companyName.message })}
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              invalid={invalid}
              aria-describedby={describedBy}
              {...register('client.companyName')}
            />
          )}
        </Field>

        <div className="sm:col-span-2">
          <Field
            label="Address"
            required
            {...(errors.client?.address?.message === undefined
              ? {}
              : { error: errors.client.address.message })}
          >
            {({ id, describedBy, invalid }) => (
              <Textarea
                id={id}
                rows={2}
                invalid={invalid}
                aria-describedby={describedBy}
                {...register('client.address')}
              />
            )}
          </Field>
        </div>

        <Field label="Contact Person" hint="Printed as &ldquo;Attention:&rdquo; on the quotation.">
          {({ id, describedBy }) => (
            <Input id={id} aria-describedby={describedBy} {...register('client.contactPerson')} />
          )}
        </Field>

        <Field
          label="Email"
          {...(errors.client?.email?.message === undefined
            ? {}
            : { error: errors.client.email.message })}
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type="email"
              invalid={invalid}
              aria-describedby={describedBy}
              {...register('client.email')}
            />
          )}
        </Field>

        <Field
          label="Phone"
          {...(errors.client?.phone?.message === undefined
            ? {}
            : { error: errors.client.phone.message })}
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type="tel"
              invalid={invalid}
              aria-describedby={describedBy}
              {...register('client.phone')}
            />
          )}
        </Field>

        <Field label="Project Name">
          {({ id }) => <Input id={id} {...register('client.projectName')} />}
        </Field>

        <Field label="Project Location">
          {({ id }) => <Input id={id} {...register('client.projectLocation')} />}
        </Field>

        <Field label="Client Reference">
          {({ id }) => <Input id={id} {...register('client.clientReference')} />}
        </Field>
      </div>
    </Card>
  );
}
