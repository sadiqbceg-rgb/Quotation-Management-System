/**
 * Quotation PDF generation.
 *
 * See IMPLEMENTATION_PLAN.md §13.
 *
 * ---------------------------------------------------------------------------
 * THE APPROACH, AND WHY IT IS NOT NEGOTIABLE
 * ---------------------------------------------------------------------------
 * `pdf-lib` draws real text onto pages whose background is the company's own
 * `reference/letterhead.pdf`, embedded once as a vector page.
 *
 *  - **Pixel-exact letterhead.** The header, the red rule, the logo, the Vision
 *    2030 emblem, the watermark, the footer rule and all three footer columns
 *    come from the company's artwork, not from an approximation of it.
 *
 *  - **It avoids Arabic entirely.** `pdf-lib` does no bidirectional reordering
 *    and no Arabic glyph shaping. The document's only Arabic — the company name
 *    and the C.R. line — lives inside the letterhead and is already vectors.
 *    This renderer NEVER calls drawText with Arabic, which removes the single
 *    largest fidelity risk in the project.
 *
 *  - **Real text.** Selectable, searchable, printable at any resolution. A
 *    rasterised screenshot would be none of those and is unacceptable for a
 *    document that forms a commercial offer.
 *
 *  - **No server.** The architecture has no Node tier, so generation is
 *    client-side by necessity as well as by design.
 *
 * Rejected: html2canvas + jsPDF (raster), @react-pdf/renderer (cannot embed the
 * letterhead page), Puppeteer (needs a server).
 *
 * ---------------------------------------------------------------------------
 * DETERMINISM
 * ---------------------------------------------------------------------------
 * The same model and assets produce the same bytes apart from the creation
 * timestamp, which the caller may pin. That is what makes the output testable.
 */

import { PDFDocument } from 'pdf-lib';

import { PAGE, PAGINATION } from '@/config/document-layout';
import { QUOTATION_LIMITS } from '@shared/validation-rules';
import { isValidQuotationNumber } from '@shared/numbering';
import { checkModelStructure } from '@/services/document/build-document-model';
import type { DocumentBlock, DocumentModel } from '@/services/document/document-model.types';
import {
  ESTIMATED_MEASURER,
  paginate,
  PaginationError,
  type PaginationMeasurer,
} from '@/services/document/pagination-rules';
import { drawBlock } from '@/templates/quotation-pdf/blocks';
import type { PdfAssets } from './pdf-assets';
import { PdfGenerationError } from './pdf-errors';
import { embedFonts } from './pdf-fonts';
import { embedSignatureImages } from './pdf-images';
import { PdfLayoutEngine } from './pdf-layout-engine';
import { measureTermItem } from './pdf-list';
import { rowHeight } from './pdf-table';

export interface GenerateOptions {
  /** Pinned in tests so the same input yields byte-comparable output. */
  createdAt?: Date;
  /** Requires an issued quotation number. Off only for an internal proof. */
  requireQuotationNumber?: boolean;
}

export interface GeneratedPdf {
  bytes: Uint8Array;
  pageCount: number;
  /** `SFC-RUH-QTN-YYYY-NNN.pdf`, derived from the canonical number. */
  filename: string;
}

/* -------------------------------------------------------------------------- */
/* Pre-flight                                                                 */
/* -------------------------------------------------------------------------- */

function assertGeneratable(model: DocumentModel, options: GenerateOptions): void {
  const problems = checkModelStructure(model);
  if (problems.length > 0) {
    throw new PdfGenerationError(
      'INVALID_MODEL',
      `The quotation could not be prepared for export: ${problems[0]?.message ?? 'the document is malformed.'}`,
    );
  }

  if (options.requireQuotationNumber !== false && !isValidQuotationNumber(model.quotationNumber)) {
    // A draft has no number, and a PDF named after nothing cannot be filed.
    throw new PdfGenerationError(
      'QUOTATION_NUMBER_REQUIRED',
      'This quotation has no number yet. Create the quotation before saving a PDF.',
    );
  }

  const rowCount = model.blocks.reduce(
    (total, block) => total + (block.kind === 'table' ? block.rows.length : 0),
    0,
  );

  if (rowCount > QUOTATION_LIMITS.maxLineItems) {
    throw new PdfGenerationError(
      'TOO_LARGE',
      `This quotation has ${String(rowCount)} items, over the ${String(QUOTATION_LIMITS.maxLineItems)} limit. Split it into several quotations.`,
    );
  }
}

