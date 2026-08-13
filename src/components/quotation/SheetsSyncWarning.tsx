import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import type { TrackingOutcome } from '@/services/google-sheets/sheets-service';

export interface SheetsSyncWarningProps {
  tracking: TrackingOutcome;
  requestId: string | undefined;
  isRetrying: boolean;
  onRetry: () => void;
}

/**
 * The documents are safe; the register is not (PRD §37).
 *
 * A WARNING, not an error, and the distinction is the whole point. The PDF and
 * the DOCX are in Drive, their links work, and the quotation can be sent — what
 * failed is the spreadsheet row. Showing this as a failed save would send the
 * user to re-generate and re-upload two megabytes of documents that are already
 * filed.
 *
 * Nothing is rendered when the row was written, or when the upload itself was
 * incomplete: in that case the Drive retry is the action, and this panel would
 * be a second, contradictory instruction on the same screen.
 */
export function SheetsSyncWarning({
  tracking,
  requestId,
  isRetrying,
  onRetry,
}: SheetsSyncWarningProps) {
  if (tracking.status !== 'failed') return null;

  return (
    <Card title="Saved to Drive, but not yet in the register">
      <div className="flex flex-col gap-3">
        <p role="status" className="text-sm text-amber-700">
          {tracking.message ??
            'The documents were saved to Google Drive, but quotation tracking was not updated.'}
          {requestId === undefined ? '' : ` (Reference: ${requestId})`}
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" isLoading={isRetrying} onClick={onRetry}>
            Retry Tracking
          </Button>

          <p className="text-xs text-slate-500">
            The documents are already in Drive. Retrying only writes the tracking row, and updates
            it rather than adding a second one.
          </p>
        </div>
      </div>
    </Card>
  );
}
