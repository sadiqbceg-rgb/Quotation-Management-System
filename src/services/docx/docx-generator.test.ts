/**
 * DOCX generation, asserted against the finished package.
 *
 * Every test here builds a REAL `.docx` from the real letterhead images, unzips
 * it, and asserts against the OOXML inside. Asserting on the builder's inputs
 * would prove only that this file agrees with itself.
 *
 * The last block asserts PDF/DOCX parity by generating both from one model and
 * comparing what a client would read.
 */

import { describe, expect, it } from 'vitest';

import {
  BODY_BOX,
  LETTERHEAD,
  PAGE,
  PAGE_MARGINS_TWIPS,
  SIGNATURE_BLOCK,
  TABLE,
} from '@/config/document-layout';
import {
  LETTERHEAD_COMPANY_NAME,
  LETTERHEAD_COMPANY_NAME_ARABIC,
  LETTERHEAD_CR_LINE,
  LETTERHEAD_FOOTER_COLUMNS,
} from '@/config/letterhead-content';
import { TEST_ONLY_model, TEST_ONLY_line, TEST_ONLY_longModel } from '@/services/pdf/__fixtures__/pdf-test-model';
import { TEST_ONLY_pdfAssets } from '@/services/pdf/__fixtures__/pdf-test-assets';
import { TEST_ONLY_parsePdf } from '@/services/pdf/__fixtures__/pdf-inspect';
import { generateQuotationPdf } from '@/services/pdf/pdf-generator';
import { TEST_ONLY_docxAssets } from './__fixtures__/docx-test-assets';
import {
  TEST_ONLY_drawings,
  TEST_ONLY_footerParts,
  TEST_ONLY_headerParts,
  TEST_ONLY_numberingReferences,
  TEST_ONLY_openDocx,
  TEST_ONLY_paragraphs,
  TEST_ONLY_parseXml,
  TEST_ONLY_part,
  TEST_ONLY_relationships,
  TEST_ONLY_section,
  TEST_ONLY_tables,
  TEST_ONLY_textOf,
  type DocxPackage,
} from './__fixtures__/docx-inspect';
import { generateQuotationDocx } from './docx-generator';
import { DocxGenerationError } from './docx-errors';
import { SIGNATURE_LABEL } from './docx-signature';
import { TERMS_NUMBERING_REFERENCE } from './docx-terms';
import { toEmu, toPixels } from './docx-units';

const DOCUMENT_PART = 'word/document.xml';

async function build(model = TEST_ONLY_model()): Promise<{
  bytes: Uint8Array;
  filename: string;
  pkg: DocxPackage;
  document: string;
}> {
  const result = await generateQuotationDocx(model, TEST_ONLY_docxAssets());
  const pkg = await TEST_ONLY_openDocx(result.bytes);

  return {
    bytes: result.bytes,
    filename: result.filename,
    pkg,
    document: TEST_ONLY_part(pkg, DOCUMENT_PART),
  };
}

/* -------------------------------------------------------------------------- */

