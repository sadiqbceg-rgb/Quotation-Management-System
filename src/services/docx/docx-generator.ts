/**
 * Quotation DOCX generation.
 *
 * See IMPLEMENTATION_PLAN.md §14.
 *
 * ---------------------------------------------------------------------------
 * THE APPROACH
 * ---------------------------------------------------------------------------
 * `docx` builds a real OOXML package in the browser. The letterhead cannot be
 * embedded the way the PDF embeds it — Word has no "PDF page as background" —
 * so the top and bottom of the artwork are REBUILT as a Word header and footer
 * from `logo.jpg` plus the transcribed strings in `letterhead-content.ts`, and
 * the watermark is floated behind the text from inside the header.
 *
 * Rejected: `docxtemplater`, which fills a `.docx` template — there is no
 * approved `.docx` quotation template to fill, and `reference/existing-terms.docx`
 * is a terms library, not a layout. A Google Docs conversion round-trip was
 * rejected too: it needs the file to exist in Drive first, which is Phase 10,
 * and it re-flows the document on Google's terms.
 *
 * ---------------------------------------------------------------------------
 * WHAT MAKES THE TWO FILES AGREE
 * ---------------------------------------------------------------------------
 * Both consume the same Phase 07 `DocumentModel`, so section order, conditional
 * columns, term wording and the quotation number cannot drift. Both are set in
 * metric-compatible fonts — Carlito embedded in the PDF, Calibri requested by
 * name here — so they break lines in the same places.
 *
 * What they do NOT share is who paginates: Word does its own. See
 * `templates/quotation-docx/index.ts`.
 */

import { Document, Packer } from 'docx';

import { PAGE, PAGE_MARGINS_TWIPS, PAGINATION } from '@/config/document-layout';
import { isValidQuotationNumber } from '@shared/numbering';
import { QUOTATION_LIMITS } from '@shared/validation-rules';
import { checkModelStructure } from '@/services/document/build-document-model';
import type { DocumentModel } from '@/services/document/document-model.types';
import { paginate } from '@/services/document/pagination-rules';
import { buildBody } from '@/templates/quotation-docx';
import type { DocxAssets } from './docx-assets';
import { DocxGenerationError } from './docx-errors';
import { buildFooter } from './docx-footer';
import { buildHeader } from './docx-header';
import { FONTS } from './docx-styles';
import { TERMS_NUMBERING_LEVELS, TERMS_NUMBERING_REFERENCE } from './docx-terms';
import { buildWatermark } from './docx-watermark';

export interface GenerateDocxOptions {
  /** Off only for an internal proof; a client document always needs a number. */
  requireQuotationNumber?: boolean;
}

export interface GeneratedDocx {
  bytes: Uint8Array;
  /** From the shared paginator. What Word finally renders may differ by a page. */
  estimatedPageCount: number;
  /** `SFC-RUH-QTN-YYYY-NNN.docx`, derived from the canonical number. */
  filename: string;
}

/** The OOXML package is a ZIP. Every valid one starts with these four bytes. */
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04] as const;

/** A document with a header, a footer, a seal and a watermark is never tiny. */
const MIN_PLAUSIBLE_BYTES = 10_000;
const MAX_PLAUSIBLE_BYTES = 10_000_000;

/* -------------------------------------------------------------------------- */
/* Pre-flight                                                                 */
/* -------------------------------------------------------------------------- */

function assertGeneratable(model: DocumentModel, options: GenerateDocxOptions): void {
  const problems = checkModelStructure(model);
  if (problems.length > 0) {
    throw new DocxGenerationError(
      'INVALID_MODEL',
      `The quotation could not be prepared for export: ${problems[0]?.message ?? 'the document is malformed.'}`,
    );
  }

  if (options.requireQuotationNumber !== false && !isValidQuotationNumber(model.quotationNumber)) {
    throw new DocxGenerationError(
      'QUOTATION_NUMBER_REQUIRED',
      'This quotation has no number yet. Create the quotation before saving a Word document.',
    );
  }

  const rowCount = model.blocks.reduce(
    (total, block) => total + (block.kind === 'table' ? block.rows.length : 0),
    0,
  );

  if (rowCount > QUOTATION_LIMITS.maxLineItems) {
    throw new DocxGenerationError(
      'TOO_LARGE',
      `This quotation has ${String(rowCount)} items, over the ${String(QUOTATION_LIMITS.maxLineItems)} limit. Split it into several quotations.`,
    );
  }
}

