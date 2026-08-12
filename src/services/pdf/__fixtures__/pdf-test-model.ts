/**
 * TEST ONLY — a document model to render.
 *
 * Built through the real `buildDocumentModel`, so the tests exercise the actual
 * Phase 07 → Phase 08 path rather than a hand-assembled model that could drift
 * from what the application produces.
 *
 * Every value is obviously synthetic. The client, the items and the signatory
 * are invented for the test; the quotation number is the one on the approved
 * document only because it is the format the numbering module validates.
 */

import { halalas, milli } from '@shared/money';
import { calculateTotals } from '@shared/totals';
import {
  buildDocumentModel,
  type BuildDocumentInput,
} from '@/services/document/build-document-model';
import type { DocumentModel, ImageRef } from '@/services/document/document-model.types';

const TEST_ONLY_REF: ImageRef = {
  src: '',
  alt: 'TEST_ONLY',
  intrinsicWidth: 0,
  intrinsicHeight: 0,
};

export function TEST_ONLY_line(
  overrides: Partial<BuildDocumentInput['lines'][number]> = {},
): BuildDocumentInput['lines'][number] {
  return {
    category: 'Manpower',
    description: 'TEST_ONLY General Labour',
    quantity: milli(40_000),
    unit: 'Hour',
    unitPrice: halalas(2000),
    amount: halalas(80_000),
    remarks: '',
    ...overrides,
  };
}

export function TEST_ONLY_model(overrides: Partial<BuildDocumentInput> = {}): DocumentModel {
  const lines = overrides.lines ?? [TEST_ONLY_line()];

  return buildDocumentModel({
    quotationNumber: 'SFC/RUH/QTN/2026/004',
    quotationDate: '2026-08-11',
    quotationFor: 'TEST_ONLY Manpower Supply',
    pricingMode: 'amount',
    scopeOfWork:
      'TEST_ONLY scope paragraph describing the supply of skilled manpower for the categories below.',
    client: {
      clientName: 'TEST_ONLY Contact Person',
      companyName: 'TEST_ONLY Client Company',
      address: 'TEST_ONLY Address, Riyadh',
      contactPerson: 'TEST_ONLY Attention Name',
    },
    lines,
    totals: calculateTotals({
      lines: lines.map((line) => ({
        category: line.category,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
      })),
    }),
    terms: [
      { title: 'TEST_ONLY Working Hours', body: 'TEST_ONLY minimum ten hours per day, six days.' },
      { title: 'TEST_ONLY Payment', body: 'TEST_ONLY payment within thirty days of invoice.' },
    ],
    closingParagraph: 'TEST_ONLY closing thank you.\n\nTEST_ONLY please issue the purchase order.',
    signatory: {
      name: 'TEST_ONLY_Signatory',
      designation: 'TEST_ONLY Designation',
      companyName: 'TEST_ONLY Company Name',
      country: 'TEST_ONLY Country',
      phone: '+966 50 000 0000',
      email: 'test-only@example.invalid',
    },
    assets: { seal: TEST_ONLY_REF, signature: TEST_ONLY_REF },
    ...overrides,
  });
}

/** A quotation long enough to force pagination. */
export function TEST_ONLY_longModel(rowCount = 60): DocumentModel {
  return TEST_ONLY_model({
    lines: Array.from({ length: rowCount }, (_value, index) =>
      TEST_ONLY_line({ description: `TEST_ONLY item number ${String(index + 1)}` }),
    ),
  });
}
