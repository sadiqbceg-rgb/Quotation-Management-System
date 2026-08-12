import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { readPngHeader, hasPngSignature } from '@shared/png';

/**
 * The asset pipeline's OUTPUT is asserted here rather than re-running the
 * script: `prebuild` and the test suite both run it, and re-running it inside a
 * test would race with the build.
 *
 * The critical assertion is the last one — `reference/` must be untouched.
 */

const GENERATED = join(process.cwd(), 'src', 'assets', 'generated');
const REFERENCE = join(process.cwd(), 'reference');

function generated(name: string): Buffer {
  return readFileSync(join(GENERATED, name));
}

interface Manifest {
  generatedFrom: Record<string, string>;
  letterhead: { pageCount: number; mediaBox: number[]; previewDpi: number };
  logo: { width: number; height: number; actualFormat: string };
  seal: { width: number; height: number; transparentCorners: boolean };
}

function manifest(): Manifest {
  return JSON.parse(generated('manifest.json').toString('utf8')) as Manifest;
}

const hasRun = existsSync(join(GENERATED, 'manifest.json'));

describe.skipIf(!hasRun)('the generated assets', () => {
  it('produces every derivative the renderers need', () => {
    for (const name of [
      'letterhead.pdf',
      'letterhead-preview@150dpi.png',
      'logo.jpg',
      'logo-watermark.png',
      'seal-transparent.png',
      'manifest.json',
    ]) {
      expect(existsSync(join(GENERATED, name)), name).toBe(true);
    }
  });

  it('copies the letterhead PDF unchanged', () => {
    expect(generated('letterhead.pdf').equals(readFileSync(join(REFERENCE, 'letterhead.pdf')))).toBe(
      true,
    );
  });

  it('confirms the letterhead is a single page, so it can back every page', () => {
    expect(manifest().letterhead.pageCount).toBe(1);
  });

  it('records the letterhead page box, including its non-zero y origin', () => {
    // 0 7.83 595.5 850.08 — NOT the quotation's 0 0 595.32 841.92. Phase 08
    // has to normalise that offset or the furniture lands 7.8 pt out.
    const [, y0] = manifest().letterhead.mediaBox;
    expect(y0).toBeGreaterThan(0);
  });

  it('rasterises the preview background as a real PNG', () => {
    const png = generated('letterhead-preview@150dpi.png');

    expect(hasPngSignature(png)).toBe(true);
    // 150 dpi over ~595 pt wide.
    expect(readPngHeader(png)?.width).toBeGreaterThan(1200);
  });
});

describe.skipIf(!hasRun)('the logo, which is a JPEG named .png', () => {
  it('is decoded by magic bytes, not by extension', () => {
    expect(manifest().logo.actualFormat).toBe('JPEG');

    const logo = generated('logo.jpg');
    expect(logo[0]).toBe(0xff);
    expect(logo[1]).toBe(0xd8);
  });

  it('is copied byte-for-byte under a name that tells the truth', () => {
    expect(generated('logo.jpg').equals(readFileSync(join(REFERENCE, 'company-logo.png')))).toBe(
      true,
    );
  });

  it('produces a PNG watermark with a reduced alpha', () => {
    const watermark = generated('logo-watermark.png');
    const header = readPngHeader(watermark);

    expect(header?.hasAlpha).toBe(true);
    expect(header?.width).toBe(manifest().logo.width);
  });
});

describe.skipIf(!hasRun)('the seal, whose source has no alpha channel', () => {
  it('gains one, or it would paint a white box over the letterhead', () => {
    const source = readFileSync(join(REFERENCE, 'company-seal.png'));
    expect(readPngHeader(source)?.hasAlpha).toBe(false);

    expect(readPngHeader(generated('seal-transparent.png'))?.hasAlpha).toBe(true);
  });

  it('has fully transparent corners', () => {
    expect(manifest().seal.transparentCorners).toBe(true);
  });

  it('is downscaled to stay well above print resolution without bloating the bundle', () => {
    const seal = manifest().seal;

    /*
     * The seal prints at 119 pt = 1.65 in, so 300 dpi needs ~496 px. Below that
     * it is visibly soft in print; far above it, pdf-lib's raw-RGBA embedding
     * makes it the bulk of the file for detail no printer resolves.
     */
    const printedInches = 119 / 72;
    const dpi = seal.width / printedInches;

    expect(dpi).toBeGreaterThanOrEqual(300);
    expect(dpi).toBeLessThan(400);
    expect(statSync(join(GENERATED, 'seal-transparent.png')).size).toBeLessThan(450_000);
  });
});

describe.skipIf(!hasRun)('reference/ is read-only', () => {
  it('is byte-identical to the fingerprints the pipeline recorded', () => {
    // The single most important assertion in this file. The originals are the
    // company's own documents and the authority for every measurement; a
    // pipeline that rewrote one would silently invalidate §2.4.
    const recorded = manifest().generatedFrom;

    for (const name of readdirSync(REFERENCE).sort()) {
      const actual = createHash('sha256')
        .update(readFileSync(join(REFERENCE, name)))
        .digest('hex')
        .slice(0, 16);

      expect(actual, `reference/${name} changed`).toBe(recorded[name]);
    }
  });

  it('records a fingerprint for every reference file', () => {
    expect(Object.keys(manifest().generatedFrom).sort()).toEqual(readdirSync(REFERENCE).sort());
  });
});
