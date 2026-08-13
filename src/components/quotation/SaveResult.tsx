import { Card } from '@/components/common/Card';
import { buttonClasses } from '@/components/common/Button';
import type { SaveToDriveResult } from '@/services/google-drive/drive-service';
import type { DriveTarget } from '@shared/drive-links';

export interface SaveResultProps {
  result: SaveToDriveResult;
}

/**
 * A link that opens a Drive item in a new tab.
 *
 * `rel="noopener noreferrer"` because `target="_blank"` otherwise hands the
 * opened page a reference back to this one.
 */
function DriveLink({
  target,
  label,
  variant,
}: {
  target: DriveTarget;
  label: string;
  variant: 'primary' | 'secondary';
}) {
  return (
    <a
      href={target.url}
      target="_blank"
      rel="noopener noreferrer"
      className={buttonClasses(variant, 'sm')}
    >
      {label}
    </a>
  );
}

/**
 * The success panel (PRD §30 steps 14–15).
 *
 * Shows WHERE the documents went, not just that they went. The archive path is
 * printed in full because "saved to Drive" is not something a user can verify;
 * `2026 / August / SFC-RUH-QTN-2026-004` is.
 *
 * Every link comes from Drive itself and was validated before it got here — the
 * system never assembles a Drive URL from an id (PRD §34).
 */
export function SaveResult({ result }: SaveResultProps) {
  return (
    <Card title="Saved to Google Drive">
      <div className="flex flex-col gap-3">
        <p role="status" className="text-sm text-slate-700">
          <span className="font-medium text-slate-900">{result.quotationNumber}</span> was saved to
          the quotation archive.
        </p>

        <p className="text-sm text-slate-600">
          <span className="text-slate-500">Folder:</span>{' '}
          <span className="font-medium text-slate-800">{result.pathLabel}</span>
        </p>

        <div className="flex flex-wrap gap-2">
          <DriveLink target={result.folder} label="Open folder" variant="primary" />
          {result.files.pdf === null ? null : (
            <DriveLink target={result.files.pdf} label="Open PDF" variant="secondary" />
          )}
          {result.files.docx === null ? null : (
            <DriveLink target={result.files.docx} label="Open Word file" variant="secondary" />
          )}
        </div>
      </div>
    </Card>
  );
}
