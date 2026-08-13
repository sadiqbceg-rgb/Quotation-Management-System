/**
 * TEST ONLY — real asset bytes, read from disk.
 *
 * The generator takes bytes, so a test can hand it the ACTUAL letterhead, the
 * ACTUAL fonts and the ACTUAL keyed seal, generate a real PDF and re-parse it.
 * Asserting on the generator's internal state instead would prove nothing about
 * the file a client receives.
 *
 * The one thing not read from disk is the signature: no signature file exists
 * in this repository and none may be fabricated (PRD §34, Phase 06). The
 * substitute here is a flat colour block with a PNG header — an image file, not
 * a picture of anyone's handwriting.
 *
 * Importable from `*.test.ts` only. Node-only: it touches the file system.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { TEST_ONLY_buildPng } from '../../../../google-apps-script/src/__fixtures__/png-fixtures';
import type { PdfAssets } from '../pdf-assets';

const GENERATED = join(process.cwd(), 'src', 'assets', 'generated');
const FONTS = join(process.cwd(), 'src', 'assets', 'fonts');

/**
 * The letterhead and the two fonts, read once.
 *
 * They are the same bytes every time and together come to a couple of
 * megabytes; re-reading them per generated document was several seconds across
 * the suite for no difference in what is tested. A fresh `Uint8Array` view is
 * handed out each call so no caller can mutate another's copy.
 */
let cached: { letterhead: Buffer; regular: Buffer; bold: Buffer; seal: Buffer } | null = null;

function assetBytes() {
  cached ??= {
    letterhead: readFileSync(join(GENERATED, 'letterhead.pdf')),
    regular: readFileSync(join(FONTS, 'Carlito-Regular.ttf')),
    bold: readFileSync(join(FONTS, 'Carlito-Bold.ttf')),
    seal: readFileSync(join(GENERATED, 'seal-transparent.png')),
  };
  return cached;
}

/**
 * Not a signature. A 640×120 flat block wearing a PNG header, so the embedder
 * has something valid to place in the signature rect.
 */
export function TEST_ONLY_signatureBytes(): Uint8Array {
  return new Uint8Array(TEST_ONLY_buildPng({ width: 640, height: 120 }));
}

export function TEST_ONLY_pdfAssets(overrides: Partial<PdfAssets> = {}): PdfAssets {
  const bytes = assetBytes();

  return {
    letterhead: new Uint8Array(bytes.letterhead),
    fontRegular: new Uint8Array(bytes.regular),
    fontBold: new Uint8Array(bytes.bold),
    seal: new Uint8Array(bytes.seal),
    signature: TEST_ONLY_signatureBytes(),
    ...overrides,
  };
}

/** The raw, OPAQUE reference seal — the one the renderer must never use. */
export function TEST_ONLY_opaqueSealBytes(): Uint8Array {
  return new Uint8Array(readFileSync(join(process.cwd(), 'reference', 'company-seal.png')));
}
