import { useState } from 'react';

import { Button } from '@/components/common/Button';
import { Field } from '@/components/common/Field';
import { Input } from '@/components/common/Input';
import { Textarea } from '@/components/common/Textarea';
import { validateTermForm } from '@/schemas/term-schema';

export interface EditTermInlineProps {
  title: string;
  bodyTemplate: string;
  onSave: (values: { title: string; bodyTemplate: string }) => void;
  onCancel: () => void;
}

/**
 * Edit a term for THIS quotation only (PRD §22).
 *
 * There is no "also update the library" affordance here, deliberately. That
 * change belongs on the Terms & Conditions page, where the user can see it is
 * a library-wide edit; offering it mid-quotation is how someone silently
 * rewrites a standard term for every future document.
 */
export function EditTermInline({ title, bodyTemplate, onSave, onCancel }: EditTermInlineProps) {
  const [draftTitle, setDraftTitle] = useState(title);
  const [draftBody, setDraftBody] = useState(bodyTemplate);
  const [errors, setErrors] = useState<Record<string, string> | null>(null);

  const save = (): void => {
    const values = { title: draftTitle.trim(), bodyTemplate: draftBody.trim() };
    const problems = validateTermForm(values);

    if (problems !== null) {
      setErrors(problems);
      return;
    }

    onSave(values);
  };

  return (
    <div className="flex flex-col gap-3">
      <Field
        label="Term name"
        required
        {...(errors?.['title'] === undefined ? {} : { error: errors['title'] })}
      >
        {({ id, invalid, describedBy }) => (
          <Input
            id={id}
            value={draftTitle}
            invalid={invalid}
            aria-describedby={describedBy}
            onChange={(event) => {
              setDraftTitle(event.target.value);
              setErrors(null);
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
            rows={5}
            value={draftBody}
            invalid={invalid}
            aria-describedby={describedBy}
            onChange={(event) => {
              setDraftBody(event.target.value);
              setErrors(null);
            }}
          />
        )}
      </Field>

      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={save}>
          Apply to this quotation
        </Button>
      </div>
    </div>
  );
}
