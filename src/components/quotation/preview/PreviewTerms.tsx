import { BODY_BOX, TERMS_LIST } from '@/config/document-layout';
import type { TermItem } from '@/services/document/document-model.types';

export interface PreviewTermsProps {
  items: readonly TermItem[];
  /** 1-based number of the first item. A split list continues, never restarts. */
  startNumber: number;
}

/**
 * The numbered Terms & Conditions list.
 *
 * The approved document sets the number at x 52 and the text at x 70 — a
 * hanging indent, so wrapped lines align under the text rather than under the
 * number. Both measurements come from `TERMS_LIST`.
 *
 * Each item reads `**Title:** body` on one flow, exactly as the reference does.
 * Terms are PLAIN TEXT: rendered as React children, never through
 * `dangerouslySetInnerHTML`.
 *
 * `start` is set on the `<ol>` so a list continued on page two carries on from
 * where page one stopped instead of starting again at 1.
 */
export function PreviewTerms({ items, startNumber }: PreviewTermsProps) {
  return (
    <ol
      start={startNumber}
      style={{
        listStyle: 'decimal',
        // The marker sits at numberX; the content starts at textX.
        marginLeft: `${String(TERMS_LIST.textXPt - BODY_BOX.leftPt)}pt`,
        paddingLeft: 0,
      }}
    >
      {items.map((item) => (
        <li
          key={item.title}
          className="keep-together"
          style={{
            lineHeight: `${String(TERMS_LIST.leadingPt)}pt`,
            marginBottom: `${String(TERMS_LIST.spaceAfterPt)}pt`,
            paddingLeft: `${String(TERMS_LIST.textXPt - TERMS_LIST.numberXPt)}pt`,
          }}
        >
          <span style={{ fontWeight: 700 }}>{item.title}:</span> {item.body}
        </li>
      ))}
    </ol>
  );
}
