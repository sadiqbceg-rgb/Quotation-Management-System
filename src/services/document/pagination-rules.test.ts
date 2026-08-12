import { describe, expect, it } from 'vitest';

import {
  PaginationError,
  measureBlock,
  paginate,
  rectsIntersect,
  signatureRects,
  termItemHeight,
  estimateLineCount,
} from './pagination-rules';
import type { DocumentBlock, DocumentModel, ImageRef } from './document-model.types';
import { BODY_BOX, SIGNATURE_BLOCK } from '@/config/document-layout';

const TEST_ONLY_IMAGE: ImageRef = {
  src: 'test-only://image',
  alt: 'TEST_ONLY',
  intrinsicWidth: 10,
  intrinsicHeight: 10,
};

function model(blocks: DocumentBlock[]): DocumentModel {
  return {
    pageSize: 'A4',
    quotationNumber: 'SFC/RUH/QTN/2026/004',
    fileSafeNumber: 'SFC-RUH-QTN-2026-004',
    blocks,
    showRemarksColumn: false,
    pricingMode: 'amount',
    showPageNumbers: false,
  };
}

function metaBlock(): DocumentBlock {
  return {
    kind: 'meta',
    rows: [{ label: 'Quotation No.:', value: 'SFC/RUH/QTN/2026/004' }],
  };
}

function table(rowCount: number): DocumentBlock {
  return {
    kind: 'table',
    category: 'Manpower',
    columns: [
      { key: 'description', header: 'Designation', widthRatio: 0.5, align: 'left' },
      { key: 'quantity', header: 'Quantity', widthRatio: 0.5, align: 'center' },
    ],
    rows: Array.from({ length: rowCount }, (_value, index) => [
      `TEST_ONLY item ${String(index + 1)}`,
      '1',
    ]),
    repeatHeader: true,
  };
}

function termsList(count: number, bodyLength = 60): DocumentBlock {
  return {
    kind: 'termsList',
    items: Array.from({ length: count }, (_value, index) => ({
      title: `TEST_ONLY Term ${String(index + 1)}`,
      body: 'x'.repeat(bodyLength),
    })),
  };
}

function signature(): DocumentBlock {
  return {
    kind: 'signature',
    left: ['TEST_ONLY_Signatory', 'TEST_ONLY Designation'],
    sealImage: TEST_ONLY_IMAGE,
    signatureImage: TEST_ONLY_IMAGE,
    keepTogether: true,
  };
}

type TableBlock = Extract<DocumentBlock, { kind: 'table' }>;

function tablesOn(page: { blocks: Array<{ block: DocumentBlock }> }): TableBlock[] {
  return page.blocks
    .map((placed) => placed.block)
    .filter((block): block is TableBlock => block.kind === 'table');
}

/* -------------------------------------------------------------------------- */

describe('line estimation', () => {
  it('never reports fewer than one line', () => {
    expect(estimateLineCount('', 80)).toBe(1);
    expect(estimateLineCount('short', 80)).toBe(1);
  });

  it('rounds up, so a block is more likely to move than to overflow', () => {
    expect(estimateLineCount('x'.repeat(81), 80)).toBe(2);
  });

  it('honours explicit newlines', () => {
    expect(estimateLineCount('a\nb\nc', 80)).toBe(3);
  });

  it('degrades safely on a nonsensical width', () => {
    expect(estimateLineCount('anything', 0)).toBe(1);
  });
});

describe('single-page documents', () => {
  it('keeps a short quotation on one page', () => {
    const pages = paginate(model([metaBlock(), table(3), signature()]));
    expect(pages).toHaveLength(1);
  });

  it('always returns at least one page, even with no content', () => {
    expect(paginate(model([]))).toHaveLength(1);
  });
});

