/**
 * TEST ONLY — the browser half of the PDF end-to-end check.
 *
 * Runs the real generator in a real browser, with the assets fetched over HTTP
 * exactly as the application fetches them. The Node suite proves the document
 * is correct; this proves the browser path works at all — asset fetching,
 * fontkit's WASM-free TTF parsing, and pdf-lib in a DOM environment.
 *
 * The result is written into the page as JSON for Playwright to read.
 */

import { loadPdfAssets } from '@/services/pdf/pdf-assets';
import { generateQuotationPdf } from '@/services/pdf/pdf-generator';
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
  const assets = await loadPdfAssets(bytesOf(TINY_PNG));

  const single = await generateQuotationPdf(makeModel(1), assets);
  // Enough rows that the table must split, so the pagination controller is
  // genuinely exercised in the browser rather than merely constructed.
  const many = await generateQuotationPdf(makeModel(60), assets);

  return {
    ok: true,
    pageCount: single.pageCount,
    manyPageCount: many.pageCount,
    filename: single.filename,
    byteLength: single.bytes.byteLength,
    magic: String.fromCharCode(...single.bytes.subarray(0, 5)),
    letterheadBytes: assets.letterhead.byteLength,
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
