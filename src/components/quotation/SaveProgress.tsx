import { Card } from '@/components/common/Card';
import { Spinner } from '@/components/common/Spinner';
import { SAVE_STEP_LABELS, type SaveStep } from '@/hooks/useSaveToDrive';

/** The steps, in the order PRD §30 performs them. */
const STEP_ORDER: readonly SaveStep[] = ['generating-pdf', 'generating-docx', 'uploading'];

export interface SaveProgressProps {
  step: SaveStep;
}

/**
 * What the save is doing right now (PRD §30).
 *
 * The current step is NAMED, and the steps still to come are listed. Saving a
 * quotation renders two documents and uploads both, which takes long enough on
 * a slow connection that a bare spinner reads as a hang — and a user who cannot
 * tell whether it is still working will press the button again.
 *
 * `aria-live` announces each step, so the same information reaches a screen
 * reader rather than only the sighted user.
 */
export function SaveProgress({ step }: SaveProgressProps) {
  const currentIndex = STEP_ORDER.indexOf(step);

  return (
    <Card>
      <div className="flex items-start gap-3">
        <Spinner size="sm" label="Saving to Google Drive" />

        <div className="flex flex-col gap-1">
          <p aria-live="polite" className="text-sm font-medium text-slate-900">
            {SAVE_STEP_LABELS[step]}…
          </p>

          <ol className="flex flex-col gap-0.5 text-xs text-slate-500">
            {STEP_ORDER.map((entry, index) => (
              <li
                key={entry}
                className={index === currentIndex ? 'font-medium text-slate-700' : undefined}
              >
                {index < currentIndex ? '✓ ' : ''}
                {SAVE_STEP_LABELS[entry]}
              </li>
            ))}
          </ol>

          <p className="text-xs text-slate-500">
            Large quotations take a moment. Please keep this page open.
          </p>
        </div>
      </div>
    </Card>
  );
}
