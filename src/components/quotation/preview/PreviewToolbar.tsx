import { Button } from '@/components/common/Button';

export interface PreviewToolbarProps {
  quotationNumber: string;
  pageCount: number;
  canExport: boolean;
  onBack: () => void;
  onPrint: () => void;
}

/**
 * Preview actions (PRD §29).
 *
 * `Back to Edit` and `Print` work now. The three export buttons are rendered
 * DISABLED with a tooltip naming the phase that implements them.
 *
 * Showing them disabled rather than hiding them is deliberate: the PRD promises
 * these actions, and a user who cannot see them assumes the feature is missing
 * rather than pending. The tooltip says which is which.
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
}: PreviewToolbarProps) {
  const pendingTitle = (phase: string): string =>
    canExport
      ? `Available in Phase ${phase}.`
      : 'Resolve the items listed above before the quotation can be exported.';

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

        <Button disabled title={pendingTitle('08')}>
          Save as PDF
        </Button>
        <Button disabled title={pendingTitle('09')}>
          Save as Word
        </Button>
        <Button disabled title={pendingTitle('10')}>
          Save to Google Drive
        </Button>
      </div>
    </div>
  );
}
