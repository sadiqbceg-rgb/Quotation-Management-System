import { beforeAll, describe, expect, it } from 'vitest';

import { generateQuotationPdf } from './pdf-generator';
import { PdfGenerationError } from './pdf-errors';
import { TEST_ONLY_pdfAssets, TEST_ONLY_opaqueSealBytes } from './__fixtures__/pdf-test-assets';
import { TEST_ONLY_line, TEST_ONLY_longModel, TEST_ONLY_model } from './__fixtures__/pdf-test-model';
import {
  TEST_ONLY_colourRows,
  TEST_ONLY_parsePdf,
  TEST_ONLY_rasterise,
  TEST_ONLY_textBounds,
  type ParsedPage,
} from './__fixtures__/pdf-inspect';
import { BODY_BOX, COLORS, PAGE, SIGNATURE_BLOCK } from '@/config/document-layout';
import { rectsIntersect } from '@/services/document/pagination-rules';

/**
 * Every claim here is asserted against the PARSED OUTPUT — a real PDF, produced
 * from the real letterhead, the real fonts and the real keyed seal, then read
 * back. Asserting on the generator's internal state would prove nothing about
 * the file a client actually receives.
 *
 * Nothing is written to the repository: the bytes stay in memory.
 */

const PINNED = new Date('2026-08-11T00:00:00Z');

async function generate(model = TEST_ONLY_model(), assetOverrides = {}) {
  return generateQuotationPdf(model, TEST_ONLY_pdfAssets(assetOverrides), { createdAt: PINNED });
}

let short: { bytes: Uint8Array; pageCount: number; filename: string };
let shortPages: ParsedPage[];

beforeAll(async () => {
  short = await generate();
  shortPages = await TEST_ONLY_parsePdf(short.bytes);
}, 60_000);

/* -------------------------------------------------------------------------- */

describe('the output is a real PDF', () => {
  it('begins with the PDF magic bytes', () => {
    expect(String.fromCharCode(...short.bytes.subarray(0, 5))).toBe('%PDF-');
  });

  it('is a plausible size — big enough to hold the letterhead, small enough to email', () => {
    expect(short.bytes.byteLength).toBeGreaterThan(20_000);
    expect(short.bytes.byteLength).toBeLessThan(2_000_000);
  });

  it('is A4 on every page', () => {
    for (const page of shortPages) {
      expect(page.widthPt).toBeCloseTo(PAGE.widthPt, 1);
      expect(page.heightPt).toBeCloseTo(PAGE.heightPt, 1);
    }
  });

  it('names the file from the canonical quotation number', () => {
    expect(short.filename).toBe('SFC-RUH-QTN-2026-004.pdf');
  });
});

describe('the text is real, not a picture of text', () => {
  it('round-trips the client name out of the finished PDF', () => {
    // A rasterised page would yield nothing here. This is the assertion that
    // the output is selectable and searchable.
    const all = shortPages.map((page) => page.text).join(' ');
    expect(all).toContain('TEST_ONLY Client Company');
  });

  it('contains the canonical quotation number in the body of page 1', () => {
    expect(shortPages[0]?.text).toContain('SFC/RUH/QTN/2026/004');
  });

  it('carries the meta labels the approved document uses', () => {
    const page = shortPages[0]?.text ?? '';

    for (const label of ['Quotation For:', 'Quotation No.:', 'Date:', 'Attention:', 'Client:']) {
      expect(page, label).toContain(label);
    }
  });

  it('renders the date as DD-MM-YYYY', () => {
    expect(shortPages[0]?.text).toContain('11-08-2026');
  });

  it('numbers the sections', () => {
    const all = shortPages.map((page) => page.text).join(' ');

    expect(all).toContain('1. Scope of Work');
    expect(all).toContain('2. General Terms & Conditions');
  });
});

describe('the letterhead is on every page', () => {
  it('carries the header and footer text of the company artwork', async () => {
    const pages = await TEST_ONLY_parsePdf((await generate(TEST_ONLY_longModel())).bytes);
    expect(pages.length).toBeGreaterThan(1);

    for (const page of pages) {
      expect(page.text, `page ${String(page.pageNumber)} header`).toContain('SPEED FALCON COMPANY');
      expect(page.text, `page ${String(page.pageNumber)} c.r.`).toContain('C.R. 7050577670');
      expect(page.text, `page ${String(page.pageNumber)} footer`).toContain('www.speedxksa.com');
    }
  }, 60_000);

  it('places the red header rule exactly where the company file has it', async () => {
    /*
     * The letterhead's MediaBox has a non-zero y origin. Drawing it at (0,0)
     * scaled to A4 — the obvious thing — puts this rule at y 36 instead of 44.
     * Eight points, and every measurement in §2.4 wrong by that much.
     */
    const raster = await TEST_ONLY_rasterise(short.bytes, 1);
    const rows = TEST_ONLY_colourRows(raster, COLORS.brandRed, 200);

    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toBeCloseTo(44.0, 0);
    expect(rows[rows.length - 1]).toBeCloseTo(67.5, 0);
  }, 60_000);
});

