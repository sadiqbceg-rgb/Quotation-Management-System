/**
 * Loading the generated document assets.
 *
 * The files come from `scripts/prepare-assets.ts` and live in
 * `src/assets/generated/`, which is git-ignored. See §12.4.
 *
 * ---------------------------------------------------------------------------
 * WHY DYNAMIC IMPORT
 * ---------------------------------------------------------------------------
 * The letterhead background and the keyed seal are together most of a megabyte.
 * Importing them statically would put that in the main chunk, so every user
 * would download the preview's artwork on the login page. They load only when a
 * preview is actually opened.
 *
 * The generated directory is empty on a fresh checkout until `prebuild` runs, so
 * a missing asset is a real possibility and is reported by NAME. A silently
 * blank region in a quotation is the failure this guards against.
 */

import { GENERATED_ASSETS } from '@/config/document-layout';
import type { ImageRef } from './document-model.types';

export class AssetLoadError extends Error {
  public override readonly name = 'AssetLoadError';
  public readonly assetName: string;

  constructor(assetName: string) {
    super(
      `The document asset "${assetName}" could not be loaded. Run \`node scripts/prepare-assets.ts\` to regenerate it from reference/.`,
    );
    this.assetName = assetName;
  }
}

export interface DocumentAssetUrls {
  letterheadPreview: string;
  seal: string;
  logo: string;
}

/**
 * Intrinsic sizes, from the asset manifest the pipeline writes.
 *
 * Declared here rather than measured at runtime so the model can be built
 * without waiting for an image to decode — `buildDocumentModel` is synchronous
 * and pure, and it stays that way.
 */
export const ASSET_INTRINSIC_SIZE = {
  /** 1312 × 1199 keyed, then downscaled to 520 on the long edge (315 dpi at print size). */
  seal: { width: 520, height: 475 },
  /** reference/company-logo.png, which is a JPEG. */
  logo: { width: 1100, height: 606 },
} as const;

/**
 * Load the preview assets.
 *
 * Vite resolves these at build time, so a missing file is a build error rather
 * than a runtime 404 — which is the right moment to find out.
 */
export async function loadDocumentAssets(): Promise<DocumentAssetUrls> {
  try {
    const [letterhead, seal, logo] = await Promise.all([
      import('@/assets/generated/letterhead-preview@150dpi.png'),
      import('@/assets/generated/seal-transparent.png'),
      import('@/assets/generated/logo.jpg'),
    ]);

    return {
      letterheadPreview: letterhead.default,
      seal: seal.default,
      logo: logo.default,
    };
  } catch {
    throw new AssetLoadError(GENERATED_ASSETS.letterheadPreview);
  }
}

/** The seal, as the model's `ImageRef`. */
export function sealImageRef(url: string): ImageRef {
  return {
    src: url,
    alt: 'Speed Falcon Company seal',
    intrinsicWidth: ASSET_INTRINSIC_SIZE.seal.width,
    intrinsicHeight: ASSET_INTRINSIC_SIZE.seal.height,
  };
}

/**
 * The signatory's signature, as an `ImageRef`.
 *
 * Built from base64 held in memory (Phase 06), never from a URL — there is no
 * shareable link to a signature anywhere in this system, and this is the only
 * place the bytes become something an `<img>` can render.
 */
export function signatureImageRef(dataUri: string, personName: string): ImageRef {
  return {
    src: dataUri,
    alt: `Signature of ${personName}`,
    // Unknown until the browser decodes it; the renderer fits it to the
    // measured rect preserving aspect ratio, so a nominal size is enough.
    intrinsicWidth: 0,
    intrinsicHeight: 0,
  };
}

/** A placeholder ref for a draft with no signature yet. Never rendered. */
export const EMPTY_IMAGE_REF: ImageRef = {
  src: '',
  alt: '',
  intrinsicWidth: 0,
  intrinsicHeight: 0,
};
