/**
 * Build-time asset pipeline.
 *
 * Reads `reference/` READ-ONLY and writes derivatives into
 * `src/assets/generated/` (git-ignored, reproducible). See
 * IMPLEMENTATION_PLAN.md §12.4.
 *
 * ---------------------------------------------------------------------------
 * WHY A BUILD STEP RATHER THAN COMMITTED ASSETS
 * ---------------------------------------------------------------------------
 * The originals are the company's own files and are the authority. Committing
 * hand-edited derivatives would mean the repository slowly diverges from them
 * with no way to tell which is right. Regenerating from source on every build
 * keeps one authority and makes every transformation reviewable as code.
 *
 * Nothing here writes to `reference/`. A test asserts the directory is
 * byte-identical after this script runs.
 *
 * Every library used here is a devDependency. None of it may reach the browser
 * bundle — the outputs do, the tooling does not.
 *
 * Run:  node scripts/prepare-assets.ts        (also wired into `prebuild`)
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';
import { createCanvas } from '@napi-rs/canvas';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const REFERENCE = join(ROOT, 'reference');
const OUTPUT = join(ROOT, 'src', 'assets', 'generated');

/** Preview background resolution. 150 dpi keeps it crisp at 100% zoom. */
const PREVIEW_DPI = 150;

/* -------------------------------------------------------------------------- */
/* Failing loudly                                                             */
/* -------------------------------------------------------------------------- */

class AssetError extends Error {
  public override readonly name = 'AssetError';
}

/**
 * Read a source file, failing with the path when it is missing.
 *
 * A silent skip here would produce a document with a blank region that nobody
 * notices until it reaches a client.
 */
function readSource(name: string): Buffer {
  try {
    return readFileSync(join(REFERENCE, name));
  } catch {
    throw new AssetError(
      `Missing source asset: reference/${name}. The reference directory must be present and unmodified.`,
    );
  }
}

function assertFormat(condition: boolean, message: string): asserts condition {
  if (!condition) throw new AssetError(message);
}

function write(name: string, data: Buffer | Uint8Array): void {
  writeFileSync(join(OUTPUT, name), data);
  const kb = (data.byteLength / 1024).toFixed(1);
  console.log(`  ${name.padEnd(34)} ${kb.padStart(8)} KB`);
}

/* -------------------------------------------------------------------------- */
/* Format detection — by magic bytes, never by extension                      */
/* -------------------------------------------------------------------------- */

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPng(data: Buffer): boolean {
  return PNG_MAGIC.every((byte, index) => data[index] === byte);
}

function isJpeg(data: Buffer): boolean {
  return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
}

function isPdf(data: Buffer): boolean {
  return data.subarray(0, 5).toString('latin1') === '%PDF-';
}

/* -------------------------------------------------------------------------- */
/* 1. Letterhead                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Copy the letterhead for Phase 08 to embed, and rasterise it for the preview.
 *
 * Two facts about this file that the renderers must know, both measured here
 * rather than assumed:
 *
 *   - It is ONE page, so it can back every page of a multi-page quotation.
 *   - Its MediaBox is `0 7.83 595.5 850.08` — 595.5 × 842.25 pt with a non-zero
 *     y origin, where quotation-sample.pdf is `0 0 595.32 841.92`. Anything
 *     embedding it has to normalise that 7.83 pt offset or the furniture lands
 *     in the wrong place. The measurement is written to the manifest so Phase 08
 *     cannot miss it.
 */
async function prepareLetterhead(): Promise<{
  pageCount: number;
  mediaBox: [number, number, number, number];
}> {
  const source = readSource('letterhead.pdf');
  assertFormat(isPdf(source), 'reference/letterhead.pdf is not a PDF.');

  write('letterhead.pdf', source);

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await pdfjs.getDocument({
    data: new Uint8Array(source),
    // No system font probing during a build.
    disableFontFace: true,
  }).promise;

  assertFormat(
    document.numPages === 1,
    `reference/letterhead.pdf has ${String(document.numPages)} pages; a reusable page background must have exactly one.`,
  );

  const page = await document.getPage(1);
  const [x0, y0, x1, y1] = page.view as [number, number, number, number];

  const viewport = page.getViewport({ scale: PREVIEW_DPI / 72 });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));

  await page.render({
    canvas,
    canvasContext: canvas.getContext('2d'),
    viewport,
  }).promise;

  write(`letterhead-preview@${String(PREVIEW_DPI)}dpi.png`, canvas.toBuffer('image/png'));

  return { pageCount: document.numPages, mediaBox: [x0, y0, x1, y1] };
}