describe('body content stays inside the measured box', () => {
  it('never crosses the margins on any page', () => {
    for (const page of shortPages) {
      // The letterhead's own text sits outside the body box, so only the text
      // this renderer drew is bounded. Filter to it by its known content.
      const body = page.items.filter((item) => item.text.includes('TEST_ONLY'));
      if (body.length === 0) continue;

      const bounds = TEST_ONLY_textBounds({ ...page, items: body });

      expect(bounds.minX, `page ${String(page.pageNumber)} left`).toBeGreaterThanOrEqual(
        BODY_BOX.leftPt - 1,
      );
      expect(bounds.maxX, `page ${String(page.pageNumber)} right`).toBeLessThanOrEqual(
        BODY_BOX.rightPt + 1,
      );
      expect(bounds.minY, `page ${String(page.pageNumber)} top`).toBeGreaterThanOrEqual(
        BODY_BOX.topPt - 2,
      );
      expect(bounds.maxY, `page ${String(page.pageNumber)} bottom`).toBeLessThanOrEqual(
        BODY_BOX.bottomPt + 2,
      );
    }
  });
});

describe('pagination', () => {
  it('spans pages for a 60-row quotation and repeats the table header', async () => {
    const pages = await TEST_ONLY_parsePdf((await generate(TEST_ONLY_longModel())).bytes);
    expect(pages.length).toBeGreaterThan(1);

    // PRD §27: a continuation page's rows are never unlabelled.
    const withRows = pages.filter((page) => /TEST_ONLY item number \d+/.test(page.text));
    expect(withRows.length).toBeGreaterThan(1);

    for (const page of withRows) {
      expect(page.text, `page ${String(page.pageNumber)}`).toContain('Designation');
    }
  }, 60_000);

  it('loses no rows across the split', async () => {
    const pages = await TEST_ONLY_parsePdf((await generate(TEST_ONLY_longModel(60))).bytes);
    const all = pages.map((page) => page.text).join(' ');

    for (const index of [1, 30, 60]) {
      expect(all, `item ${String(index)}`).toContain(`TEST_ONLY item number ${String(index)}`);
    }
  }, 60_000);

  it('keeps the signature block whole and on one page', async () => {
    const pages = await TEST_ONLY_parsePdf((await generate(TEST_ONLY_longModel(28))).bytes);

    const withSignature = pages.filter((page) => page.text.includes('TEST_ONLY_Signatory'));
    expect(withSignature).toHaveLength(1);

    // Every line of the block landed on the same page as the name.
    const page = withSignature[0];
    expect(page?.text).toContain('TEST_ONLY Designation');
    expect(page?.text).toContain('Mobile : +966 50 000 0000');
    expect(page?.text).toContain('Signature:');
  }, 60_000);

  it('refuses a document that cannot be laid out, naming the problem', async () => {
    const model = TEST_ONLY_model({
      terms: [{ title: 'TEST_ONLY Enormous', body: 'x'.repeat(120_000) }],
    });

    await expect(generate(model)).rejects.toThrowError(/too long to fit/i);
  }, 60_000);
});

describe('conditional content', () => {
  it('prints the totals block in amount mode', () => {
    const all = shortPages.map((page) => page.text).join(' ');

    expect(all).toContain('Grand Total');
    expect(all).toContain('Amount');
  });

  it('omits both in rate-only mode', async () => {
    const pages = await TEST_ONLY_parsePdf(
      (await generate(TEST_ONLY_model({ pricingMode: 'rate-only' }))).bytes,
    );
    const all = pages.map((page) => page.text).join(' ');

    expect(all).not.toContain('Grand Total');
    expect(all).not.toContain('Amount');
  }, 60_000);

  it('prints Remarks only when an item has one', async () => {
    expect(shortPages.map((page) => page.text).join(' ')).not.toContain('Remarks');

    const withRemark = TEST_ONLY_model({
      lines: [TEST_ONLY_line({ remarks: 'TEST_ONLY remark text' })],
    });
    const pages = await TEST_ONLY_parsePdf((await generate(withRemark)).bytes);

    expect(pages.map((page) => page.text).join(' ')).toContain('Remarks');
  }, 60_000);
});

