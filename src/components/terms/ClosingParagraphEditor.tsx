import { Button } from '@/components/common/Button';
import { Field } from '@/components/common/Field';
import { Textarea } from '@/components/common/Textarea';
import { TEXT_LIMITS } from '@shared/validation-rules';

export interface ClosingParagraphEditorProps {
  value: string;
  /** The Company Settings default, so "restore" has something true to restore. */
  defaultValue: string;
  error?: string | undefined;
  onChange: (value: string) => void;
}

/**
 * The closing paragraph (PRD §23).
 *
 * Plain text, not rich text: the value is rendered into a PDF and a DOCX by two
 * different writers, and plain text is the only representation both reproduce
 * identically. Blank lines separate paragraphs.
 *
 * Editing here changes THIS quotation. The Company Settings default is
 * unaffected, which is why the restore action exists.
 */
export function ClosingParagraphEditor({
  value,
  defaultValue,
  error,
  onChange,
}: ClosingParagraphEditorProps) {
  const isDefault = value.trim() === defaultValue.trim();

  return (
    <Field
      label="Closing paragraph"
      required
      hint={`Appears after the terms, above the signature block. Editing it here does not change the company default. Up to ${String(TEXT_LIMITS.closingParagraph.max)} characters.`}
      {...(error === undefined ? {} : { error })}
    >
      {({ id, invalid, describedBy }) => (
        <div className="flex flex-col gap-2">
          <Textarea
            id={id}
            rows={6}
            value={value}
            invalid={invalid}
            aria-describedby={describedBy}
            onChange={(event) => {
              onChange(event.target.value);
            }}
          />
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              disabled={isDefault}
              onClick={() => {
                onChange(defaultValue);
              }}
            >
              Restore the company default
            </Button>
          </div>
        </div>
      )}
    </Field>
  );
}
