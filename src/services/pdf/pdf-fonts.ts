/**
 * Font embedding.
 *
 * See IMPLEMENTATION_PLAN.md §13.3.
 *
 * ---------------------------------------------------------------------------
 * WHY CARLITO AND NOT CALIBRI
 * ---------------------------------------------------------------------------
 * The approved quotation is set in Calibri. Calibri is not redistributable, so
 * it cannot be bundled. **Carlito** (SIL Open Font License) is metric-compatible
 * with it: the glyphs have the same advance widths, so line breaks and column
 * fits land in the same places. That is what lets the PDF and the Phase 09 DOCX
 * — which requests Calibri by name and falls back to Carlito — paginate alike.
 *
 * Both faces are bundled locally, with the OFL alongside them. There is NO
 * network fetch of a font at render time; the CSP forbids one, and a font that
 * silently failed to load would change every line break in the document.
 *
 * ---------------------------------------------------------------------------
 * NO SILENT FALLBACK
 * ---------------------------------------------------------------------------
 * If embedding fails, generation stops. Falling back to a standard PDF font
 * would produce a document that looks plausible and paginates differently from
 * the preview the user approved — the worst kind of failure, because nobody
 * would notice until a client did.
 */

import type { PDFDocument, PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

import { PdfGenerationError } from './pdf-errors';

export interface EmbeddedFonts {
  regular: PDFFont;
  bold: PDFFont;
}

/**
 * Register fontkit and embed both faces.
 *
 * `subset: true` writes only the glyphs actually used, keeping a typical
 * quotation's font payload to a few kilobytes rather than a hundred.
 */
export async function embedFonts(
  document: PDFDocument,
  bytes: { regular: Uint8Array; bold: Uint8Array },
): Promise<EmbeddedFonts> {
  try {
    document.registerFontkit(fontkit);

    const [regular, bold] = await Promise.all([
      document.embedFont(bytes.regular, { subset: true }),
      document.embedFont(bytes.bold, { subset: true }),
    ]);

    return { regular, bold };
  } catch (cause: unknown) {
    throw new PdfGenerationError(
      'FONT_EMBED_FAILED',
      'The document font could not be embedded, so the PDF cannot be produced.',
      { cause },
    );
  }
}

/** Pick a face. This document is regular or bold throughout; no italics. */
export function faceFor(fonts: EmbeddedFonts, bold: boolean): PDFFont {
  return bold ? fonts.bold : fonts.regular;
}
