/**
 * TEST ONLY — real asset bytes, read from disk.
 *
 * The generator takes bytes, so a test can hand it the ACTUAL logo, the ACTUAL
 * watermark and the ACTUAL keyed seal, build a real package and unzip it.
 *
 * The one thing not read from disk is the signature: no signature file exists
 * in this repository and none may be fabricated (PRD §34, Phase 06). The
 * substitute is a flat colour block with a PNG header — an image file, not a
 * picture of anyone's handwriting.
 *
 * Importable from `*.test.ts` only. Node-only: it touches the file system.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { TEST_ONLY_buildPng } from '../../../../google-apps-script/src/__fixtures__/png-fixtures';
import { GENERATED_ASSETS } from '@/config/document-layout';
import type { DocxAssets } from '../docx-assets';

const GENERATED = join(process.cwd(), 'src', 'assets', 'generated');

/** Not a signature. A 640×120 flat block wearing a PNG header. */
export function TEST_ONLY_signatureBytes(): Uint8Array {
  return new Uint8Array(TEST_ONLY_buildPng({ width: 640, height: 120 }));
}

export function TEST_ONLY_docxAssets(overrides: Partial<DocxAssets> = {}): DocxAssets {
  return {
    logo: new Uint8Array(readFileSync(join(GENERATED, GENERATED_ASSETS.logo))),
    watermark: new Uint8Array(readFileSync(join(GENERATED, GENERATED_ASSETS.logoWatermark))),
    seal: new Uint8Array(readFileSync(join(GENERATED, GENERATED_ASSETS.seal))),
    signature: TEST_ONLY_signatureBytes(),
    ...overrides,
  };
}
