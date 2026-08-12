/**
 * Image embedding for the signature block.
 *
 * Two images, both PNG, both placed into measured rects from §2.4:
 *
 *   seal       (373.7, 550.9)–(492.7, 659.7)   119.0 × 108.8
 *   signature  (392.8, 676.1)–(463.0, 733.6)    70.2 ×  57.5
 *
 * The seal MUST be the alpha-keyed derivative from the Phase 07 pipeline. The
 * raw `reference/company-seal.png` has no alpha channel, and embedding it would
 * paint an opaque white rectangle over the letterhead's watermark — a defect
 * invisible on screen against a white background and obvious on paper.
 *
 * Both are fitted to their rect preserving aspect ratio. Stretching a signature
 * to fill a box makes it look forged, and the uploaded file's proportions are
 * whatever the company scanned.
 */

import type { PDFDocument, PDFImage } from 'pdf-lib';

import { SIGNATURE_BLOCK } from '@/config/document-layout';
import { PdfGenerationError } from './pdf-errors';
import { fitInside, type TopLeftRect } from './pdf-coordinates';
import { hasPngSignature } from '@shared/png';

export interface SignatureImages {
  seal: PDFImage;
  signature: PDFImage;
}

async function embedPng(
  document: PDFDocument,
  bytes: Uint8Array,
  what: 'SEAL_MISSING' | 'SIGNATURE_MISSING',
  label: string,
): Promise<PDFImage> {
  if (!hasPngSignature(bytes)) {
    // Checked from the bytes, exactly as the Phase 06 upload validator does.
    throw new PdfGenerationError(what, `${label} is not a PNG image, so the PDF cannot be produced.`);
  }

  try {
    return await document.embedPng(bytes);
  } catch (cause: unknown) {
    throw new PdfGenerationError(what, `${label} could not be embedded in the PDF.`, { cause });
  }
}

export async function embedSignatureImages(
  document: PDFDocument,
  bytes: { seal: Uint8Array; signature: Uint8Array },
): Promise<SignatureImages> {
  const [seal, signature] = await Promise.all([
    embedPng(document, bytes.seal, 'SEAL_MISSING', 'The company seal'),
    embedPng(document, bytes.signature, 'SIGNATURE_MISSING', 'The signature image'),
  ]);

  return { seal, signature };
}

function rectOf(measured: { x0: number; y0: number; x1: number; y1: number }): TopLeftRect {
  return {
    x: measured.x0,
    y: measured.y0,
    width: measured.x1 - measured.x0,
    height: measured.y1 - measured.y0,
  };
}

/**
 * Where the seal goes, relative to the top of the signature block.
 *
 * The measured rects are absolute positions on the approved document's page 2.
 * The block moves whole when it does not fit, so its members are placed
 * relative to wherever the block itself landed.
 */
export function sealRect(blockTopY: number): TopLeftRect {
  const measured = rectOf(SIGNATURE_BLOCK.sealRect);
  return { ...measured, y: blockTopY + (measured.y - signatureBlockTop()) };
}

export function signatureRect(blockTopY: number): TopLeftRect {
  const measured = rectOf(SIGNATURE_BLOCK.signatureRect);
  return { ...measured, y: blockTopY + (measured.y - signatureBlockTop()) };
}

/** The topmost measured y of the block — the seal's top edge. */
export function signatureBlockTop(): number {
  return Math.min(SIGNATURE_BLOCK.sealRect.y0, SIGNATURE_BLOCK.detailsFirstLineYPt);
}

/** Fit an image into a rect, centred, preserving its aspect ratio. */
export function placeImage(image: PDFImage, target: TopLeftRect): TopLeftRect {
  return fitInside(image.width, image.height, target);
}
