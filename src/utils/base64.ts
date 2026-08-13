/**
 * Bytes to base64, for putting a generated document in a JSON body.
 *
 * The obvious one-liner — `btoa(String.fromCharCode(...bytes))` — throws
 * `RangeError: Maximum call stack size exceeded` somewhere around 100 KB,
 * because spreading an array into arguments is bounded by the call stack. A
 * quotation PDF is over a megabyte, so it would fail on every real document and
 * pass on every small test fixture.
 *
 * Chunking sidesteps that entirely.
 */

/** Small enough to stay well inside the argument limit on every engine. */
const CHUNK_SIZE = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';

  for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
    const chunk = bytes.subarray(offset, offset + CHUNK_SIZE);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}
