import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { buttonClasses } from '@/components/common/Button';
import type { SaveToDriveResult } from '@/services/google-drive/drive-service';

export interface RetryUploadProps {
  message: string;
  requestId: string | undefined;
  /** Set when part of the save succeeded; those links still work. */
  partial: SaveToDriveResult | null;
  canRetry: boolean;
  isRetrying: boolean;
  onRetry: () => void;
}

/**
 * The failure panel and `Retry Upload` (PRD §37).
 *
 * Three things this deliberately says out loud:
 *
 * 1. **The quotation is not saved.** PRD §37 is explicit that a Drive failure
 *    must not be reported as a successful save, and a user who thinks the
 *    document is filed will not come back to it.
 * 2. **What did work.** On a partial failure the PDF may already be in the
 *    archive; hiding its link would send the user hunting for a file that is
 *    right there.
 * 3. **Retrying is safe.** People hesitate to press Retry on a file upload
 *    because they expect a second copy. Replace-in-place means there cannot be
 *    one, and saying so is what makes the button usable.
 */
export function RetryUpload({
  message,
  requestId,
  partial,
  canRetry,
  isRetrying,
  onRetry,
}: RetryUploadProps) {
  return (
    <Card title="Not saved to Google Drive">
      <div className="flex flex-col gap-3">
        <p role="alert" className="text-brand-red text-sm">
          {message}
          {requestId === undefined ? '' : ` (Reference: ${requestId})`}
        </p>

        {partial === null ? null : (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-slate-600">
              Some files did reach the archive at{' '}
              <span className="font-medium text-slate-800">{partial.pathLabel}</span>:
            </p>
            <div className="flex flex-wrap gap-2">
              <a
                href={partial.folder.url}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClasses('secondary', 'sm')}
              >
                Open folder
              </a>
              {partial.files.pdf === null ? null : (
                <a
                  href={partial.files.pdf.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonClasses('secondary', 'sm')}
                >
                  Open PDF
                </a>
              )}
              {partial.files.docx === null ? null : (
                <a
                  href={partial.files.docx.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonClasses('secondary', 'sm')}
                >
                  Open Word file
                </a>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            disabled={!canRetry}
            isLoading={isRetrying}
            onClick={onRetry}
            {...(canRetry ? {} : { title: 'Generate the quotation again before retrying.' })}
          >
            Retry Upload
          </Button>

          <p className="text-xs text-slate-500">
            Retrying reuses the same quotation number and the same folder, and replaces the files
            rather than adding copies.
          </p>
        </div>
      </div>
    </Card>
  );
}
