/**
 * Signature image types.
 *
 * See IMPLEMENTATION_PLAN.md §11.2.
 *
 * Signature bytes travel as base64 and are branded, so they cannot be confused
 * with a URL. That confusion is the specific mistake this guards against: the
 * system must never produce a public link to a signature image, and a bare
 * `string` field named `signature` is exactly how one gets introduced by
 * accident later.
 */

declare const base64PngBrand: unique symbol;

/** Base64-encoded PNG bytes, with no `data:` prefix. */
export type Base64Png = string & { readonly [base64PngBrand]: 'Base64Png' };

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

/** True for a plausible bare base64 payload — no data URI, no whitespace. */
export function isBase64Payload(value: string): boolean {
  return value.length > 0 && value.length % 4 === 0 && BASE64_PATTERN.test(value);
}

/**
 * Brand a base64 string as PNG bytes.
 *
 * Throws on anything that is not bare base64, so a `data:image/png;base64,…`
 * URI or a Drive URL cannot enter the system wearing the wrong type.
 */
export function base64Png(value: string): Base64Png {
  if (!isBase64Payload(value)) {
    throw new Error('Signature data must be bare base64, without a data: prefix.');
  }
  return value as Base64Png;
}

/** The `data:` URI form, for an `<img src>`. Built only at the render edge. */
export function toDataUri(value: Base64Png): string {
  return `data:image/png;base64,${value}`;
}

/**
 * Decode to raw bytes, for embedding in a PDF.
 *
 * `atob` is available in browsers and in Node 16+, so one implementation covers
 * the application and the tests.
 */
export function base64PngToBytes(value: Base64Png): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** Decoded byte length of a base64 payload, without decoding it. */
export function base64ByteLength(value: string): number {
  if (value.length === 0) return 0;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

/**
 * What the quotation form needs to render the signature block.
 *
 * Six text lines plus the image. The LAYOUT — details left, seal and signature
 * right — is Phase 07's problem; this is only the data contract, recorded here
 * so the two phases cannot disagree about what is available.
 */
export interface SignatureBlockData {
  name: string;
  designation: string;
  companyName: string;
  country: string;
  email: string;
  phone: string;
  /** Null while the image is still loading or could not be fetched. */
  signature: Base64Png | null;
}
