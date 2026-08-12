import { TYPOGRAPHY } from '@/config/document-layout';

export interface PreviewClosingProps {
  paragraphs: readonly string[];
}

/**
 * The closing paragraphs.
 *
 * The approved document has two: a thank-you, then the purchase-order request.
 * The model has already split the stored text on blank lines, so this renders
 * whatever it is given rather than deciding where paragraphs are.
 */
export function PreviewClosing({ paragraphs }: PreviewClosingProps) {
  return (
    <div style={{ marginBottom: `${String(TYPOGRAPHY.paragraphSpaceAfterPt)}pt` }}>
      {paragraphs.map((paragraph) => (
        <p
          key={paragraph.slice(0, 60)}
          style={{
            lineHeight: `${String(TYPOGRAPHY.bodyLeadingPt)}pt`,
            marginBottom: `${String(TYPOGRAPHY.paragraphSpaceAfterPt)}pt`,
          }}
        >
          {paragraph}
        </p>
      ))}
    </div>
  );
}
