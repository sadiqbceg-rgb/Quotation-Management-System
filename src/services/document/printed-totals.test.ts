/**
 * The arithmetic a CLIENT can do with a printed quotation.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS SEPARATE FROM shared/totals.test.ts
 * ---------------------------------------------------------------------------
 * `totals.test.ts` proves the integer arithmetic is right. It cannot prove that
 * the arithmetic survives being FORMATTED — and the renderer does not print
 * halalas, it prints "1,234.56". A quotation whose Amount column does not add
 * up to its own printed Subtotal is wrong on the only terms that matter, even
 * when every internal value is correct, because the client with a calculator is
 * the one who finds it.
 *
 * So these parse the strings back out of the built document model and add them
 * up the way a reader would.
 */

import { describe, expect, it } from 'vitest';

import { halalas, milli, formatSar, type Halalas } from '@shared/money';
import { calculateLineAmount, calculateTotals, type TotalsLineInput } from '@shared/totals';
import type { ItemCategory } from '@shared/types';
import { buildDocumentModel, type BuildDocumentInput } from './build-document-model';
import type { DocumentModel } from './document-model.types';

/** A printed money string, back to halalas. `"1,234.56"` → `123456`. */
function parsePrinted(value: string): number {
  const digits = value.replace(/[^\d.-]/g, '');
  const asNumber = Number.parseFloat(digits);

  if (Number.isNaN(asNumber)) throw new Error(`Not a printed amount: "${value}"`);
  // Two decimal places, so a round-trip through the string is exact.
  return Math.round(asNumber * 100);
}

interface Line {
  category: ItemCategory;
  quantity: number;
  unitPrice: number;
}

function buildModel(lines: readonly Line[], overrides: Partial<BuildDocumentInput> = {}) {
  const modelLines: BuildDocumentInput['lines'] = lines.map((line, index) => {
    const quantity = milli(Math.round(line.quantity * 1_000));
    const unitPrice = halalas(Math.round(line.unitPrice * 100));

    return {
      category: line.category,
      description: `TEST_ONLY item ${String(index + 1)}`,
      quantity,
      unit: 'Nos.',
      unitPrice,
      // The same rounding step the totals use, so the printed column and the
      // printed total cannot disagree by construction — which is the property
      // under test, not an assumption baked into the fixture.
      amount: calculateLineAmount(quantity, unitPrice),
      remarks: '',
    };
  });

  const totalsInput: TotalsLineInput[] = modelLines.map((line) => ({
    category: line.category,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
  }));

  return buildDocumentModel({
    quotationNumber: 'SFC/RUH/QTN/2026/001',
    quotationDate: '2026-08-11',
    quotationFor: 'TEST_ONLY printed totals',
    pricingMode: 'amount',
    scopeOfWork: '',
    client: {
      clientName: 'TEST_ONLY Contact',
      companyName: 'TEST_ONLY Client Co.',
      address: 'TEST_ONLY Address',
      contactPerson: '',
    },
    lines: modelLines,
    totals: calculateTotals({
      lines: totalsInput,
      ...(overrides.totals === undefined ? {} : {}),
    }),
    terms: [],
    closingParagraph: 'TEST_ONLY closing.',
    signatory: null,
    assets: {
      seal: { src: '', alt: 'TEST_ONLY', intrinsicWidth: 0, intrinsicHeight: 0 },
      signature: { src: '', alt: 'TEST_ONLY', intrinsicWidth: 0, intrinsicHeight: 0 },
    },
    ...overrides,
  });
}

/** Every Amount cell printed in every category table, as halalas. */
function printedAmounts(model: DocumentModel): number[] {
  const amounts: number[] = [];

  for (const block of model.blocks) {
    if (block.kind !== 'table') continue;

    const column = block.columns.findIndex((spec) => spec.key === 'amount');
    if (column < 0) continue;

    for (const row of block.rows) {
      const cell = row[column];
      if (cell !== undefined) amounts.push(parsePrinted(cell));
    }
  }

  return amounts;
}

/** A labelled line from the printed totals block, as halalas. */
function printedTotal(model: DocumentModel, label: string): number {
  for (const block of model.blocks) {
    if (block.kind !== 'totals') continue;

    const found = block.lines.find((line) => line.label.startsWith(label));
    if (found !== undefined) return parsePrinted(found.value);
  }
  throw new Error(`No printed totals line beginning "${label}"`);
}

/** Every printed category summary line, as halalas, keyed by its label. */
function printedCategoryTotals(model: DocumentModel): Record<string, number> {
  const result: Record<string, number> = {};

  for (const block of model.blocks) {
    if (block.kind !== 'totals') continue;
    for (const line of block.lines) {
      if (line.label.startsWith('Total ')) {
        result[line.label.replace('Total ', '')] = parsePrinted(line.value);
      }
    }
  }
  return result;
}

/** A repeatable, awkward spread of quantities and prices. */
function awkwardLines(count: number): Line[] {
  return Array.from({ length: count }, (_unused, index) => ({
    category: (['Manpower', 'Equipment', 'Materials'] as const)[index % 3] ?? 'Materials',
    // Thirds, eighths and sevenths — the quantities that round.
    quantity: 1 + (index % 7) * 0.125 + (index % 3) * 0.333,
    unitPrice: 3.33 + (index % 5) * 0.07 + (index % 11) * 1.01,
  }));
}

