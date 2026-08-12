import type { ReactNode } from 'react';

import { BODY_BOX, COLORS, PAGE, TYPOGRAPHY } from '@/config/document-layout';

export interface PreviewPageProps {
  pageNumber: number;
  totalPages: number;
  letterheadUrl: string;
  showPageNumbers: boolean;
  children: ReactNode;
}

/**
 * One A4 page.
 *
 * Drawn at exact point dimensions — `595.28pt × 841.89pt` — with CSS `pt` units,
 * which the browser converts at 1 pt = 1/72 in. That means the on-screen page is
 * physically the size of the paper, and the parent applies a single scale
 * transform to fit it on a monitor. Printing removes that transform, so one page
 * here is one sheet there.
 *
 * The letterhead is a background image rather than reconstructed furniture: it
 * is the company's own file, so the header, the Vision 2030 emblem, the
 * watermark and the three footer columns are all exactly right rather than
 * approximated. The print stylesheet forces background printing on, or the page
 * would come out on blank paper.
 *
 * Content sits inside the measured body box. No margin here is a literal.
 */
export function PreviewPage({
  pageNumber,
  totalPages,
  letterheadUrl,
  showPageNumbers,
  children,
}: PreviewPageProps) {
  return (
    <section
      className="preview-page relative bg-white shadow-sm print:shadow-none"
      aria-label={`Page ${String(pageNumber)} of ${String(totalPages)}`}
      style={{
        width: `${String(PAGE.widthPt)}pt`,
        height: `${String(PAGE.heightPt)}pt`,
        backgroundImage: `url(${letterheadUrl})`,
        backgroundSize: '100% 100%',
        backgroundRepeat: 'no-repeat',
        fontFamily: `${TYPOGRAPHY.bodyFamily}, ${TYPOGRAPHY.bodyFallbackFamily}, sans-serif`,
        fontSize: `${String(TYPOGRAPHY.bodySizePt)}pt`,
        lineHeight: `${String(TYPOGRAPHY.bodyLeadingPt)}pt`,
        color: COLORS.text,
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: `${String(BODY_BOX.leftPt)}pt`,
          top: `${String(BODY_BOX.topPt)}pt`,
          width: `${String(BODY_BOX.widthPt)}pt`,
          height: `${String(BODY_BOX.heightPt)}pt`,
          overflow: 'hidden',
        }}
      >
        {children}
      </div>

      {/*
        Off by default — the approved document has no page numbers. A Company
        Settings toggle enables them (§26 UR-07).
      */}
      {showPageNumbers ? (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: `${String(BODY_BOX.bottomPt)}pt`,
            textAlign: 'center',
            fontSize: `${String(TYPOGRAPHY.footerBodySizePt)}pt`,
          }}
        >
          Page {pageNumber} of {totalPages}
        </div>
      ) : null}
    </section>
  );
}
