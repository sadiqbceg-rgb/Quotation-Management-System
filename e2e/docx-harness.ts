/**
 * TEST ONLY — the browser half of the DOCX end-to-end check.
 *
 * Runs the real generator in a real browser, with the letterhead images fetched
 * over HTTP exactly as the application fetches them. The Node suite proves the
 * DOCUMENT is correct; this proves the browser path works at all — asset
 * fetching, and `docx` packing a ZIP without Node's Buffer or zlib.
 *
 * The result is written into the page as JSON for Playwright to read.
 */

import { loadDocxAssets } from '@/services/docx/docx-assets';
import { generateQuotationDocx } from '@/services/docx/docx-generator';
import { buildDocumentModel } from '@/services/document/build-document-model';
import { calculateTotals } from '@shared/totals';
import { halalas, milli } from '@shared/money';
import type { ImageRef } from '@/services/document/document-model.types';

const BLANK: ImageRef = { src: '', alt: '', intrinsicWidth: 0, intrinsicHeight: 0 };

/** Not a signature: a 1×1 transparent PNG, so the embedder has valid bytes. */
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function bytesOf(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function makeLines(count: number) {
  return Array.from({ length: count }, (_value, index) => ({
    category: 'Manpower' as const,
    description: `TEST_ONLY General Labour ${String(index + 1)}`,
    quantity: milli(40_000),
    unit: 'Hour',
    unitPrice: halalas(2000),
    amount: halalas(80_000),
    remarks: '',
  }));
}

function makeModel(rowCount: number) {
  const lines = makeLines(rowCount);

  return buildDocumentModel({
    quotationNumber: 'SFC/RUH/QTN/2026/004',
    quotationDate: '2026-08-11',
    quotationFor: 'TEST_ONLY Manpower Supply',
    pricingMode: 'amount',
    scopeOfWork: 'TEST_ONLY scope paragraph.',
    client: {
      clientName: 'TEST_ONLY Contact',
      companyName: 'TEST_ONLY Client Company',
      address: 'TEST_ONLY Address',
      contactPerson: 'TEST_ONLY Attention',
    },
    lines,
    totals: calculateTotals({
      lines: lines.map((line) => ({
        category: line.category,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
      })),
    }),
    terms: [{ title: 'TEST_ONLY Working Hours', body: 'TEST_ONLY minimum hours per day.' }],
    closingParagraph: 'TEST_ONLY closing.',
    signatory: {
      name: 'TEST_ONLY_Signatory',
      designation: 'TEST_ONLY Designation',
      companyName: 'TEST_ONLY Company',
      country: 'TEST_ONLY Country',
      phone: '+966 50 000 0000',
      email: 'test-only@example.invalid',
    },
    assets: { seal: BLANK, signature: BLANK },
  });
}

async function run(): Promise<Record<string, unknown>> {
  const assets = await loadDocxAssets(bytesOf(TINY_PNG));

  const single = await generateQuotationDocx(makeModel(1), assets);
  // Enough rows that Word will have to break the table, so the repeating
  // header is genuinely present rather than merely configured.
  const many = await generateQuotationDocx(makeModel(60), assets);

  return {
    ok: true,
    filename: single.filename,
    byteLength: single.bytes.byteLength,
    manyByteLength: many.bytes.byteLength,
    magic: Array.from(single.bytes.subarray(0, 4)),
    watermarkBytes: assets.watermark.byteLength,
    sealBytes: assets.seal.byteLength,
    estimatedPageCount: many.estimatedPageCount,
  };
}

run()
  .then((result) => {
    document.title = 'done';
    const node = document.getElementById('result');
    if (node !== null) node.textContent = JSON.stringify(result);
  })
  .catch((error: unknown) => {
    document.title = 'done';
    const node = document.getElementById('result');
    if (node !== null) {
      node.textContent = JSON.stringify({
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
