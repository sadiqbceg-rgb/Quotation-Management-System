/**
 * The binary inputs a PDF needs.
 *
 * ---------------------------------------------------------------------------
 * WHY THESE ARE INJECTED RATHER THAN IMPORTED
 * ---------------------------------------------------------------------------
 * The generator takes bytes. It does not know about Vite, `fetch`, or the file
 * system. That keeps it pure with respect to its input — the same model and the
 * same assets produce the same PDF — and it is what lets a test generate a real
 * document from real files and re-parse the result, instead of asserting on the
 * generator's internal state.
 *
 * The browser loader below is the only part that knows where the bytes live,
 * and it is dynamically imported so the letterhead and both font faces stay out
 * of the main bundle.
 */

import { PdfGenerationError } from './pdf-errors';

export interface PdfAssets {
  /** The company letterhead, embedded once and drawn on every page. */
  letterhead: Uint8Array;
  fontRegular: Uint8Array;
  fontBold: Uint8Array;
  /** The ALPHA-KEYED seal. Never the raw reference file, which is opaque. */
  seal: Uint8Array;
  /**
   * The signatory's signature PNG, from the Phase 06 authenticated fetch.
   *
   * Null only for a draft. Generation refuses to produce a final document
   * without one — an unsigned quotation that looks signed is worse than none.
   */
  signature: Uint8Array | null;
}

async function fetchBytes(url: string, what: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${what} responded ${String(response.status)}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Load the static assets in the browser.
 *
 * Vite resolves each `?url` at build time, so a missing file is a build error
 * rather than a runtime 404 — the right moment to find out.
 */
export async function loadPdfAssets(signature: Uint8Array | null): Promise<PdfAssets> {
  const [letterheadUrl, regularUrl, boldUrl, sealUrl] = await Promise.all([
    import('@/assets/generated/letterhead.pdf?url'),
    import('@/assets/fonts/Carlito-Regular.ttf?url'),
    import('@/assets/fonts/Carlito-Bold.ttf?url'),
    import('@/assets/generated/seal-transparent.png?url'),
  ]);

  let letterhead: Uint8Array;
  try {
    letterhead = await fetchBytes(letterheadUrl.default, 'The company letterhead');
  } catch (cause: unknown) {
    // Never fall through to a plain white page: a quotation without the
    // letterhead is not the company's document.
    throw new PdfGenerationError(
      'LETTERHEAD_MISSING',
      'The company letterhead could not be loaded, so the PDF cannot be produced.',
      { cause },
    );
  }

  let seal: Uint8Array;
  try {
    seal = await fetchBytes(sealUrl.default, 'The company seal');
  } catch (cause: unknown) {
    throw new PdfGenerationError(
      'SEAL_MISSING',
      'The company seal could not be loaded, so the PDF cannot be produced.',
      { cause },
    );
  }

  let fontRegular: Uint8Array;
  let fontBold: Uint8Array;
  try {
    [fontRegular, fontBold] = await Promise.all([
      fetchBytes(regularUrl.default, 'The document font'),
      fetchBytes(boldUrl.default, 'The document font'),
    ]);
  } catch (cause: unknown) {
    throw new PdfGenerationError(
      'FONT_EMBED_FAILED',
      'The document font could not be loaded, so the PDF cannot be produced.',
      { cause },
    );
  }

  return { letterhead, fontRegular, fontBold, seal, signature };
}
