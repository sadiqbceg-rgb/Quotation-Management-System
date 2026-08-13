/**
 * The images a DOCX needs.
 *
 * Injected as bytes for the same reason the PDF's are (`pdf-assets.ts`): the
 * generator stays pure with respect to its input, so a test can build a real
 * document from real files, unzip it, and assert against the XML.
 *
 * Note what is NOT here: the letterhead PDF. Word cannot embed a PDF page as a
 * background, so the header and footer are rebuilt from `logo.jpg` plus the
 * transcribed text in `letterhead-content.ts`. That difference is the single
 * biggest divergence between the two renderers, and it is why the DOCX needs
 * the logo and the watermark while the PDF needs neither.
 */

import { DocxGenerationError } from './docx-errors';

export interface DocxAssets {
  /** The letterhead logo, for the Word header. A JPEG, despite its source name. */
  logo: Uint8Array;
  /** The faint logo, floated behind the text. */
  watermark: Uint8Array;
  /** The ALPHA-KEYED seal. Never the raw reference file, which is opaque. */
  seal: Uint8Array;
  /** From the Phase 06 authenticated fetch. Null only for a draft. */
  signature: Uint8Array | null;
}

async function fetchBytes(url: string, what: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${what} responded ${String(response.status)}`);
  return new Uint8Array(await response.arrayBuffer());
}

/** Load the static images in the browser. */
export async function loadDocxAssets(signature: Uint8Array | null): Promise<DocxAssets> {
  const [logoUrl, watermarkUrl, sealUrl] = await Promise.all([
    import('@/assets/generated/logo.jpg?url'),
    import('@/assets/generated/logo-watermark.png?url'),
    import('@/assets/generated/seal-transparent.png?url'),
  ]);

  let logo: Uint8Array;
  let watermark: Uint8Array;
  try {
    [logo, watermark] = await Promise.all([
      fetchBytes(logoUrl.default, 'The company logo'),
      fetchBytes(watermarkUrl.default, 'The watermark'),
    ]);
  } catch (cause: unknown) {
    /*
     * A missing watermark is a BRANDING defect, not a cosmetic one: the
     * approved letterhead shows the logo behind the text on every page. Failing
     * loudly is better than quietly shipping a document that looks like someone
     * else's.
     */
    throw new DocxGenerationError(
      'ASSET_MISSING',
      'The company letterhead images could not be loaded, so the Word document cannot be produced.',
      { cause },
    );
  }

  let seal: Uint8Array;
  try {
    seal = await fetchBytes(sealUrl.default, 'The company seal');
  } catch (cause: unknown) {
    throw new DocxGenerationError(
      'SEAL_MISSING',
      'The company seal could not be loaded, so the Word document cannot be produced.',
      { cause },
    );
  }

  return { logo, watermark, seal, signature };
}
