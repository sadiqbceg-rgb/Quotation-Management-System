import { Button } from '@/components/common/Button';
import { SaveToDriveButton } from '@/components/quotation/SaveToDriveButton';

export interface PreviewToolbarProps {
  quotationNumber: string;
  pageCount: number;
  canExport: boolean;
  onBack: () => void;
  onPrint: () => void;
  /** Enabled in Phase 08. */
  onSavePdf: () => void;
  isSavingPdf: boolean;
  /** Enabled in Phase 09. */
  onSaveWord: () => void;
  isSavingWord: boolean;
  /** Enabled in Phase 10. */
  onSaveToDrive: () => void;
  isSavingToDrive: boolean;
  /** True once the documents are filed; the button then offers to re-save. */
  isSavedToDrive: boolean;
  showDiscardDraft?: boolean;
  onDiscardDraft?: () => void;
  isDiscardingDraft?: boolean;
}

/**
 * Preview actions (PRD §29).
 *
 * Every action the PRD promises is now live. All three exports share ONE
 * disabled condition — an incomplete quotation — and say so, because that is
 * something the user can act on.
 *
 * When a quotation is not ready to export, the reason is the blocker list above
 * this toolbar, not a tooltip — that list is actionable, a tooltip is not.
 */
export function PreviewToolbar({
  quotationNumber,
  pageCount,
  canExport,
  onBack,
  onPrint,
  onSavePdf,
  isSavingPdf,
  onSaveWord,
  isSavingWord,
  onSaveToDrive,
  isSavingToDrive,
  isSavedToDrive,
  showDiscardDraft = false,
  onDiscardDraft,
  isDiscardingDraft = false,
}: PreviewToolbarProps) {
  return (
    <div className="print-hide flex flex-wrap items-center justify-between gap-3">
      <div className="text-sm text-slate-600">
        <span className="font-medium text-slate-900">{quotationNumber}</span>
        <span className="mx-2 text-slate-300">|</span>
        {pageCount} {pageCount === 1 ? 'page' : 'pages'}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={onBack}>
          Back to Edit
        </Button>

        <Button variant="secondary" onClick={onPrint}>
          Print
        </Button>

        {showDiscardDraft && onDiscardDraft !== undefined ? (
          <Button
            variant="danger"
            onClick={onDiscardDraft}
            isLoading={isDiscardingDraft}
            disabled={isDiscardingDraft}
          >
            Discard Draft
          </Button>
        ) : null}

        <Button
          disabled={!canExport}
          isLoading={isSavingPdf}
          onClick={onSavePdf}
          {...(canExport
            ? {}
            : { title: 'Resolve the items listed above before the quotation can be exported.' })}
        >
          Save as PDF
        </Button>
        <Button
          variant="secondary"
          disabled={!canExport}
          isLoading={isSavingWord}
          onClick={onSaveWord}
          {...(canExport
            ? {}
            : { title: 'Resolve the items listed above before the quotation can be exported.' })}
        >
          Save as Word
        </Button>
        <SaveToDriveButton
          disabled={!canExport}
          isSaving={isSavingToDrive}
          isSaved={isSavedToDrive}
          onSave={onSaveToDrive}
        />
      </div>
    </div>
  );
}
