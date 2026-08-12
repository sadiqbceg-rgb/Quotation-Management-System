/**
 * Byte and encoding helpers for the auth layer.
 *
 * Apps Script returns SIGNED bytes (-128..127) from its crypto and blob APIs,
 * which is a persistent source of off-by-256 bugs. Everything here works in
 * that representation deliberately and converts only at the edges.
 */

/** UTF-8 bytes of a string, in Apps Script's signed representation. */
export function textToBytes(text: string): number[] {
  return Utilities.newBlob(text).getBytes();
}

export function bytesToBase64(bytes: number[]): string {
  return Utilities.base64Encode(bytes);
}

export function base64ToBytes(value: string): number[] {
  return Utilities.base64Decode(value);
}

/**
 * Lowercase hex.
 *
 * Credential material (password hashes and salts) is stored as hex rather than
 * base64 for a specific reason: every value written to a sheet is passed
 * through `escapeForSheet`, which prefixes an apostrophe to anything starting
 * with `=`, `+`, `-` or `@` so a client-supplied string cannot become a live
 * formula (§19.5). Base64 and base64url both contain `+`, `/` and `-`, so a
 * hash could pick up that apostrophe and no longer match on read-back — an
 * intermittent "wrong password" that depends on the random salt.
 *
 * Hex uses only [0-9a-f], so it can never collide with the escaper.
 */
export function bytesToHex(bytes: number[]): string {
  let hex = '';
  for (const byte of bytes) {
    const unsigned = byte < 0 ? byte + 256 : byte;
    hex += unsigned.toString(16).padStart(2, '0');
  }
  return hex;
}

export function hexToBytes(value: string): number[] {
  if (value.length % 2 !== 0 || !/^[0-9a-f]*$/.test(value)) {
    throw new Error('Expected a lowercase hex string of even length.');
  }
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 2) {
    const byte = Number.parseInt(value.substring(index, index + 2), 16);
    bytes.push(byte > 127 ? byte - 256 : byte);
  }
  return bytes;
}

/** base64url with the padding stripped, as JWT requires. */
export function base64UrlEncodeText(text: string): string {
  return stripPadding(Utilities.base64EncodeWebSafe(text));
}

export function base64UrlEncodeBytes(bytes: number[]): string {
  return stripPadding(Utilities.base64EncodeWebSafe(bytes));
}

export function base64UrlDecodeToText(value: string): string {
  const bytes = Utilities.base64DecodeWebSafe(restorePadding(value));
  return Utilities.newBlob(bytes).getDataAsString();
}

function stripPadding(value: string): string {
  return value.replace(/=+$/, '');
}

function restorePadding(value: string): string {
  const remainder = value.length % 4;
  return remainder === 0 ? value : value + '='.repeat(4 - remainder);
}

/**
 * Compare two strings without leaking where they first differ.
 *
 * Length is compared up front: every value compared here (a base64 digest, a
 * base64url signature) has a fixed length, so a length mismatch discloses
 * nothing an attacker does not already know.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < a.length; index++) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

/** Cryptographically random bytes, sourced from Apps Script's UUID generator. */
export function randomBytes(count: number): number[] {
  const bytes: number[] = [];
  while (bytes.length < count) {
    const hex = Utilities.getUuid().replace(/-/g, '');
    for (let index = 0; index + 1 < hex.length && bytes.length < count; index += 2) {
      const byte = Number.parseInt(hex.substring(index, index + 2), 16);
      // Convert to Apps Script's signed byte representation.
      bytes.push(byte > 127 ? byte - 256 : byte);
    }
  }
  return bytes;
}