function assertAssets(assets: DocxAssets): void {
  if (assets.logo.byteLength === 0) {
    throw new DocxGenerationError(
      'ASSET_MISSING',
      'The company logo could not be loaded, so the Word document cannot be produced.',
    );
  }
  if (assets.watermark.byteLength === 0) {
    // A missing watermark is a branding defect, not a cosmetic one: the file
    // would go to a client looking like it came from someone else.
    throw new DocxGenerationError(
      'ASSET_MISSING',
      'The letterhead watermark could not be loaded, so the Word document cannot be produced.',
    );
  }
  if (assets.seal.byteLength === 0) {
    throw new DocxGenerationError(
      'SEAL_MISSING',
      'The company seal could not be loaded, so the Word document cannot be produced.',
    );
  }
  if (assets.signature === null || assets.signature.byteLength === 0) {
    throw new DocxGenerationError(
      'SIGNATURE_MISSING',
      'The signature image is not available, so the quotation cannot be exported.',
    );
  }
}

/** Plausibility check on the finished package, before anyone downloads it. */
function assertPlausibleOutput(bytes: Uint8Array): void {
  const startsWithZipMagic = ZIP_MAGIC.every((byte, index) => bytes[index] === byte);

  if (!startsWithZipMagic) {
    throw new DocxGenerationError(
      'OUTPUT_INVALID',
      'The generated file is not a valid Word document.',
    );
  }
  if (bytes.byteLength < MIN_PLAUSIBLE_BYTES) {
    throw new DocxGenerationError(
      'OUTPUT_INVALID',
      'The generated Word document is missing its letterhead. Please try again.',
    );
  }
  if (bytes.byteLength > MAX_PLAUSIBLE_BYTES) {
    throw new DocxGenerationError(
      'TOO_LARGE',
      'The generated Word document is too large to save. Split the quotation into smaller ones.',
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Generation                                                                 */
/* -------------------------------------------------------------------------- */

export async function generateQuotationDocx(
  model: DocumentModel,
  assets: DocxAssets,
  options: GenerateDocxOptions = {},
): Promise<GeneratedDocx> {
  assertGeneratable(model, options);
  assertAssets(assets);

  // Narrowed by `assertAssets`, which throws on null.
  const signature = assets.signature;

  const estimatedPageCount = paginate(model).length;

  if (estimatedPageCount > PAGINATION.maxPages) {
    throw new DocxGenerationError(
      'TOO_LARGE',
      `The document came to ${String(estimatedPageCount)} pages. Split the quotation into smaller ones.`,
    );
  }

  const body = buildBody(model, { seal: assets.seal, signature });

  /*
   * The header carries the watermark as well as the letterhead top. That is
   * where Word's own watermark feature puts it, and it is what makes it appear
   * on every page — including pages that do not exist yet.
   */
  const header = buildHeader(assets.logo, buildWatermark(assets.watermark));

  const document = new Document({
    /*
     * Properties carry the document's own identity and nothing else. No user
     * email, no session token, no internal draft id — a DOCX travels outside
     * the company, and Word shows these fields in File → Info.
     */
    title: `Quotation ${model.quotationNumber}`,
    subject: `Quotation ${model.quotationNumber}`,
    creator: 'Speed Falcon Quotation System',
    description: `Quotation ${model.quotationNumber}`,
    styles: {
      default: {
        document: {
          run: { font: FONTS.body },
        },
      },
    },
    numbering: {
      config: [{ reference: TERMS_NUMBERING_REFERENCE, levels: [...TERMS_NUMBERING_LEVELS] }],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE.widthTwips, height: PAGE.heightTwips },
            margin: {
              top: PAGE_MARGINS_TWIPS.top,
              bottom: PAGE_MARGINS_TWIPS.bottom,
              left: PAGE_MARGINS_TWIPS.left,
              right: PAGE_MARGINS_TWIPS.right,
              // Where Word starts drawing the two bands. Without these the
              // header pushes the body ~30 pt down the page.
              header: PAGE_MARGINS_TWIPS.header,
              footer: PAGE_MARGINS_TWIPS.footer,
            },
          },
        },
        // Declared on the SECTION, which is what gives Word the same every-page
        // guarantee the PDF gets from its embedded background.
        headers: { default: header },
        footers: { default: buildFooter() },
        children: body,
      },
    ],
  });

  let bytes: Uint8Array;
  try {
    // `toArrayBuffer`, not `toBuffer`: the latter is typed as a Node `Buffer`,
    // which has no business in a browser bundle.
    bytes = new Uint8Array(await Packer.toArrayBuffer(document));
  } catch (cause: unknown) {
    // Never hand the browser a half-written ZIP: a corrupt .docx that Word
    // refuses to open is worse than a clear failure here.
    throw new DocxGenerationError(
      'PACKAGING_FAILED',
      'The Word document could not be assembled. Please try again.',
      { cause },
    );
  }

  assertPlausibleOutput(bytes);

  return {
    bytes,
    estimatedPageCount,
    filename: `${model.fileSafeNumber}.docx`,
  };
}