describe('the package', () => {
  it('is a ZIP that Word will open', async () => {
    const { bytes } = await build();

    expect(Array.from(bytes.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it('contains a document, a header and a footer part', async () => {
    const { pkg } = await build();

    expect(pkg.entries).toContain(DOCUMENT_PART);
    expect(TEST_ONLY_headerParts(pkg)).toHaveLength(1);
    expect(TEST_ONLY_footerParts(pkg)).toHaveLength(1);
  });

  it('is well-formed XML throughout', async () => {
    const { pkg } = await build();

    for (const [path, xml] of pkg.parts) {
      // Throws with the parser's own message if a part is malformed.
      expect(() => TEST_ONLY_parseXml(xml), path).not.toThrow();
    }
  });

  it('is a plausible size', async () => {
    const { bytes } = await build();

    expect(bytes.byteLength).toBeGreaterThan(10_000);
    expect(bytes.byteLength).toBeLessThan(10_000_000);
  });

  it('names the download from the canonical quotation number', async () => {
    const { filename } = await build();

    expect(filename).toBe('SFC-RUH-QTN-2026-004.docx');
    expect(filename).toMatch(/^SFC-RUH-QTN-\d{4}-\d{3,}\.docx$/);
  });
});

/* -------------------------------------------------------------------------- */

describe('the section', () => {
  it('is A4 with the measured margins', async () => {
    const { document } = await build();
    const section = TEST_ONLY_section(document);

    expect(section.widthTwips).toBe(PAGE.widthTwips);
    expect(section.heightTwips).toBe(PAGE.heightTwips);
    expect(section.margins).toEqual({
      top: PAGE_MARGINS_TWIPS.top,
      bottom: PAGE_MARGINS_TWIPS.bottom,
      left: PAGE_MARGINS_TWIPS.left,
      right: PAGE_MARGINS_TWIPS.right,
    });
  });

  it('declares the header and footer once, on the section', async () => {
    const { document } = await build();
    const section = TEST_ONLY_section(document);

    // One reference each: this is what makes Word repeat them on every page,
    // rather than anything being emitted per page.
    expect(section.headerReferenceIds).toHaveLength(1);
    expect(section.footerReferenceIds).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */

describe('the header', () => {
  it('carries the company name in both scripts and the C.R. line', async () => {
    const { pkg } = await build();
    const [header = ''] = TEST_ONLY_headerParts(pkg);
    const text = TEST_ONLY_textOf(header);

    expect(text).toContain(LETTERHEAD_COMPANY_NAME);
    expect(text).toContain(LETTERHEAD_COMPANY_NAME_ARABIC);
    expect(text).toContain(LETTERHEAD_CR_LINE);
  });

  it('marks the Arabic as right-to-left so Word shapes it', async () => {
    const { pkg } = await build();
    const [header = ''] = TEST_ONLY_headerParts(pkg);

    expect(header).toContain('<w:rtl');
  });

  it('emits right-to-left NOWHERE else — no user content is ever RTL', async () => {
    const { pkg, document } = await build();

    expect(document).not.toContain('<w:rtl');
    for (const footer of TEST_ONLY_footerParts(pkg)) {
      expect(footer).not.toContain('<w:rtl');
    }
  });

  it('draws the red rule at the measured width', async () => {
    const { pkg } = await build();
    const [header = ''] = TEST_ONLY_headerParts(pkg);
    const eighths = Math.round((LETTERHEAD.headerRule.y1 - LETTERHEAD.headerRule.y0) * 8);

    expect(header).toContain(`w:color="D4292E"`);
    expect(header).toContain(`w:sz="${String(eighths)}"`);
  });

  it('embeds the logo as a relationship, never as a link', async () => {
    const { pkg } = await build();
    const [headerPath = ''] = pkg.entries.filter((path) => /^word\/header\d*\.xml$/.test(path));
    const relationships = TEST_ONLY_relationships(pkg, headerPath);
    const targets = [...relationships.values()];

    expect(targets.some((target) => target.endsWith('.jpg'))).toBe(true);
    // Nothing may be fetched when the document opens.
    expect(TEST_ONLY_part(pkg, `word/_rels/${headerPath.split('/')[1] ?? ''}.rels`)).not.toContain(
      'TargetMode="External"',
    );
  });
});

describe('the footer', () => {
  it('carries all three contact columns', async () => {
    const { pkg } = await build();
    const [footer = ''] = TEST_ONLY_footerParts(pkg);
    const text = TEST_ONLY_textOf(footer);

    for (const column of LETTERHEAD_FOOTER_COLUMNS) {
      if (column.label.length > 0) expect(text).toContain(column.label);
      for (const line of column.lines) expect(text).toContain(line);
    }
  });

  it('draws the amber rule', async () => {
    const { pkg } = await build();
    const [footer = ''] = TEST_ONLY_footerParts(pkg);

    expect(footer).toContain('w:color="FFBD59"');
  });
});

describe('the watermark', () => {
  it('floats behind the text, on every page', async () => {
    const { pkg } = await build();
    const [header = ''] = TEST_ONLY_headerParts(pkg);
    const [watermark] = TEST_ONLY_drawings(header);

    expect(watermark).toBeDefined();
    expect(watermark?.isFloating).toBe(true);
    // In FRONT of the text it would obscure a client's prices.
    expect(watermark?.behindDocument).toBe(true);
  });

  it('is the measured size and is page-anchored', async () => {
    const { pkg } = await build();
    const [header = ''] = TEST_ONLY_headerParts(pkg);
    const [watermark] = TEST_ONLY_drawings(header);

    expect(watermark?.widthEmu).toBe(
      toEmu(toPixels(LETTERHEAD.watermarkRect.x1 - LETTERHEAD.watermarkRect.x0) * (72 / 96)),
    );
    expect(header).toContain('relativeFrom="page"');
    expect(header).toContain(`<wp:posOffset>${String(toEmu(LETTERHEAD.watermarkRect.x0))}`);
  });
});

/* -------------------------------------------------------------------------- */

describe('the body', () => {
  it('prints the canonical quotation number', async () => {
    const { document } = await build();

    expect(TEST_ONLY_textOf(document)).toContain('SFC/RUH/QTN/2026/004');
  });

  it('prints the client details and the scope', async () => {
    const { document } = await build();
    const text = TEST_ONLY_textOf(document);

    expect(text).toContain('TEST_ONLY Client Company');
    expect(text).toContain('TEST_ONLY Attention Name');
    expect(text).toContain('Scope of Work');
  });

  it('prints the closing paragraphs and the signature details', async () => {
    const { document } = await build();
    const text = TEST_ONLY_textOf(document);

    expect(text).toContain('TEST_ONLY closing thank you.');
    expect(text).toContain('TEST_ONLY please issue the purchase order.');
    expect(text).toContain('TEST_ONLY_Signatory');
    expect(text).toContain('test-only@example.invalid');
  });
});

describe('the items table', () => {
  it('repeats its header row across page breaks', async () => {
    const { document } = await build();
    const [table] = TEST_ONLY_tables(document);

    expect(document).toContain('<w:tblHeader');
    expect(table?.headerRowIndexes).toEqual([0]);
  });

  it('never splits a row across a page', async () => {
    const { document } = await build(TEST_ONLY_longModel(40));
    const [table] = TEST_ONLY_tables(document);

    // Every row, header included — a row broken mid-cell is a divergence the
    // PDF cannot produce.
    expect(table?.cantSplitRowIndexes).toHaveLength(table?.rows.length ?? 0);
  });

  it('gives the columns the measured total width', async () => {
    const { document } = await build();
    const [table] = TEST_ONLY_tables(document);
    const total = (table?.columnWidths ?? []).reduce((sum, width) => sum + width, 0);

    expect(total).toBe(Math.round(TABLE.defaultWidthPt * 20));
  });

  it('is handed to Word whole, not as one table per page', async () => {
    const { document } = await build(TEST_ONLY_longModel(40));
    const tables = TEST_ONLY_tables(document);

    // One items table plus the signature layout table. Splitting it ourselves
    // would leave several tables that stop lining up once the file is edited.
    expect(tables).toHaveLength(2);
    expect(tables[0]?.rows).toHaveLength(41);
  });

  it('prints Remarks only when the model asks for it', async () => {
    const without = await build();
    expect(TEST_ONLY_textOf(without.document)).not.toContain('Remarks');

    const withRemarks = await build(
      TEST_ONLY_model({ lines: [TEST_ONLY_line({ remarks: 'TEST_ONLY remark' })] }),
    );
    const text = TEST_ONLY_textOf(withRemarks.document);

    expect(text).toContain('Remarks');
    expect(text).toContain('TEST_ONLY remark');
  });

  it('drops the Amount column in rate-only mode', async () => {
    const { document } = await build(TEST_ONLY_model({ pricingMode: 'rate-only' }));
    const [table] = TEST_ONLY_tables(document);

    expect(table?.rows[0]).not.toContain('Amount');
    expect(table?.rows[0]).toContain('Unit Price');
  });
});

describe('the terms list', () => {
  it('uses a real numbering definition, not literal text', async () => {
    const { pkg, document } = await build();
    const references = TEST_ONLY_numberingReferences(document);

    expect(references.length).toBeGreaterThan(0);
    expect(pkg.entries).toContain('word/numbering.xml');
    // The number is Word's, so it renumbers when the company edits the file.
    expect(TEST_ONLY_paragraphs(document)).not.toContain('1. TEST_ONLY Working Hours');
  });

  it('numbers every term from the same definition', async () => {
    const { document } = await build();
    const references = TEST_ONLY_numberingReferences(document);

    expect(references).toHaveLength(2);
    expect(new Set(references.map((reference) => reference.id)).size).toBe(1);
    expect(references.every((reference) => reference.level === 0)).toBe(true);
  });

  it('carries the reference the terms module declares', async () => {
    const { pkg } = await build();

    expect(TEST_ONLY_part(pkg, 'word/numbering.xml')).toContain('%1.');
    expect(TERMS_NUMBERING_REFERENCE).toBe('quotation-terms');
  });

  it('reproduces the reference hanging indent', async () => {
    const { pkg } = await build();
    const numbering = TEST_ONLY_part(pkg, 'word/numbering.xml');

    // Number at x 52, text at x 70 — stated as an indent to the text with a
    // hanging offset back to the number.
    expect(numbering).toContain('w:left="720"');
    expect(numbering).toContain('w:hanging="360"');
  });
});

describe('the signature block', () => {
  it('is an unsplittable two-cell table', async () => {
    const { document } = await build();
    const tables = TEST_ONLY_tables(document);
    const signature = tables[tables.length - 1];

    expect(signature?.rows).toHaveLength(1);
    expect(signature?.rows[0]).toHaveLength(2);
    expect(signature?.cantSplitRowIndexes).toEqual([0]);
  });

  it('embeds the seal and the signature at their measured sizes', async () => {
    const { document } = await build();
    const drawings = TEST_ONLY_drawings(document);

    const sealWidth = toEmu(SIGNATURE_BLOCK.sealRect.x1 - SIGNATURE_BLOCK.sealRect.x0);
    const signatureWidth = toEmu(
      SIGNATURE_BLOCK.signatureRect.x1 - SIGNATURE_BLOCK.signatureRect.x0,
    );

    expect(drawings).toHaveLength(2);
    // Within a pixel: the size is stated in pixels and converted back to EMU.
    expect(Math.abs((drawings[0]?.widthEmu ?? 0) - sealWidth)).toBeLessThan(10_000);
    expect(Math.abs((drawings[1]?.widthEmu ?? 0) - signatureWidth)).toBeLessThan(10_000);
  });

  it('floats the signature over the line, in front of it', async () => {
    const { document } = await build();
    const [, signature] = TEST_ONLY_drawings(document);

    expect(signature?.isFloating).toBe(true);
    // Behind the text it would read as a strike-through of the underscores.
    expect(signature?.behindDocument).toBe(false);
    expect(TEST_ONLY_textOf(document)).toContain(SIGNATURE_LABEL);
  });

  it('embeds both images as relationships, never as links', async () => {
    const { pkg } = await build();
    const relationships = TEST_ONLY_relationships(pkg, DOCUMENT_PART);
    const images = [...relationships.values()].filter((target) => target.startsWith('media/'));

    expect(images.length).toBeGreaterThanOrEqual(2);
    expect(TEST_ONLY_part(pkg, 'word/_rels/document.xml.rels')).not.toContain(
      'TargetMode="External"',
    );
  });
});

/* -------------------------------------------------------------------------- */

describe('security', () => {
  it('carries no macros, no OLE objects and no remote fields', async () => {
    const { pkg } = await build();

    expect(pkg.entries.some((path) => path.endsWith('.bin'))).toBe(false);
    expect(pkg.entries.some((path) => /vbaProject/i.test(path))).toBe(false);

    for (const [, xml] of pkg.parts) {
      expect(xml).not.toContain('TargetMode="External"');
      expect(xml).not.toContain('w:fldChar');
      expect(xml).not.toContain('INCLUDEPICTURE');
    }
  });

  it('puts only the document title and number in the properties', async () => {
    const { pkg } = await build();
    const core = TEST_ONLY_part(pkg, 'docProps/core.xml');

    expect(core).toContain('SFC/RUH/QTN/2026/004');
    expect(core).not.toContain('@');
    expect(core).not.toMatch(/token|session|draft-/i);
  });

  it('embeds no font', async () => {
    const { pkg } = await build();

    expect(pkg.entries.some((path) => /^word\/fonts\//.test(path))).toBe(false);
    expect(TEST_ONLY_part(pkg, DOCUMENT_PART)).toContain('Calibri');
  });
});

describe('refusals', () => {
  it('will not produce a Word file for a draft with no number', async () => {
    await expect(
      generateQuotationDocx(TEST_ONLY_model({ quotationNumber: '' }), TEST_ONLY_docxAssets()),
    ).rejects.toMatchObject({ code: 'QUOTATION_NUMBER_REQUIRED' });
  });

  it('will not fabricate a missing signature', async () => {
    await expect(
      generateQuotationDocx(TEST_ONLY_model(), TEST_ONLY_docxAssets({ signature: null })),
    ).rejects.toMatchObject({ code: 'SIGNATURE_MISSING' });
  });

  it('fails loudly when the watermark is missing rather than shipping the document without it', async () => {
    const failure = await generateQuotationDocx(
      TEST_ONLY_model(),
      TEST_ONLY_docxAssets({ watermark: new Uint8Array() }),
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DocxGenerationError);
    expect((failure as DocxGenerationError).code).toBe('ASSET_MISSING');
  });

  it('refuses a quotation over the line-item cap, saying by how much', async () => {
    const failure = await generateQuotationDocx(
      TEST_ONLY_longModel(501),
      TEST_ONLY_docxAssets(),
    ).catch((error: unknown) => error);

    expect((failure as DocxGenerationError).code).toBe('TOO_LARGE');
    expect((failure as DocxGenerationError).message).toContain('501');
  });
});

/* -------------------------------------------------------------------------- */

describe('parity with the PDF', () => {
  it('carries the same content as the PDF built from the same model', async () => {
    const model = TEST_ONLY_model({
      lines: [TEST_ONLY_line(), TEST_ONLY_line({ category: 'Equipment', description: 'TEST_ONLY Crane' })],
    });

    const [docx, pdf] = await Promise.all([
      build(model),
      generateQuotationPdf(model, TEST_ONLY_pdfAssets()),
    ]);

    const pages = await TEST_ONLY_parsePdf(pdf.bytes);
    const pdfText = pages.map((page) => page.text).join(' ');
    const docxText = TEST_ONLY_textOf(docx.document);

    // The quotation number, the client, and the closing text.
    expect(pdfText).toContain('SFC/RUH/QTN/2026/004');
    expect(docxText).toContain('SFC/RUH/QTN/2026/004');
    expect(docxText).toContain('TEST_ONLY Client Company');
    expect(pdfText.replace(/\s+/g, ' ')).toContain('TEST_ONLY Client Company');
    expect(docxText).toContain('TEST_ONLY closing thank you.');
    expect(pdfText.replace(/\s+/g, ' ')).toContain('TEST_ONLY closing thank you.');

    // The same file stem, so a PDF and a DOCX of one quotation file together.
    expect(docx.filename.replace(/\.docx$/, '')).toBe(pdf.filename.replace(/\.pdf$/, ''));
  });

  it('has the same tables, with the same rows per category', async () => {
    const model = TEST_ONLY_model({
      lines: [
        TEST_ONLY_line(),
        TEST_ONLY_line({ description: 'TEST_ONLY Second' }),
        TEST_ONLY_line({ category: 'Equipment', description: 'TEST_ONLY Crane' }),
      ],
    });

    const { document } = await build(model);
    const tables = TEST_ONLY_tables(document);

    const modelTables = model.blocks.filter((block) => block.kind === 'table');
    expect(tables).toHaveLength(modelTables.length + 1); // + the signature layout

    modelTables.forEach((block, index) => {
      // Header row plus one row per line, exactly as the model has them.
      expect(tables[index]?.rows).toHaveLength(block.rows.length + 1);
    });
  });

  it('lists the same terms in the same order', async () => {
    const model = TEST_ONLY_model();
    const { document } = await build(model);

    const modelTerms = model.blocks.flatMap((block) =>
      block.kind === 'termsList' ? block.items : [],
    );
    const text = TEST_ONLY_textOf(document);

    let cursor = -1;
    for (const term of modelTerms) {
      const at = text.indexOf(term.title, cursor + 1);
      expect(at, term.title).toBeGreaterThan(cursor);
      cursor = at;
    }
  });

  it('keeps the same text inside the body box', async () => {
    const { document } = await build();
    const section = TEST_ONLY_section(document);

    // Word's text column is what the PDF calls BODY_BOX.
    const columnWidth =
      (section.widthTwips - section.margins.left - section.margins.right) / 20;
    expect(columnWidth).toBeCloseTo(BODY_BOX.widthPt, 1);
  });
});
