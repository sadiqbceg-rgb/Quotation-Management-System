import { useState } from 'react';

import { Button } from '@/components/common/Button';
import { Field } from '@/components/common/Field';
import { Input } from '@/components/common/Input';
import { Modal } from '@/components/common/Modal';
import {
  emptyPersonForm,
  validatePersonForm,
  type PersonFormValues,
} from '@/schemas/person-schema';

export interface PersonFormProps {
  open: boolean;
  /** Present when editing; absent when creating. */
  initialValues?: PersonFormValues;
  isSaving: boolean;
  error?: string | null;
  fieldErrors?: Record<string, string> | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: PersonFormValues) => void;
}

/**
 * Create or edit an authorized person (PRD §24).
 *
 * `country` is here even though PRD §24 does not list it: the approved
 * quotation's signature block prints "Kingdom of Saudi Arabia" beneath the
 * company, so the field exists in the real document and therefore in the record
 * (IMPLEMENTATION_PLAN.md §11.1).
 *
 * These are the six lines that will be printed under the signature, so all six
 * are required — a blank one is a visible gap in a document already sent.
 */
export function PersonForm({
  open,
  initialValues,
  isSaving,
  error = null,
  fieldErrors = null,
  onOpenChange,
  onSubmit,
}: PersonFormProps) {
  const [values, setValues] = useState<PersonFormValues>(initialValues ?? emptyPersonForm());
  const [localErrors, setLocalErrors] = useState<Record<string, string> | null>(null);

  const errors = localErrors ?? fieldErrors;
  const isEditing = initialValues !== undefined;

  const set = (key: keyof PersonFormValues, value: string): void => {
    setValues((current) => ({ ...current, [key]: value }));
    setLocalErrors(null);
  };

  const submit = (): void => {
    const problems = validatePersonForm(values);
    if (problems !== null) {
      setLocalErrors(problems);
      return;
    }
    onSubmit(values);
  };

  const fields: Array<{ key: keyof PersonFormValues; label: string; type?: string }> = [
    { key: 'name', label: 'Name' },
    { key: 'designation', label: 'Designation' },
    { key: 'companyName', label: 'Company name' },
    { key: 'country', label: 'Country' },
    { key: 'email', label: 'Email', type: 'email' },
    { key: 'phone', label: 'Phone', type: 'tel' },
  ];

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={isEditing ? 'Edit authorized person' : 'Add an authorized person'}
      description="These six lines are printed in the signature block of every quotation this person signs."
      size="lg"
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button isLoading={isSaving} onClick={submit}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error !== null ? (
          <p role="alert" className="text-brand-red text-sm">
            {error}
          </p>
        ) : null}

        {fields.map((field) => (
          <Field
            key={field.key}
            label={field.label}
            required
            {...(errors?.[field.key] === undefined ? {} : { error: errors[field.key] })}
          >
            {({ id, invalid, describedBy }) => (
              <Input
                id={id}
                type={field.type ?? 'text'}
                value={values[field.key]}
                invalid={invalid}
                aria-describedby={describedBy}
                onChange={(event) => {
                  set(field.key, event.target.value);
                }}
              />
            )}
          </Field>
        ))}
      </div>
    </Modal>
  );
}