describe('table splitting (PRD §27)', () => {
  it('paginates a long table', () => {
    const pages = paginate(model([metaBlock(), table(60)]));
    expect(pages.length).toBeGreaterThan(1);
  });

  it('repeats the header on every continuation', () => {
    const pages = paginate(model([metaBlock(), table(60)]));

    for (const page of pages) {
      for (const block of tablesOn(page)) {
        // Every fragment carries its columns, so a continuation page is never a
        // set of unlabelled rows.
        expect(block.columns.length).toBeGreaterThan(0);
      }
    }
  });

  it('marks continuations, and only continuations', () => {
    const pages = paginate(model([metaBlock(), table(60)]));

    const fragments = pages.flatMap((page) =>
      page.blocks.filter((placed) => placed.block.kind === 'table'),
    );

    expect(fragments.length).toBeGreaterThan(1);
    expect(fragments[0]?.isContinuation).toBe(false);
    expect(fragments[1]?.isContinuation).toBe(true);
  });

  it('loses no rows when it splits', () => {
    const pages = paginate(model([metaBlock(), table(60)]));

    const rows = pages
      .flatMap((page) => tablesOn(page))
      .reduce((total, block) => total + block.rows.length, 0);

    expect(rows).toBe(60);
  });

  it('never leaves a header as the last thing on a page', () => {
    const pages = paginate(model([metaBlock(), table(60)]));

    for (const page of pages) {
      for (const block of tablesOn(page)) {
        expect(block.rows.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('the signature block (§12.3)', () => {
  it('is atomic — it moves whole rather than splitting', () => {
    // A table sized so the signature cannot fit beneath it.
    const pages = paginate(model([metaBlock(), table(14), signature()]));

    const signaturePages = pages.filter((page) =>
      page.blocks.some((placed) => placed.block.kind === 'signature'),
    );

    expect(signaturePages).toHaveLength(1);
    expect(signaturePages[0]?.pageNumber).toBe(pages.length);
  });

  it('appears exactly once however the document paginates', () => {
    for (const rowCount of [1, 10, 20, 45, 90]) {
      const pages = paginate(model([metaBlock(), table(rowCount), signature()]));

      const count = pages
        .flatMap((page) => page.blocks)
        .filter((placed) => placed.block.kind === 'signature').length;

      expect(count, `rows=${String(rowCount)}`).toBe(1);
    }
  });

  it('is never taller than a page, or it could never be placed', () => {
    expect(measureBlock(signature())).toBeLessThanOrEqual(BODY_BOX.heightPt);
  });
});

describe('term splitting', () => {
  it('splits between items, never within one', () => {
    const pages = paginate(model([metaBlock(), termsList(60)]));
    expect(pages.length).toBeGreaterThan(1);

    const items = pages
      .flatMap((page) => page.blocks)
      .filter((placed) => placed.block.kind === 'termsList')
      .reduce(
        (total, placed) => total + (placed.block.kind === 'termsList' ? placed.block.items.length : 0),
        0,
      );

    expect(items).toBe(60);
  });

  it('continues the numbering across a split rather than restarting', () => {
    const pages = paginate(model([metaBlock(), termsList(60)]));

    const fragments = pages
      .flatMap((page) => page.blocks)
      .filter((placed) => placed.block.kind === 'termsList');

    expect(fragments[0]?.startNumber).toBe(1);

    const firstCount =
      fragments[0]?.block.kind === 'termsList' ? fragments[0].block.items.length : 0;
    expect(fragments[1]?.startNumber).toBe(firstCount + 1);
  });

  it('refuses a single term too long to fit on any page', () => {
    // Not a clipped document — a message naming the term.
    expect(() => paginate(model([metaBlock(), termsList(1, 60_000)]))).toThrowError(
      /too long to fit/i,
    );
  });
});

describe('failure is specific', () => {
  it('names the block kind that cannot be laid out', () => {
    const enormous: DocumentBlock = {
      kind: 'totals',
      lines: Array.from({ length: 500 }, (_value, index) => ({
        label: `TEST_ONLY line ${String(index)}`,
        value: '0.00',
      })),
    };

    try {
      paginate(model([metaBlock(), enormous]));
      expect.unreachable('should have thrown');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(PaginationError);
      expect((error as PaginationError).blockKind).toBe('totals');
    }
  });
});

describe('the seal never overlaps text (PRD §25)', () => {
  it('holds for the measured geometry', () => {
    const rects = signatureRects(6);

    // Asserted numerically, not by eye. A future edit to either constant that
    // pushed them together would fail here rather than in a printed document.
    expect(rectsIntersect(rects.seal, rects.details)).toBe(false);
  });

  it('holds even for an unusually tall details column', () => {
    const rects = signatureRects(20);
    expect(rectsIntersect(rects.seal, rects.details)).toBe(false);
  });

  it('bounds the details column at the seal, whatever the text says', () => {
    // The guarantee is structural: the details box simply cannot extend past
    // the seal's left edge, so no job title can run underneath it.
    expect(signatureRects(6).details.x1).toBeLessThanOrEqual(SIGNATURE_BLOCK.sealRect.x0);
  });

  it('keeps the seal and the signature image apart', () => {
    const rects = signatureRects(6);
    expect(rectsIntersect(rects.seal, rects.signature)).toBe(false);
  });

  it('detects an intersection when there genuinely is one', () => {
    // Guards the guard: a test that can only ever pass proves nothing.
    expect(
      rectsIntersect({ x0: 0, y0: 0, x1: 10, y1: 10 }, { x0: 5, y0: 5, x1: 15, y1: 15 }),
    ).toBe(true);
  });
});

describe('measurement', () => {
  it('grows a term with its body length', () => {
    const short = termItemHeight({ title: 'T', body: 'short' });
    const long = termItemHeight({ title: 'T', body: 'x'.repeat(2000) });

    expect(long).toBeGreaterThan(short);
  });

  it('measures a table as header plus rows', () => {
    expect(measureBlock(table(10))).toBeGreaterThan(measureBlock(table(5)));
  });
});