/* -------------------------------------------------------------------------- */
/* 2. Logo — named .png, actually a JPEG                                      */
/* -------------------------------------------------------------------------- */

/**
 * `reference/company-logo.png` is a JPEG despite its extension.
 *
 * Trusting the extension would hand a JPEG to a PNG decoder and fail at build
 * time — or worse, embed it with the wrong declared type and produce a document
 * that opens in one viewer and not another. The magic bytes decide.
 */
function prepareLogo(): { width: number; height: number; actualFormat: string } {
  const source = readSource('company-logo.png');

  assertFormat(
    isJpeg(source),
    'reference/company-logo.png is no longer a JPEG. Re-check the file before changing this pipeline — the extension has always been wrong, the bytes were right.',
  );

  // Byte-identical copy under a name that tells the truth about its contents.
  write('logo.jpg', source);

  const decoded = jpeg.decode(source, { useTArray: true });

  /*
   * The DOCX watermark (Phase 09) needs a PNG, and needs it faint: the approved
   * letterhead shows the logo behind the text at low contrast, so a full-opacity
   * copy would make the body unreadable.
   */
  const watermark = new PNG({ width: decoded.width, height: decoded.height });
  const WATERMARK_ALPHA = 0.12;

  for (let index = 0; index < decoded.data.length; index += 4) {
    watermark.data[index] = decoded.data[index] ?? 0;
    watermark.data[index + 1] = decoded.data[index + 1] ?? 0;
    watermark.data[index + 2] = decoded.data[index + 2] ?? 0;
    watermark.data[index + 3] = Math.round(255 * WATERMARK_ALPHA);
  }

  write('logo-watermark.png', PNG.sync.write(watermark));

  return { width: decoded.width, height: decoded.height, actualFormat: 'JPEG' };
}

/* -------------------------------------------------------------------------- */
/* Downscaling                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Box-filter downscale.
 *
 * Averaging every source pixel that falls inside a destination pixel, rather
 * than sampling one of them: nearest-neighbour on a seal's fine engraving turns
 * it into speckle, and the alpha channel has to be averaged too or the keyed
 * edges come back hard.
 */
function downscale(source: PNG, maxEdge: number): PNG {
  const longest = Math.max(source.width, source.height);
  if (longest <= maxEdge) return source;

  const scale = maxEdge / longest;
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const output = new PNG({ width, height });

  const xRatio = source.width / width;
  const yRatio = source.height / height;

  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * yRatio);
    const y1 = Math.min(source.height, Math.max(y0 + 1, Math.floor((y + 1) * yRatio)));

    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * xRatio);
      const x1 = Math.min(source.width, Math.max(x0 + 1, Math.floor((x + 1) * xRatio)));

      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      let count = 0;

      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const index = (sy * source.width + sx) * 4;
          red += source.data[index] ?? 0;
          green += source.data[index + 1] ?? 0;
          blue += source.data[index + 2] ?? 0;
          alpha += source.data[index + 3] ?? 0;
          count += 1;
        }
      }

      const target = (y * width + x) * 4;
      output.data[target] = Math.round(red / count);
      output.data[target + 1] = Math.round(green / count);
      output.data[target + 2] = Math.round(blue / count);
      output.data[target + 3] = Math.round(alpha / count);
    }
  }

  return output;
}

/* -------------------------------------------------------------------------- */
/* 3. Seal — alpha-key the white background                                   */
/* -------------------------------------------------------------------------- */

/**
 * `reference/company-seal.png` is a real PNG but has NO alpha channel.
 *
 * Overlaid as-is, its opaque white background paints a rectangle across the
 * letterhead watermark and any text beneath it — the exact failure PRD §25's
 * "the seal must not overlap text" is guarding against, except invisible until
 * someone looks at a printed page.
 *
 * So near-white pixels become transparent, and partially-white ones become
 * partially transparent, which keeps the ink edges soft instead of jagged.
 */
