import { TABLE, TYPOGRAPHY } from '@/config/document-layout';
import type { TotalsLine } from '@/services/document/document-model.types';

export interface PreviewTotalsProps {
  lines: readonly TotalsLine[];
}

/**
 * The totals block.
 *
 * Right-aligned beneath the tables, matching PRD §19. It reaches the preview
 * only in `amount` mode — the model omits it entirely for a rate-only
 * quotation, so there is no mode check here to get wrong.
 */
export function PreviewTotals({ lines }: PreviewTotalsProps) {
  return (
    <dl
      className="ml-auto"
      style={{
        width: `${String(TABLE.defaultWidthPt / 2)}pt`,
        marginBottom: `${String(TYPOGRAPHY.paragraphSpaceAfterPt)}pt`,
      }}
    >
      {lines.map((line) => (
        <div
          key={line.label}
          className="flex justify-between"
          style={{
            lineHeight: `${String(TYPOGRAPHY.bodyLeadingPt)}pt`,
            fontWeight: line.emphasis === true ? 700 : 400,
            borderTop:
              line.emphasis === true
                ? `${String(TABLE.borderWidthPt)}pt solid ${TABLE.borderColor}`
                : undefined,
          }}
        >
          <dt>{line.label}</dt>
          <dd className="tabular-nums" style={{ margin: 0 }}>
            {line.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
