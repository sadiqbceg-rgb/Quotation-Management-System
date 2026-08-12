import { useMemo } from 'react';

import { PAGE, TYPOGRAPHY } from '@/config/document-layout';
import {
  assertNeverBlock,
  type DocumentBlock,
  type DocumentModel,
} from '@/services/document/document-model.types';
import {
  PaginationError,
  paginate,
  type DocumentPage,
  type PlacedBlock,
} from '@/services/document/pagination-rules';
import { PreviewClosing } from './PreviewClosing';
import { PreviewMetaBlock } from './PreviewMetaBlock';
import { PreviewPage } from './PreviewPage';
import { PreviewSignature } from './PreviewSignature';
import { PreviewTable } from './PreviewTable';
import { PreviewTerms } from './PreviewTerms';
import { PreviewTotals } from './PreviewTotals';

export interface QuotationPreviewProps {
  model: DocumentModel;
  letterheadUrl: string;
  /** On-screen scale. Print ignores it — see print.css. */
  scale?: number;
}

/**
 * Render one block.
 *
 * An exhaustive switch with a `never` default: if a block kind is added to the
 * model and this renderer is not updated, the build fails. That is the whole
 * reason `DocumentBlock` is a discriminated union — a silently missing section
 * in a client's quotation is not something to discover by eye.
 */
function renderBlock(placed: PlacedBlock, index: number) {
  const block: DocumentBlock = placed.block;
  const key = `${block.kind}-${String(index)}`;

  switch (block.kind) {
    case 'meta':
      return <PreviewMetaBlock key={key} rows={block.rows} />;

    case 'heading':
      return (
        <h2
          key={key}
          style={{
            fontWeight: 700,
            fontSize: `${String(TYPOGRAPHY.headingSizePt)}pt`,
            lineHeight: `${String(TYPOGRAPHY.bodyLeadingPt)}pt`,
            marginBottom: `${String(TYPOGRAPHY.paragraphSpaceAfterPt)}pt`,
          }}
        >
          {block.number}. {block.text}
        </h2>
      );

    case 'paragraph':
      return (
        <p
          key={key}
          style={{
            fontWeight: block.bold === true ? 700 : 400,
            lineHeight: `${String(TYPOGRAPHY.bodyLeadingPt)}pt`,
            marginBottom: `${String(TYPOGRAPHY.paragraphSpaceAfterPt)}pt`,
          }}
        >
          {block.text}
        </p>
      );

    case 'table':
      return (
        <PreviewTable
          key={key}
          category={block.category}
          columns={block.columns}
          rows={block.rows}
          isContinuation={placed.isContinuation}
        />
      );

    case 'summaryLine':
      return (
        <p
          key={key}
          style={{
            fontWeight: 700,
            lineHeight: `${String(TYPOGRAPHY.bodyLeadingPt)}pt`,
            marginBottom: `${String(TYPOGRAPHY.paragraphSpaceAfterPt)}pt`,
          }}
        >
          {block.label} {block.value}
        </p>
      );

    case 'totals':
      return <PreviewTotals key={key} lines={block.lines} />;

    case 'termsList':
      return <PreviewTerms key={key} items={block.items} startNumber={placed.startNumber} />;

    case 'closing':
      return <PreviewClosing key={key} paragraphs={block.paragraphs} />;

    case 'signature':
      return (
        <PreviewSignature
          key={key}
          left={block.left}
          sealImage={block.sealImage}
          signatureImage={block.signatureImage}
        />
      );

    default:
      return assertNeverBlock(block);
  }
}

/**
 * The A4 preview.
 *
 * Pagination comes from the SAME `paginate()` the PDF and DOCX renderers will
 * use, so the page count shown here is the page count the client receives. A
 * preview that disagreed with the output would be worse than no preview.
 */
export function QuotationPreview({ model, letterheadUrl, scale = 1 }: QuotationPreviewProps) {
  const result = useMemo<{ pages: DocumentPage[]; error: string | null }>(() => {
    try {
      return { pages: paginate(model), error: null };
    } catch (error: unknown) {
      // A block taller than a page names itself, so the message is actionable
      // rather than "the preview failed".
      return {
        pages: [],
        error:
          error instanceof PaginationError
            ? error.message
            : 'The quotation could not be laid out for preview.',
      };
    }
  }, [model]);

  if (result.error !== null) {
    return (
      <p role="alert" className="text-brand-red text-sm">
        {result.error}
      </p>
    );
  }

  return (
    <div
      className="preview-scale"
      style={{
        transform: `scale(${String(scale)})`,
        transformOrigin: 'top center',
        // Reserve the SCALED footprint so the surrounding page does not leave a
        // gap the size of the unscaled document beneath the preview.
        width: `${String(PAGE.widthPt)}pt`,
        height: `${String(result.pages.length * PAGE.heightPt * scale)}pt`,
      }}
    >
      <div className="flex flex-col items-center gap-6 print:gap-0">
        {result.pages.map((page) => (
          <PreviewPage
            key={page.pageNumber}
            pageNumber={page.pageNumber}
            totalPages={result.pages.length}
            letterheadUrl={letterheadUrl}
            showPageNumbers={model.showPageNumbers}
          >
            {page.blocks.map((placed, index) => renderBlock(placed, index))}
          </PreviewPage>
        ))}
      </div>
    </div>
  );
}
