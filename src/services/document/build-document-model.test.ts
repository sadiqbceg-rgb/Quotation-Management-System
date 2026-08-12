import { describe, expect, it } from 'vitest';

import { buildDocumentModel, checkModelStructure, type BuildDocumentInput } from './build-document-model';
import type { DocumentBlock, DocumentModel, ImageRef } from './document-model.types';
import { calculateTotals } from '@shared/totals';
import { halalas, milli } from '@shared/money';
import { DRAFT_NUMBER_PLACEHOLDER, META_LABELS } from '@/config/document-layout';
import type { ItemCategory } from '@shared/types';

/* -------------------------------------------------------------------------- */
/* Fixtures — obviously synthetic, never production data                      */
/* -------------------------------------------------------------------------- */

const TEST_ONLY_IMAGE: ImageRef = {
  src: 'test-only://seal',
  alt: 'TEST_ONLY seal',
  intrinsicWidth: 800,
  intrinsicHeight: 731,
};

function line(overrides: Partial<BuildDocumentInput['lines'][number]> = {}) {
  return {
    category: 'Manpower' as ItemCategory,
    description: 'TEST_ONLY General Labour',
    // Quantities are integer THOUSANDTHS: 40_000 milli = 40 units.
    quantity: milli(40_000),
    unit: 'Hour',
    // Prices are integer halalas: 2000 = SAR 20.00.
    unitPrice: halalas(2000),
    amount: halalas(80_000),
    remarks: '',
    ...overrides,
  };
}

function input(overrides: Partial<BuildDocumentInput> = {}): BuildDocumentInput {
  const lines = overrides.lines ?? [line()];

  return {
    quotationNumber: 'SFC/RUH/QTN/2026/004',
    quotationDate: '2026-08-11',
    quotationFor: 'TEST_ONLY Manpower Supply',
    pricingMode: 'amount',
    scopeOfWork: 'TEST_ONLY scope paragraph.',
    client: {
      clientName: 'TEST_ONLY Contact',
      companyName: 'TEST_ONLY Client Co.',
      address: 'TEST_ONLY Address, Riyadh',
      contactPerson: 'TEST_ONLY Attention',
    },
    lines,
    totals: calculateTotals({
      lines: lines.map((entry) => ({
        category: entry.category,
        quantity: entry.quantity,
        unitPrice: entry.unitPrice,
      })),
    }),
    terms: [{ title: 'TEST_ONLY Working Hours', body: 'TEST_ONLY minimum hours per day.' }],
    closingParagraph: 'TEST_ONLY thank you.\n\nTEST_ONLY please issue the P.O.',
    signatory: {
      name: 'TEST_ONLY_Signatory',
      designation: 'TEST_ONLY Designation',
      companyName: 'TEST_ONLY Company',
      country: 'TEST_ONLY Country',
      phone: '+966 50 000 0000',
      email: 'test-only@example.invalid',
    },
    assets: { seal: TEST_ONLY_IMAGE, signature: TEST_ONLY_IMAGE },
    ...overrides,
  };
}

function kinds(model: DocumentModel): string[] {
  return model.blocks.map((block) => block.kind);
}

function blockOf<K extends DocumentBlock['kind']>(
  model: DocumentModel,
  kind: K,
): Extract<DocumentBlock, { kind: K }> | undefined {
  return model.blocks.find((block): block is Extract<DocumentBlock, { kind: K }> => block.kind === kind);
}

/* -------------------------------------------------------------------------- */

