import { useState } from 'react';

import { Button } from '@/components/common/Button';
import { Checkbox } from '@/components/common/Checkbox';
import { Field } from '@/components/common/Field';
import { Input } from '@/components/common/Input';
import { Modal } from '@/components/common/Modal';
import { Select } from '@/components/common/Select';
import { Textarea } from '@/components/common/Textarea';
import { TERM_CATEGORIES, validateTermForm } from '@/schemas/term-schema';
import type { TermCategory } from '@/services/terms/terms-service';

export interface CreateTermSubmit {
  title: string;
  bodyTemplate: string;
  category: TermCategory;
  /** PRD §21: explicit, and unchecked by default. */
  saveToLibrary: boolean;
}

export interface CreateTermModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: CreateTermSubmit) => void;
  isSaving?: boolean;
  /** A server-side failure, shown without discarding what the user typed. */
  error?: string | null;
  fieldErrors?: Record<string, string> | null;
}

/**
 * "+ Create New Term" (PRD §21).
 *
 * "Save to Library" starts UNCHECKED. A term written for one client's quotation
 * is the normal case; promoting it to the company's standard terms is the
 * exception, and it should take a deliberate click rather than happen because
 * nobody noticed a pre-ticked box.
 *
 * A failed save keeps the modal open with the content intact — losing a
 * paragraph someone just wrote is not an acceptable way to report an error.
 */
export function CreateTermModal({
  open,
  onOpenChange,
  onSubmit,
  isSaving = false,
  error = null,
  fieldErrors = null,
}: CreateTermModalProps) {
  const [title, setTitle] = useState('');
  const [bodyTemplate, setBodyTemplate] = useState('');
  const [category, setCategory] = useState<TermCategory>('General');
  const [saveToLibrary, setSaveToLibrary] = useState(false);
  const [localErrors, setLocalErrors] = useState<Record<string, string> | null>(null);

  const errors = localErrors ?? fieldErrors;

  const reset = (): void => {
    setTitle('');
    setBodyTemplate('');
    setCategory('General');
    setSaveToLibrary(false);
    setLocalErrors(null);
  };

  const submit = (): void => {
    const values = { title: title.trim(), bodyTemplate: bodyTemplate.trim() };
    const problems = validateTermForm(values);

    if (problems !== null) {
      setLocalErrors(problems);
      return;
    }

    setLocalErrors(null);
    onSubmit({ ...values, category, saveToLibrary });
  };

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      title="Create a new term"
      description="Added to this quotation immediately. It reaches the library only if you ask it to."
      size="lg"
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button isLoading={isSaving} onClick={submit}>
            Add term
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

        <Field
          label="Term name"
          required
          {...(errors?.['title'] === undefined ? {} : { error: errors['title'] })}
        >
          {({ id, invalid, describedBy }) => (
            <Input
              id={id}
              value={title}
              invalid={invalid}
              aria-describedby={describedBy}
              onChange={(event) => {
                setTitle(event.target.value);
                setLocalErrors(null);
              }}
            />
          )}
        </Field>

        <Field
          label="Term content"
          required
          hint="Plain text. Whitelisted {{tokens}} are filled in when the document is produced."
          {...(errors?.['bodyTemplate'] === undefined ? {} : { error: errors['bodyTemplate'] })}
        >
          {({ id, invalid, describedBy }) => (
            <Textarea
              id={id}
              rows={6}
              value={bodyTemplate}
              invalid={invalid}
              aria-describedby={describedBy}
              onChange={(event) => {
                setBodyTemplate(event.target.value);
                setLocalErrors(null);
              }}
            />
          )}
        </Field>

        <Field label="Category">
          {({ id }) => (
            <Select
              id={id}
              value={category}
              options={TERM_CATEGORIES.map((entry) => ({ value: entry, label: entry }))}
              onChange={(event) => {
                setCategory(event.target.value as TermCategory);
              }}
            />
          )}
        </Field>

        <Checkbox
          label="Save to Library"
          description="Makes this term available on every future quotation. Leave it unticked to use it only here."
          checked={saveToLibrary}
          onChange={(event) => {
            setSaveToLibrary(event.target.checked);
          }}
        />
      </div>
    </Modal>
  );
}