function prepareSeal(): { width: number; height: number; transparentCorners: boolean } {
  const source = readSource('company-seal.png');
  assertFormat(isPng(source), 'reference/company-seal.png is not a PNG.');

  const decoded = PNG.sync.read(source);
  const output = new PNG({ width: decoded.width, height: decoded.height });

  /** Above this luminance a pixel is background; below it, ink. */
  const WHITE_THRESHOLD = 245;
  /** The band over which alpha ramps, so edges are anti-aliased rather than hard. */
  const FEATHER = 30;

  for (let index = 0; index < decoded.data.length; index += 4) {
    const red = decoded.data[index] ?? 0;
    const green = decoded.data[index + 1] ?? 0;
    const blue = decoded.data[index + 2] ?? 0;

    output.data[index] = red;
    output.data[index + 1] = green;
    output.data[index + 2] = blue;

    // Luminance, not a plain average: the seal's ink is coloured, and an
    // average would clip saturated reds that are genuinely part of the mark.
    const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;

    if (luminance >= WHITE_THRESHOLD) {
      output.data[index + 3] = 0;
    } else if (luminance >= WHITE_THRESHOLD - FEATHER) {
      const ramp = (WHITE_THRESHOLD - luminance) / FEATHER;
      output.data[index + 3] = Math.round(255 * ramp);
    } else {
      output.data[index + 3] = 255;
    }
  }

  /*
   * The seal prints at 119 × 108.8 pt (§2.4). At 300 dpi that is ~496 px, so
   * the 1312 px source is roughly 2.6× more detail than any output can show —
   * and it weighs 1.7 MB keyed, which would sit in the browser bundle for no
   * visible benefit. 800 px keeps it comfortably above print resolution.
   */
  const SEAL_MAX_EDGE = 800;
  const scaled = downscale(output, SEAL_MAX_EDGE);

  write('seal-transparent.png', PNG.sync.write(scaled));

  const cornerAlpha = (x: number, y: number): number =>
    scaled.data[(y * scaled.width + x) * 4 + 3] ?? 255;

  const transparentCorners =
    cornerAlpha(0, 0) === 0 &&
    cornerAlpha(scaled.width - 1, 0) === 0 &&
    cornerAlpha(0, scaled.height - 1) === 0 &&
    cornerAlpha(scaled.width - 1, scaled.height - 1) === 0;

  return { width: scaled.width, height: scaled.height, transparentCorners };
}

/* -------------------------------------------------------------------------- */
/* Manifest                                                                   */
/* -------------------------------------------------------------------------- */

export interface AssetManifest {
  generatedFrom: Record<string, string>;
  letterhead: {
    pageCount: number;
    /** `[x0, y0, x1, y1]` in points, straight from the PDF. */
    mediaBox: [number, number, number, number];
    previewDpi: number;
  };
  logo: { width: number; height: number; actualFormat: string };
  seal: { width: number; height: number; transparentCorners: boolean };
}

/** SHA-256 of each source, so a changed reference file is visible in a diff. */
function fingerprintSources(): Record<string, string> {
  const fingerprints: Record<string, string> = {};

  for (const name of readdirSync(REFERENCE).sort()) {
    const hash = createHash('sha256').update(readFileSync(join(REFERENCE, name))).digest('hex');
    fingerprints[name] = hash.slice(0, 16);
  }
  return fingerprints;
}

/* -------------------------------------------------------------------------- */

export async function prepareAssets(): Promise<AssetManifest> {
  mkdirSync(OUTPUT, { recursive: true });

  console.log('Preparing document assets from reference/ (read-only)…');

  const letterhead = await prepareLetterhead();
  const logo = prepareLogo();
  const seal = prepareSeal();

  const manifest: AssetManifest = {
    generatedFrom: fingerprintSources(),
    letterhead: { ...letterhead, previewDpi: PREVIEW_DPI },
    logo,
    seal,
  };

  write('manifest.json', Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'));

  if (!seal.transparentCorners) {
    throw new AssetError(
      'The keyed seal still has opaque corners. It would paint a white box over the letterhead.',
    );
  }

  console.log('Done. reference/ was not modified.');
  return manifest;
}

const invokedDirectly = process.argv[1] !== undefined && process.argv[1].endsWith('prepare-assets.ts');

if (invokedDirectly) {
  prepareAssets().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
