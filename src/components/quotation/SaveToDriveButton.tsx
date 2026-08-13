import { Button } from '@/components/common/Button';

export interface SaveToDriveButtonProps {
  disabled: boolean;
  isSaving: boolean;
  /** True once the documents are filed; the button then offers to re-save. */
  isSaved: boolean;
  onSave: () => void;
}

/**
 * `Save to Google Drive` (PRD §29).
 *
 * After a successful save it stays enabled and reads `Save Again`, because
 * re-saving is a real operation — the quotation may have been corrected — and
 * it is safe by construction: replace-in-place means a second save overwrites
 * the same two files rather than adding a copy (§16.4).
 */
export function SaveToDriveButton({
  disabled,
  isSaving,
  isSaved,
  onSave,
}: SaveToDriveButtonProps) {
  return (
    <Button
      disabled={disabled}
      isLoading={isSaving}
      onClick={onSave}
      {...(disabled
        ? { title: 'Resolve the items listed above before the quotation can be exported.' }
        : {})}
    >
      {isSaved ? 'Save to Google Drive Again' : 'Save to Google Drive'}
    </Button>
  );
}
