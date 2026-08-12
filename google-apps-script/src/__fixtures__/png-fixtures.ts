/**
 * TEST ONLY — synthetic PNG byte arrays.
 *
 * ---------------------------------------------------------------------------
 * THESE ARE NOT SIGNATURES
 * ---------------------------------------------------------------------------
 * They are the smallest byte sequences that satisfy — or deliberately fail —
 * the upload validator: a signature-shaped header and one row of pixel data,
 * carrying no image of anyone's handwriting.
 *
 * PRD §34 and the Phase 06 data rules forbid a fabricated signature of any kind
 * — not drawn, not generated, not a font rendering of a name, and above all not
 * extracted from `reference/quotation-sample.pdf`, where the signature belongs
 * to a real person. Nothing here comes close: the pixels are a flat block, and
 * no real signature file exists anywhere in this repository.
 *
 * Built at runtime rather than committed as base64 so that no binary blob
 * resembling an image enters git at all.
 *
 * Importable from `*.test.ts` only.
 */

import { deflateSync } from 'node:zlib';
import { PNG_COLOR_TYPE, PNG_SIGNATURE } from '@shared/png';

function uint32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

/** PNG's CRC-32, computed the long way so no dependency is needed. */
function crc32(bytes: number[]): number {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: number[]): number[] {
  const typeBytes = [...type].map((character) => character.charCodeAt(0));
  const payload = [...typeBytes, ...data];
  return [...uint32(data.length), ...payload, ...uint32(crc32(payload))];
}

export interface TestPngOptions {
  width?: number;
  height?: number;
  /** Default 6 (truecolour + alpha), i.e. a transparent-capable image. */
  colorType?: number;
}

/**
 * Build a valid PNG of the requested size and colour type.
 *
 * The pixel data is a single flat colour. That is the point: it is an image
 * file, not a picture of anything.
 */
export function TEST_ONLY_buildPng(options: TestPngOptions = {}): number[] {
  const width = options.width ?? 640;
  const height = options.height ?? 120;
  const colorType = options.colorType ?? PNG_COLOR_TYPE.truecolourAlpha;

  const channels =
    colorType === PNG_COLOR_TYPE.truecolourAlpha
      ? 4
      : colorType === PNG_COLOR_TYPE.truecolour
        ? 3
        : colorType === PNG_COLOR_TYPE.greyscaleAlpha
          ? 2
          : 1;

  const ihdr = chunk('IHDR', [
    ...uint32(width),
    ...uint32(height),
    8, // bit depth
    colorType,
    0, // compression
    0, // filter
    0, // interlace
  ]);

  // Each scanline is prefixed with a filter byte, then flat pixel data.
  const raw: number[] = [];
  for (let row = 0; row < height; row++) {
    raw.push(0);
    for (let column = 0; column < width * channels; column++) raw.push(0);
  }

  const idat = chunk('IDAT', [...deflateSync(Buffer.from(raw))]);
  const iend = chunk('IEND', []);

  return [...PNG_SIGNATURE, ...ihdr, ...idat, ...iend];
}

/** A PNG with no alpha channel — accepted, but warned about. */
export function TEST_ONLY_buildOpaquePng(width = 640, height = 120): number[] {
  return TEST_ONLY_buildPng({ width, height, colorType: PNG_COLOR_TYPE.truecolour });
}

/** JPEG magic bytes plus filler. Valid-looking file, wrong format. */
export function TEST_ONLY_buildJpeg(): number[] {
  const header = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00];
  return [...header, ...new Array<number>(200).fill(0x20), 0xff, 0xd9];
}

/** Base64 for a byte array, using Node's Buffer — test-side only. */
export function TEST_ONLY_toBase64(bytes: number[]): string {
  return Buffer.from(bytes).toString('base64');
}
