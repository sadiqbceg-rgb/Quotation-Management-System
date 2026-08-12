import { TYPOGRAPHY } from '@/config/document-layout';
import type { MetaRow } from '@/services/document/document-model.types';

export interface PreviewMetaBlockProps {
  rows: readonly MetaRow[];
}

/**
 * The quotation meta block.
 *
 * Bold label, plain value, one per line — exactly as the approved document
 * prints it. Rendered as a definition list rather than a table so a screen
 * reader announces the label/value pairing.
 *
 * Every measurement comes from `document-layout.ts`; there are no numbers here.
 */
export function PreviewMetaBlock({ rows }: PreviewMetaBlockProps) {
  return (
    <dl
      className="grid"
      style={{
        gridTemplateColumns: 'max-content 1fr',
        columnGap: `${String(TYPOGRAPHY.bodySizePt * 0.5)}pt`,
        rowGap: '0',
        marginBottom: `${String(TYPOGRAPHY.paragraphSpaceAfterPt)}pt`,
      }}
    >
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt style={{ fontWeight: 700, lineHeight: `${String(TYPOGRAPHY.bodyLeadingPt)}pt` }}>
            {row.label}
          </dt>
          <dd style={{ lineHeight: `${String(TYPOGRAPHY.bodyLeadingPt)}pt`, margin: 0 }}>
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