/* -------------------------------------------------------------------------- */

describe('the printed Amount column', () => {
  it('adds up exactly to the printed Subtotal across 200 lines', () => {
    const model = buildModel(awkwardLines(200));
    const amounts = printedAmounts(model);

    expect(amounts).toHaveLength(200);
    expect(amounts.reduce((sum, amount) => sum + amount, 0)).toBe(printedTotal(model, 'Subtotal'));
  });

  it('adds up exactly across 1,000 lines, with no drift', () => {
    // Float accumulation would show here and nowhere smaller: 1,000 additions
    // of two-decimal values is where 0.1 + 0.2 stops being a curiosity.
    const model = buildModel(awkwardLines(1_000));
    const amounts = printedAmounts(model);

    expect(amounts).toHaveLength(1_000);
    expect(amounts.reduce((sum, amount) => sum + amount, 0)).toBe(printedTotal(model, 'Subtotal'));
  });

  it('adds up within each category to that category summary line', () => {
    const model = buildModel(awkwardLines(120));

    const byCategory: Record<string, number> = {};
    for (const block of model.blocks) {
      if (block.kind !== 'table') continue;
      const column = block.columns.findIndex((spec) => spec.key === 'amount');

      byCategory[block.category] = block.rows.reduce((sum, row) => {
        const cell = row[column];
        return cell === undefined ? sum : sum + parsePrinted(cell);
      }, 0);
    }

    expect(byCategory).toEqual(printedCategoryTotals(model));
  });

  it('has category summaries that themselves add to the printed Subtotal', () => {
    const model = buildModel(awkwardLines(120));
    const categories = Object.values(printedCategoryTotals(model));

    expect(categories.reduce((sum, value) => sum + value, 0)).toBe(
      printedTotal(model, 'Subtotal'),
    );
  });
});

describe('the printed totals block', () => {
  it('reaches the printed Grand Total by the arithmetic a reader would do', () => {
    const model = buildModel(awkwardLines(50));

    const subtotal = printedTotal(model, 'Subtotal');
    const vat = printedTotal(model, 'VAT');
    const grand = printedTotal(model, 'Grand Total');

    expect(subtotal + vat).toBe(grand);
  });

  it('reaches it through the discount lines when a discount applies', () => {
    const model = buildModel(awkwardLines(50), {
      totals: calculateTotals({
        lines: awkwardLines(50).map((line) => ({
          category: line.category,
          quantity: milli(Math.round(line.quantity * 1_000)),
          unitPrice: halalas(Math.round(line.unitPrice * 100)),
        })),
        discountRateBasisPoints: 750,
      }),
    });

    const subtotal = printedTotal(model, 'Subtotal');
    const discount = printedTotal(model, 'Discount');
    const taxable = printedTotal(model, 'Taxable amount');
    const vat = printedTotal(model, 'VAT');
    const grand = printedTotal(model, 'Grand Total');

    // Every step is visible on the page, and every step checks out.
    expect(subtotal - Math.abs(discount)).toBe(taxable);
    expect(taxable + vat).toBe(grand);
  });

  it('states the VAT rate on the line, so the figure can be checked', () => {
    const model = buildModel(awkwardLines(10));
    const block = model.blocks.find((entry) => entry.kind === 'totals');
    const vatLine = block?.kind === 'totals' ? block.lines.find((l) => l.label.startsWith('VAT')) : undefined;

    expect(vatLine?.label).toBe('VAT 15%');
  });

  it('names the currency on every printed figure', () => {
    // A quotation to a Saudi client priced in an unnamed unit is ambiguous, and
    // the approved document states SAR throughout.
    const model = buildModel(awkwardLines(10));
    const block = model.blocks.find((entry) => entry.kind === 'totals');
    if (block?.kind !== 'totals') throw new Error('no totals block');

    for (const line of block.lines) {
      expect(line.value, line.label).toContain('SAR');
    }
  });
});

describe('a zero-VAT quotation', () => {
  it('prints a Grand Total equal to its Subtotal', () => {
    const lines = awkwardLines(30);
    const model = buildModel(lines, {
      totals: calculateTotals({
        lines: lines.map((line) => ({
          category: line.category,
          quantity: milli(Math.round(line.quantity * 1_000)),
          unitPrice: halalas(Math.round(line.unitPrice * 100)),
        })),
        vatRateBasisPoints: 0,
      }),
    });

    expect(printedTotal(model, 'Subtotal')).toBe(printedTotal(model, 'Grand Total'));
  });
});

describe('the formatter itself', () => {
  it('round-trips every printed amount back to the halalas it came from', () => {
    // The property the tests above rely on. If `formatSar` ever loses a halala,
    // every assertion in this file would silently start comparing the wrong
    // thing, so it is asserted directly rather than assumed.
    const values: Halalas[] = [
      halalas(0),
      halalas(1),
      halalas(99),
      halalas(100),
      halalas(123_456),
      halalas(999_999_99),
    ];

    for (const value of values) {
      expect(parsePrinted(formatSar(value)), formatSar(value)).toBe(value);
    }
  });
});