describe('purity (§12.1)', () => {
  it('returns a deeply equal model for the same input', () => {
    const source = input();
    expect(buildDocumentModel(source)).toEqual(buildDocumentModel(source));
  });

  it('does not mutate its input', () => {
    const source = input();
    const before = JSON.stringify(source);

    buildDocumentModel(source);
    expect(JSON.stringify(source)).toBe(before);
  });

  it('is unaffected by the passage of time', () => {
    const source = input();
    const first = buildDocumentModel(source);

    // Nothing in the model may come from a clock; a document built twice must
    // be identical or the PDF and the DOCX could disagree.
    const second = buildDocumentModel(source);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

describe('section order (§12.2)', () => {
  it('matches the approved document', () => {
    expect(kinds(buildDocumentModel(input()))).toEqual([
      'meta',
      'heading',
      'paragraph',
      'table',
      'summaryLine',
      'totals',
      'heading',
      'termsList',
      'closing',
      'signature',
    ]);
  });

  it('numbers sections positionally', () => {
    const headings = buildDocumentModel(input()).blocks.filter((b) => b.kind === 'heading');

    expect(headings.map((heading) => [heading.number, heading.text])).toEqual([
      [1, 'Scope of Work'],
      [2, 'General Terms & Conditions'],
    ]);
  });

  it('renumbers when the items section is omitted', () => {
    const model = buildDocumentModel(input({ lines: [] }));
    const headings = model.blocks.filter((block) => block.kind === 'heading');

    // Terms becomes section 1, not section 2 with a gap where scope was.
    expect(headings.map((heading) => [heading.number, heading.text])).toEqual([
      [1, 'General Terms & Conditions'],
    ]);
  });

  it('omits the terms heading entirely when there are no terms', () => {
    const model = buildDocumentModel(input({ terms: [] }));

    expect(kinds(model)).not.toContain('termsList');
    expect(model.blocks.filter((block) => block.kind === 'heading')).toHaveLength(1);
  });

  it('omits the signature block on a draft with no signatory', () => {
    expect(kinds(buildDocumentModel(input({ signatory: null })))).not.toContain('signature');
  });

  it('omits the scope paragraph when none was written', () => {
    const model = buildDocumentModel(input({ scopeOfWork: '   ' }));
    expect(kinds(model)).not.toContain('paragraph');
  });
});

describe('the meta block', () => {
  it('uses the reference labels in the reference order', () => {
    const meta = blockOf(buildDocumentModel(input()), 'meta');

    expect(meta?.rows.map((row) => row.label)).toEqual([
      META_LABELS.quotationFor,
      META_LABELS.quotationNumber,
      META_LABELS.date,
      META_LABELS.attention,
      META_LABELS.client,
      META_LABELS.address,
    ]);
  });

  it('formats the date as DD-MM-YYYY, as the approved document does', () => {
    const meta = blockOf(buildDocumentModel(input()), 'meta');
    const date = meta?.rows.find((row) => row.label === META_LABELS.date);

    expect(date?.value).toBe('11-08-2026');
  });

  it('omits a row with no value rather than printing a blank label', () => {
    const model = buildDocumentModel(
      input({
        client: {
          clientName: 'TEST_ONLY Contact',
          companyName: 'TEST_ONLY Client Co.',
          address: 'TEST_ONLY Address',
          contactPerson: '',
        },
      }),
    );

    const labels = blockOf(model, 'meta')?.rows.map((row) => row.label) ?? [];
    expect(labels).not.toContain(META_LABELS.attention);
  });
});

describe('the quotation number', () => {
  it('carries the canonical number and derives the file-safe form', () => {
    const model = buildDocumentModel(input());

    expect(model.quotationNumber).toBe('SFC/RUH/QTN/2026/004');
    expect(model.fileSafeNumber).toBe('SFC-RUH-QTN-2026-004');
  });

  it('shows a placeholder on a draft, never an invented number', () => {
    const model = buildDocumentModel(input({ quotationNumber: '' }));
    const number = blockOf(model, 'meta')?.rows.find(
      (row) => row.label === META_LABELS.quotationNumber,
    );

    expect(number?.value).toBe(DRAFT_NUMBER_PLACEHOLDER);
    expect(model.quotationNumber).toBe('');
    // A file-safe name from nothing would create an unfindable Drive folder.
    expect(model.fileSafeNumber).toBe('');
  });

  it('refuses to derive a file-safe name from a malformed number', () => {
    const model = buildDocumentModel(input({ quotationNumber: 'not-a-number' }));
    expect(model.fileSafeNumber).toBe('');
  });
});

describe('conditional columns (PRD §17, §19)', () => {
  it('hides Remarks when no item has one', () => {
    const model = buildDocumentModel(input());

    expect(model.showRemarksColumn).toBe(false);
    expect(blockOf(model, 'table')?.columns.map((c) => c.key)).not.toContain('remarks');
  });

  it('shows Remarks for every table as soon as one item has one', () => {
    const model = buildDocumentModel(
      input({
        lines: [
          line({ remarks: 'TEST_ONLY note' }),
          line({ category: 'Equipment', description: 'TEST_ONLY Crane' }),
        ],
      }),
    );

    expect(model.showRemarksColumn).toBe(true);

    // Both tables, not just the one with the remark — a page with two tables of
    // different column counts is not something the approved layout ever does.
    for (const block of model.blocks) {
      if (block.kind === 'table') {
        expect(block.columns.map((column) => column.key)).toContain('remarks');
      }
    }
  });

  it('drops the Amount column and the totals block in rate-only mode', () => {
    const model = buildDocumentModel(input({ pricingMode: 'rate-only' }));

    expect(blockOf(model, 'table')?.columns.map((c) => c.key)).not.toContain('amount');
    expect(kinds(model)).not.toContain('totals');
  });

  it('includes both in amount mode', () => {
    const model = buildDocumentModel(input());

    expect(blockOf(model, 'table')?.columns.map((c) => c.key)).toContain('amount');
    expect(kinds(model)).toContain('totals');
  });

  it('gives every table column a width share summing to one', () => {
    const table = blockOf(buildDocumentModel(input()), 'table');
    const total = (table?.columns ?? []).reduce((sum, column) => sum + column.widthRatio, 0);

    expect(total).toBeCloseTo(1, 10);
  });
});

describe('category tables', () => {
  it('uses the PRD heading for each category', () => {
    const model = buildDocumentModel(
      input({
        lines: [
          line(),
          line({ category: 'Equipment', description: 'TEST_ONLY Crane' }),
          line({ category: 'Materials', description: 'TEST_ONLY Cement' }),
        ],
      }),
    );

    const headers = model.blocks
      .filter((block) => block.kind === 'table')
      .map((block) => block.columns[0]?.header);

    expect(headers).toEqual(['Designation', 'Equipment Description', 'Material Description']);
  });

  it('orders categories by the PRD order, not by insertion', () => {
    const model = buildDocumentModel(
      input({
        lines: [
          line({ category: 'Materials', description: 'TEST_ONLY Cement' }),
          line({ category: 'Manpower' }),
        ],
      }),
    );

    const categories = model.blocks
      .filter((block) => block.kind === 'table')
      .map((block) => block.category);

    expect(categories).toEqual(['Manpower', 'Materials']);
  });

  it('emits the category summary line the approved document shows', () => {
    const model = buildDocumentModel(input({ lines: [line({ quantity: milli(41_000) })] }));
    const summary = blockOf(model, 'summaryLine');

    expect(summary?.label).toBe('Total Manpower:');
    expect(summary?.value).toBe('41 Persons');
  });
});

describe('closing paragraphs', () => {
  it('splits the stored text on blank lines', () => {
    const closing = blockOf(buildDocumentModel(input()), 'closing');

    expect(closing?.paragraphs).toEqual([
      'TEST_ONLY thank you.',
      'TEST_ONLY please issue the P.O.',
    ]);
  });

  it('omits the block when there is no closing text', () => {
    expect(kinds(buildDocumentModel(input({ closingParagraph: '  ' })))).not.toContain('closing');
  });
});

describe('the signature block', () => {
  it('carries the six lines in the approved order', () => {
    const signature = blockOf(buildDocumentModel(input()), 'signature');

    expect(signature?.left).toEqual([
      'TEST_ONLY_Signatory',
      'TEST_ONLY Designation',
      'TEST_ONLY Company',
      'TEST_ONLY Country',
      'Mobile : +966 50 000 0000',
      'Email: test-only@example.invalid',
    ]);
  });

  it('is atomic and carries both images', () => {
    const signature = blockOf(buildDocumentModel(input()), 'signature');

    expect(signature?.keepTogether).toBe(true);
    expect(signature?.sealImage.src).toBe(TEST_ONLY_IMAGE.src);
    expect(signature?.signatureImage.src).toBe(TEST_ONLY_IMAGE.src);
  });
});

describe('structural checks', () => {
  it('passes for a well-formed model', () => {
    expect(checkModelStructure(buildDocumentModel(input()))).toEqual([]);
  });

  it('catches an empty document', () => {
    const model = buildDocumentModel(input());
    expect(checkModelStructure({ ...model, blocks: [] })[0]?.code).toBe('EMPTY');
  });

  it('catches a meta block that is not first', () => {
    const model = buildDocumentModel(input());
    const reordered = [...model.blocks].reverse();

    const codes = checkModelStructure({ ...model, blocks: reordered }).map((p) => p.code);
    expect(codes).toContain('META_NOT_FIRST');
  });

  it('catches a duplicated signature block', () => {
    const model = buildDocumentModel(input());
    const signature = blockOf(model, 'signature');
    expect(signature).toBeDefined();

    const codes = checkModelStructure({
      ...model,
      blocks: [...model.blocks, signature as DocumentBlock],
    }).map((problem) => problem.code);

    expect(codes).toContain('SIGNATURE_COUNT');
  });

  it('catches a table with no header', () => {
    const model = buildDocumentModel(input());
    const blocks = model.blocks.map((block) =>
      block.kind === 'table' ? { ...block, columns: [] } : block,
    );

    const codes = checkModelStructure({ ...model, blocks }).map((problem) => problem.code);
    expect(codes).toContain('TABLE_WITHOUT_HEADER');
  });

  it('catches non-consecutive section numbers', () => {
    const model = buildDocumentModel(input());
    const blocks = model.blocks.map((block) =>
      block.kind === 'heading' && block.number === 2 ? { ...block, number: 3 } : block,
    );

    const codes = checkModelStructure({ ...model, blocks }).map((problem) => problem.code);
    expect(codes).toContain('HEADING_NUMBERING');
  });
});

describe('page numbers (§26 UR-07)', () => {
  it('are off by default, matching the approved document', () => {
    expect(buildDocumentModel(input()).showPageNumbers).toBe(false);
  });

  it('can be turned on', () => {
    expect(buildDocumentModel(input({ showPageNumbers: true })).showPageNumbers).toBe(true);
  });
});