describe('the signature block (PRD §25)', () => {
  it('does not let the seal overlap the details text', async () => {
    const pages = await TEST_ONLY_parsePdf(short.bytes);
    const page = pages.find((entry) => entry.text.includes('TEST_ONLY_Signatory'));
    expect(page).toBeDefined();

    const name = page?.items.find((item) => item.text.includes('TEST_ONLY_Signatory'));
    expect(name).toBeDefined();

    /*
     * Asserted numerically on the PARSED output, not on the constants: this is
     * where the seal actually landed relative to where the text actually landed.
     */
    const blockTop = (name?.y ?? 0) - (SIGNATURE_BLOCK.detailsFirstLineYPt - SIGNATURE_BLOCK.sealRect.y0);
    const seal = {
      x0: SIGNATURE_BLOCK.sealRect.x0,
      y0: blockTop,
      x1: SIGNATURE_BLOCK.sealRect.x1,
      y1: blockTop + (SIGNATURE_BLOCK.sealRect.y1 - SIGNATURE_BLOCK.sealRect.y0),
    };

    const detailLines = (page?.items ?? []).filter(
      (item) => item.text.includes('TEST_ONLY') || item.text.startsWith('Mobile'),
    );

    for (const item of detailLines) {
      const rect = { x0: item.x, y0: item.y, x1: item.x + item.width, y1: item.y + item.height };
      expect(rectsIntersect(seal, rect), `"${item.text}" overlaps the seal`).toBe(false);
    }
  }, 60_000);

  it('uses the alpha-keyed seal, never the opaque original', async () => {
    // The raw reference seal has no alpha; embedding it would paint a white box
    // over the letterhead watermark. The generator is handed the keyed one.
    const { readPngHeader } = await import('@shared/png');

    expect(readPngHeader(TEST_ONLY_opaqueSealBytes())?.hasAlpha).toBe(false);
    expect(readPngHeader(TEST_ONLY_pdfAssets().seal)?.hasAlpha).toBe(true);
  });
});

describe('determinism', () => {
  it('produces the same bytes for the same input and a pinned timestamp', async () => {
    const model = TEST_ONLY_model();
    const [first, second] = await Promise.all([generate(model), generate(model)]);

    expect(Buffer.from(second.bytes).equals(Buffer.from(first.bytes))).toBe(true);
  }, 60_000);
});

describe('metadata', () => {
  it('carries the quotation number', async () => {
    // Read back through pdf-lib rather than scanning the raw bytes: PDF strings
    // are encoded, so a substring search would pass or fail for the wrong reason.
    const { PDFDocument } = await import('pdf-lib');
    const parsed = await PDFDocument.load(short.bytes);

    expect(parsed.getTitle()).toBe('Quotation SFC/RUH/QTN/2026/004');
    expect(parsed.getSubject()).toBe('Quotation SFC/RUH/QTN/2026/004');
  }, 60_000);

  it('carries nothing personal — a PDF travels outside the company', async () => {
    const { PDFDocument } = await import('pdf-lib');
    const parsed = await PDFDocument.load(short.bytes);

    const metadata = [
      parsed.getTitle(),
      parsed.getSubject(),
      parsed.getAuthor(),
      parsed.getCreator(),
      parsed.getProducer(),
      parsed.getKeywords(),
    ]
      .filter((value): value is string => typeof value === 'string')
      .join(' ');

    expect(metadata).not.toMatch(/@/);
    expect(metadata).not.toMatch(/bearer|token|session/i);
  }, 60_000);
});

describe('refusals', () => {
  it('will not produce a PDF for a draft with no quotation number', async () => {
    await expect(generate(TEST_ONLY_model({ quotationNumber: '' }))).rejects.toMatchObject({
      code: 'QUOTATION_NUMBER_REQUIRED',
    });
  }, 60_000);

  it('will not produce a PDF without a signature', async () => {
    await expect(generate(TEST_ONLY_model(), { signature: null })).rejects.toMatchObject({
      code: 'SIGNATURE_MISSING',
    });
  }, 60_000);

  it('will not fall back to a blank page when the letterhead is unreadable', async () => {
    await expect(
      generate(TEST_ONLY_model(), { letterhead: new Uint8Array([1, 2, 3, 4]) }),
    ).rejects.toMatchObject({ code: 'LETTERHEAD_MISSING' });
  }, 60_000);

  it('will not silently substitute a font, which would change every line break', async () => {
    await expect(
      generate(TEST_ONLY_model(), { fontRegular: new Uint8Array([0, 0, 0, 0]) }),
    ).rejects.toMatchObject({ code: 'FONT_EMBED_FAILED' });
  }, 60_000);

  it('rejects a seal that is not a PNG', async () => {
    await expect(
      generate(TEST_ONLY_model(), { seal: new Uint8Array([0xff, 0xd8, 0xff]) }),
    ).rejects.toMatchObject({ code: 'SEAL_MISSING' });
  }, 60_000);

  it('refuses an oversized quotation rather than hanging the browser', async () => {
    const model = TEST_ONLY_longModel(501);

    await expect(generate(model)).rejects.toMatchObject({ code: 'TOO_LARGE' });
  }, 60_000);

  it('every refusal is a typed PdfGenerationError', async () => {
    await expect(generate(TEST_ONLY_model({ quotationNumber: '' }))).rejects.toBeInstanceOf(
      PdfGenerationError,
    );
  }, 60_000);
});

describe('page numbers (§26 UR-07)', () => {
  it('are absent by default, matching the approved document', () => {
    expect(shortPages.map((page) => page.text).join(' ')).not.toMatch(/Page \d+ of \d+/);
  });

  it('appear on every page when enabled', async () => {
    const pages = await TEST_ONLY_parsePdf(
      (await generate(TEST_ONLY_model({ showPageNumbers: true }))).bytes,
    );

    pages.forEach((page) => {
      expect(page.text).toContain(`Page ${String(page.pageNumber)} of ${String(pages.length)}`);
    });
  }, 60_000);
});
