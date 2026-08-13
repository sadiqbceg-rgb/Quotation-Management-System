/**
 * Loading the company's artwork, and refusing to proceed without it.
 *
 * ---------------------------------------------------------------------------
 * WHY THE FAILURE PATHS ARE THE POINT
 * ---------------------------------------------------------------------------
 * The happy path is dull: three imports resolve and the bytes come back. What
 * matters is what happens when one does NOT, because the wrong answer is a
 * quotation that goes to a client on a blank page instead of the company's
 * letterhead — a document that looks like it came from nobody.
 *
 * So every one of these asserts a refusal with a TYPED code, and that the code
 * names which asset is missing. The generators depend on that: they turn each
 * one into a message the user can act on.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AssetLoadError, sealImageRef, signatureImageRef } from './asset-loader';
import { ASSET_INTRINSIC_SIZE } from './asset-loader';
import { PdfGenerationError } from '@/services/pdf/pdf-errors';
import { DocxGenerationError } from '@/services/docx/docx-errors';
import { loadPdfAssets } from '@/services/pdf/pdf-assets';
import { loadDocxAssets } from '@/services/docx/docx-assets';
import { TEST_ONLY_buildPng } from '../../../google-apps-script/src/__fixtures__/png-fixtures';

/** A fetch that answers every request with the same outcome. */
function respondWith(outcome: 'ok' | 'missing' | 'offline'): ReturnType<typeof vi.fn> {
  return vi.fn((url: string) => {
    if (outcome === 'offline') return Promise.reject(new TypeError('Network request failed'));
    if (outcome === 'missing') {
      return Promise.resolve({
        ok: false,
        status: 404,
        url,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      url,
      arrayBuffer: () =>
        Promise.resolve(new Uint8Array(TEST_ONLY_buildPng({ width: 8, height: 8 })).buffer),
    });
  });
}

/** A fetch that fails only for the URLs matching a pattern. */
function failOnly(pattern: RegExp): ReturnType<typeof vi.fn> {
  return vi.fn((url: string) => {
    if (pattern.test(url)) {
      return Promise.resolve({
        ok: false,
        status: 404,
        url,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      url,
      arrayBuffer: () =>
        Promise.resolve(new Uint8Array(TEST_ONLY_buildPng({ width: 8, height: 8 })).buffer),
    });
  });
}

const SIGNATURE = new Uint8Array(TEST_ONLY_buildPng({ width: 64, height: 16 }));

beforeEach(() => {
  vi.stubGlobal('fetch', respondWith('ok'));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* -------------------------------------------------------------------------- */
/* The PDF's assets                                                            */
/* -------------------------------------------------------------------------- */

describe('loading the PDF assets', () => {
  it('fetches the letterhead, both fonts and the seal', async () => {
    const assets = await loadPdfAssets(SIGNATURE);

    expect(assets.letterhead.length).toBeGreaterThan(0);
    expect(assets.fontRegular.length).toBeGreaterThan(0);
    expect(assets.fontBold.length).toBeGreaterThan(0);
    expect(assets.seal.length).toBeGreaterThan(0);
  });

  it('carries the signature through untouched', async () => {
    const assets = await loadPdfAssets(SIGNATURE);
    expect(assets.signature).toEqual(SIGNATURE);
  });

  it('accepts a null signature, so the caller can report it rather than crash', async () => {
    const assets = await loadPdfAssets(null);
    expect(assets.signature).toBeNull();
  });

  it('refuses with LETTERHEAD_MISSING rather than producing a blank page', async () => {
    vi.stubGlobal('fetch', failOnly(/letterhead/i));

    // Not a fallback, not a white page: the company's document without the
    // company's letterhead is not the company's document.
    await expect(loadPdfAssets(SIGNATURE)).rejects.toMatchObject({
      name: 'PdfGenerationError',
      code: 'LETTERHEAD_MISSING',
    });
  });

  it('refuses with SEAL_MISSING when the seal cannot be loaded', async () => {
    vi.stubGlobal('fetch', failOnly(/seal/i));

    await expect(loadPdfAssets(SIGNATURE)).rejects.toMatchObject({ code: 'SEAL_MISSING' });
  });

  it('refuses when a font is unavailable, because a substitute changes every line break', async () => {
    vi.stubGlobal('fetch', failOnly(/Carlito/i));

    const error = await loadPdfAssets(SIGNATURE).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(PdfGenerationError);
  });

  it('reports a dropped connection as a typed failure, not a raw TypeError', async () => {
    vi.stubGlobal('fetch', respondWith('offline'));

    const error = await loadPdfAssets(SIGNATURE).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(PdfGenerationError);
  });
});

/* -------------------------------------------------------------------------- */
/* The DOCX's assets                                                           */
/* -------------------------------------------------------------------------- */

describe('loading the DOCX assets', () => {
  it('fetches the artwork the Word document embeds', async () => {
    const assets = await loadDocxAssets(SIGNATURE);

    expect(assets.seal.length).toBeGreaterThan(0);
    expect(assets.signature).toEqual(SIGNATURE);
  });

  it('refuses with a typed error when an asset is missing', async () => {
    vi.stubGlobal('fetch', respondWith('missing'));

    const error = await loadDocxAssets(SIGNATURE).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(DocxGenerationError);
  });

  it('reports a dropped connection as a typed failure too', async () => {
    vi.stubGlobal('fetch', respondWith('offline'));

    const error = await loadDocxAssets(SIGNATURE).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(DocxGenerationError);
  });
});

/* -------------------------------------------------------------------------- */
/* The model's image references                                                */
/* -------------------------------------------------------------------------- */

describe('the image references the model carries', () => {
  it('gives the seal its measured intrinsic size, not a guess', () => {
    const ref = sealImageRef('data:image/png;base64,TEST_ONLY');

    // Declared rather than measured at runtime, so `buildDocumentModel` can
    // stay synchronous and pure.
    expect(ref.intrinsicWidth).toBe(ASSET_INTRINSIC_SIZE.seal.width);
    expect(ref.intrinsicHeight).toBe(ASSET_INTRINSIC_SIZE.seal.height);
  });

  it('names the seal accessibly, because the preview is a web page', () => {
    expect(sealImageRef('data:image/png;base64,TEST_ONLY').alt.toLowerCase()).toContain('seal');
  });

  it('names a signature after the person, so a screen reader says whose it is', () => {
    const ref = signatureImageRef('data:image/png;base64,TEST_ONLY', 'TEST_ONLY_Signatory');
    expect(ref.alt).toContain('TEST_ONLY_Signatory');
  });

  it('is a typed error class, so a caller can tell an asset failure from any other', () => {
    const error = new AssetLoadError('TEST_ONLY-asset.png');

    expect(error).toBeInstanceOf(Error);
    expect(error.assetName).toBe('TEST_ONLY-asset.png');
  });
});
