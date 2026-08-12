/**
 * A minimal PNG header reader, shared by the browser upload preview and the
 * Apps Script upload validator.
 *
 * See IMPLEMENTATION_PLAN.md §11.2 and PRD §33 item 14.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS AT ALL
 * ---------------------------------------------------------------------------
 * The server must decide whether an upload is really a PNG from the BYTES, not
 * from the declared MIME type or the filename — both are attacker-controlled.
 * The browser wants the same answer, so the user learns their file is wrong
 * before waiting for a round trip. One reader, used by both, means the preview
 * cannot promise something the server will reject.
 *
 * It reads the 8-byte signature and the IHDR chunk. That is all this system
 * needs: dimensions, and whether the image can carry transparency. It decodes
 * no pixels, so there is no decompression path and nothing to exploit.
 *
 * No image library is used, and none should be added — PRD's build rules keep
 * the dependency surface small, and this is roughly forty lines.
 */

/** `\x89PNG\r\n\x1a\n` — the fixed 8-byte PNG signature. */
export const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/**
 * PNG colour types, from the specification.
 *
 * 4 (greyscale+alpha) and 6 (truecolour+alpha) carry an alpha channel outright.
 * 3 (indexed) may carry transparency through a `tRNS` chunk, which is checked
 * separately.
 */
export const PNG_COLOR_TYPE = {
  greyscale: 0,
  truecolour: 2,
  indexed: 3,
  greyscaleAlpha: 4,
  truecolourAlpha: 6,
} as const;

export interface PngHeader {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  /**
   * Whether the image can represent transparency.
   *
   * This matters more than it sounds: a signature scanned onto opaque white
   * paints a white rectangle over the letterhead in the finished quotation.
   * The upload flow warns rather than refuses, because cropping and background
   * removal are the company's call, not the system's.
   */
  hasAlpha: boolean;
}

/** True when the first eight bytes are the PNG signature. */
export function hasPngSignature(bytes: ArrayLike<number>): boolean {
  if (bytes.length < PNG_SIGNATURE.length) return false;

  for (let index = 0; index < PNG_SIGNATURE.length; index++) {
    // Apps Script byte arrays are SIGNED (-128..127); normalise before compare.
    const byte = bytes[index] ?? 0;
    if ((byte < 0 ? byte + 256 : byte) !== PNG_SIGNATURE[index]) return false;
  }
  return true;
}

function byteAt(bytes: ArrayLike<number>, index: number): number {
  const value = bytes[index] ?? 0;
  return value < 0 ? value + 256 : value;
}

function readUint32(bytes: ArrayLike<number>, offset: number): number {
  return (
    byteAt(bytes, offset) * 0x1000000 +
    byteAt(bytes, offset + 1) * 0x10000 +
    byteAt(bytes, offset + 2) * 0x100 +
    byteAt(bytes, offset + 3)
  );
}

function chunkTypeAt(bytes: ArrayLike<number>, offset: number): string {
  let type = '';
  for (let index = 0; index < 4; index++) {
    type += String.fromCharCode(byteAt(bytes, offset + index));
  }
  return type;
}

/**
 * True when an indexed-colour PNG declares a `tRNS` transparency chunk.
 *
 * Walks the chunk list rather than scanning for the four letters anywhere in
 * the file — pixel data can contain any byte sequence, so a naive search would
 * report transparency for an opaque image often enough to be useless.
 */
function hasTransparencyChunk(bytes: ArrayLike<number>): boolean {
  // 8-byte signature, then chunks: length(4) type(4) data(length) crc(4).
  let offset = 8;

  while (offset + 8 <= bytes.length) {
    const length = readUint32(bytes, offset);
    const type = chunkTypeAt(bytes, offset + 4);

    if (type === 'tRNS') return true;
    // Everything transparency-related precedes the pixel data.
    if (type === 'IDAT' || type === 'IEND') return false;
    if (length < 0 || length > bytes.length) return false;

    offset += 12 + length;
  }

  return false;
}

/**
 * Read a PNG's IHDR. Returns null when the bytes are not a readable PNG.
 *
 * Deliberately total: it never throws, so a caller cannot forget a try/catch on
 * a path that handles untrusted input.
 */
export function readPngHeader(bytes: ArrayLike<number>): PngHeader | null {
  // Signature(8) + length(4) + "IHDR"(4) + 13 bytes of header data.
  if (bytes.length < 33) return null;
  if (!hasPngSignature(bytes)) return null;
  if (chunkTypeAt(bytes, 12) !== 'IHDR') return null;

  const width = readUint32(bytes, 16);
  const height = readUint32(bytes, 20);
  const bitDepth = byteAt(bytes, 24);
  const colorType = byteAt(bytes, 25);

  if (width === 0 || height === 0) return null;

  const hasAlpha =
    colorType === PNG_COLOR_TYPE.greyscaleAlpha ||
    colorType === PNG_COLOR_TYPE.truecolourAlpha ||
    (colorType === PNG_COLOR_TYPE.indexed && hasTransparencyChunk(bytes));

  return { width, height, bitDepth, colorType, hasAlpha };
}

/**
 * Strip a filename to a safe leaf name.
 *
 * Path separators and `..` are removed rather than escaped, so nothing that
 * reaches Drive can describe a location. An empty result means the caller
 * should supply its own name instead of trusting the upload.
 */
export function sanitizeFilename(name: string): string {
  const leaf = name.split('/').join('_').split('\\').join('_').replace(/\.\.+/g, '.');
  return leaf.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 100);
}
