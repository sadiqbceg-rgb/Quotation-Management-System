/**
 * TEST ONLY — synthetic quotation documents.
 *
 * ---------------------------------------------------------------------------
 * THESE ARE NOT QUOTATIONS
 * ---------------------------------------------------------------------------
 * A PDF header or a ZIP header followed by filler. They exist to exercise the
 * upload path — magic bytes, size caps, replace-in-place — not to represent a
 * document. Nothing here contains a client, a price, a quotation number or a
 * signature, and the upload path never parses the content.
 *
 * The REAL generators are tested against real output in `src/services/pdf` and
 * `src/services/docx`; those tests parse actual PDFs and unzip actual DOCX
 * packages. What this file covers is the byte-level contract between the
 * browser and Drive, which needs no real document at all.
 *
 * Built at runtime rather than committed as base64, so no binary blob enters
 * git. Importable from `*.test.ts` only.
 */

const MAGIC = {
  pdf: [0x25, 0x50, 0x44, 0x46, 0x2d],
  docx: [0x50, 0x4b, 0x03, 0x04],
} as const;

export type TestDocumentKind = keyof typeof MAGIC;

/** A byte array with the right leading bytes, padded to `byteLength`. */
export function TEST_ONLY_documentBytes(kind: TestDocumentKind, byteLength = 2_048): number[] {
  const magic = [...MAGIC[kind]];
  const bytes: number[] = magic.slice(0, byteLength);

  // Filler is deterministic, so a test can assert that content really changed
  // between two uploads of different sizes.
  for (let index = bytes.length; index < byteLength; index++) {
    bytes.push(index % 251);
  }
  return bytes;
}

export function TEST_ONLY_documentBase64(kind: TestDocumentKind, byteLength = 2_048): string {
  return Buffer.from(Uint8Array.from(TEST_ONLY_documentBytes(kind, byteLength))).toString('base64');
}

/** Bytes with the WRONG magic — a file claiming to be something it is not. */
export function TEST_ONLY_wrongFormatBase64(byteLength = 2_048): string {
  const bytes: number[] = [0x89, 0x50, 0x4e, 0x47];
  for (let index = bytes.length; index < byteLength; index++) bytes.push(index % 251);

  return Buffer.from(Uint8Array.from(bytes)).toString('base64');
}