/** Plausibility check on the finished bytes, before anyone downloads them. */
function assertPlausibleOutput(bytes: Uint8Array, pageCount: number): void {
  const magic = String.fromCharCode(...bytes.subarray(0, 5));

  if (magic !== '%PDF-') {
    throw new PdfGenerationError('OUTPUT_INVALID', 'The generated file is not a valid PDF.');
  }
  if (pageCount < 1 || pageCount > PAGINATION.maxPages) {
    throw new PdfGenerationError(
      'TOO_LARGE',
      `The document came to ${String(pageCount)} pages. Split the quotation into smaller ones.`,
    );
  }
  // The embedded letterhead alone is ~190 KB, so anything tiny means the
  // background silently failed to embed.
  if (bytes.byteLength < 20_000) {
    throw new PdfGenerationError(
      'OUTPUT_INVALID',
      'The generated PDF is missing its letterhead. Please try again.',
    );
  }
  if (bytes.byteLength > 10_000_000) {
    throw new PdfGenerationError(
      'TOO_LARGE',
      'The generated PDF is too large to save. Split the quotation into smaller ones.',
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Generation                                                                 */
/* -------------------------------------------------------------------------- */

export async function generateQuotationPdf(
  model: DocumentModel,
  assets: PdfAssets,
  options: GenerateOptions = {},
): Promise<GeneratedPdf> {
  assertGeneratable(model, options);

  if (assets.signature === null) {
    throw new PdfGenerationError(
      'SIGNATURE_MISSING',
      'The signature image is not available, so the quotation cannot be exported.',
    );
  }

  const document = await PDFDocument.create();

  const fonts = await embedFonts(document, {
    regular: assets.fontRegular,
    bold: assets.fontBold,
  });

  let background;
  try {
    const template = await PDFDocument.load(assets.letterhead);
    [background] = await document.embedPdf(template, [0]);
  } catch (cause: unknown) {
    throw new PdfGenerationError(
      'LETTERHEAD_MISSING',
      'The company letterhead could not be loaded, so the PDF cannot be produced.',
      { cause },
    );
  }

  if (background === undefined) {
    throw new PdfGenerationError(
      'LETTERHEAD_MISSING',
      'The company letterhead could not be loaded, so the PDF cannot be produced.',
    );
  }

  const images = await embedSignatureImages(document, {
    seal: assets.seal,
    signature: assets.signature,
  });

  const engine = new PdfLayoutEngine(document, fonts, background);

  /*
   * Paginate with the EMBEDDED FONT's real metrics.
   *
   * The policy is Phase 07's — shared, one implementation — but the ruler is
   * this document's own font, because these are the glyphs actually being
   * drawn. The preview's estimate errs towards breaking early, so the two agree
   * except on borderline documents; where they differ, the PDF is right.
   */
  const measurer: PaginationMeasurer = {
    block: (block: DocumentBlock) => {
      if (block.kind === 'termsList') {
        return block.items.reduce((total, item) => total + measureTermItem(engine, item), 0);
      }
      return ESTIMATED_MEASURER.block(block);
    },
    termItem: (item) => measureTermItem(engine, item),
    tableRow: (block) => {
      const header = rowHeight(
        engine,
        block.columns.map((column) => column.header),
        block.columns,
        true,
      );
      // The tallest row, so a page never fits more rows than it really can.
      return block.rows.reduce(
        (tallest, row) => Math.max(tallest, rowHeight(engine, row, block.columns, false)),
        header,
      );
    },
  };

  let pages;
  try {
    pages = paginate(model, measurer);
  } catch (cause: unknown) {
    throw new PdfGenerationError(
      'LAYOUT_FAILED',
      cause instanceof PaginationError
        ? cause.message
        : 'The quotation could not be laid out for export.',
      { cause },
    );
  }

  const context = { seal: images.seal, signature: images.signature };

  pages.forEach((page, index) => {
    if (index > 0) engine.newPage();

    for (const placed of page.blocks) {
      engine.advance(drawBlock(engine, placed, context));
    }
  });

  if (model.showPageNumbers) engine.stampPageNumbers();

  /*
   * Metadata carries the document's own identity and nothing else: no user
   * email, no session token, no internal id. A PDF travels outside the company.
   */
  document.setTitle(`Quotation ${model.quotationNumber}`);
  document.setSubject(`Quotation ${model.quotationNumber}`);
  document.setProducer('Speed Falcon Quotation System');
  document.setCreator('Speed Falcon Quotation System');

  const createdAt = options.createdAt ?? new Date();
  document.setCreationDate(createdAt);
  document.setModificationDate(createdAt);

  const bytes = await document.save({ useObjectStreams: false });
  assertPlausibleOutput(bytes, engine.pageCount);

  return {
    bytes,
    pageCount: engine.pageCount,
    filename: `${model.fileSafeNumber}.pdf`,
  };
}

/** A4, for callers asserting page geometry. */
export const PDF_PAGE_SIZE = { width: PAGE.widthPt, height: PAGE.heightPt } as const;
