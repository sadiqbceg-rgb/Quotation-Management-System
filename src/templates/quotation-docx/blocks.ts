/**
 * Rendering one `DocumentBlock` to Word.
 *
 * The mirror of `quotation-pdf/blocks.ts`, and the switch is EXHAUSTIVE with a
 * `never` default for the same reason: a block kind added to the model and not
 * handled here must be a compile error, not a section silently missing from a
 * client's quotation.
 *
 * Nothing here decides structure. Section order, conditional columns and term
 * wording were settled in Phase 07; this module only renders.
 *
 * One block can produce several Word elements — a `closing` is several
 * paragraphs — so every arm returns an array.
 */

import { AlignmentType, Paragraph, TabStopType, TextRun, type Table } from 'docx';

import { BLOCK_METRICS, BODY_BOX, COLORS, PAGE, TABLE, TYPOGRAPHY } from '@/config/document-layout';
import {
  assertNeverBlock,
  type DocumentBlock,
} from '@/services/document/document-model.types';
import { buildSignature, type SignatureImages } from '@/services/docx/docx-signature';
import { buildTable } from '@/services/docx/docx-table';
import { buildTerms } from '@/services/docx/docx-terms';
import { bodyParagraph, hex, FONTS } from '@/services/docx/docx-styles';
import { toHalfPoints, toTwips } from '@/services/docx/docx-units';

export type DocxBlockElement = Paragraph | Table;

export type BlockRenderContext = SignatureImages;

function run(text: string, bold: boolean, color: string = COLORS.text): TextRun {
  return new TextRun({
    text,
    font: FONTS.body,
    bold,
    size: toHalfPoints(TYPOGRAPHY.bodySizePt),
    color: hex(color),
  });
}

/**
 * The meta block: a bold label then its value, on one line each.
 *
 * A left tab stop puts every value in the same column, which is what the
 * approved document does and what the PDF reproduces by measuring the widest
 * label. A table would align just as well but would carry cell padding the
 * reference does not have.
 */
function metaParagraphs(rows: ReadonlyArray<{ label: string; value: string }>): Paragraph[] {
  const widest = rows.reduce((most, row) => Math.max(most, row.label.length), 0);
  // The measured average advance at 14 pt — the same ruler the paginator uses.
  // One extra character of slack, because the labels are bold.
  const stopPt = (widest + 1) * BLOCK_METRICS.averageCharWidthPt;

  return rows.map(
    (row) =>
      new Paragraph({
        ...bodyParagraph({ spacing: { after: 0, line: toTwips(TYPOGRAPHY.bodyLeadingPt), lineRule: 'exact' } }),
        tabStops: [{ type: TabStopType.LEFT, position: toTwips(stopPt) }],
        children: [run(row.label, true), new TextRun({ text: '\t' }), run(row.value, false)],
      }),
  );
}

/**
 * The totals block: right-aligned under the table's right edge.
 *
 * Aligned to the TABLE rather than the text margin, so the figures sit under
 * the Amount column they total — the same rule `drawTotals` follows.
 */
function totalsParagraphs(
  lines: ReadonlyArray<{ label: string; value: string; emphasis?: boolean }>,
): Paragraph[] {
  // The table is centred on the PAGE (§2.4), so its right edge is not the text
  // margin. A tab stop is measured from the left margin, hence the subtraction.
  const tableRightPt = (PAGE.widthPt + TABLE.defaultWidthPt) / 2 - BODY_BOX.leftPt;

  return lines.map((line) => {
    const bold = line.emphasis === true;

    return new Paragraph({
      spacing: { after: 0, line: toTwips(TYPOGRAPHY.bodyLeadingPt), lineRule: 'exact' },
      tabStops: [{ type: TabStopType.RIGHT, position: toTwips(tableRightPt) }],
      children: [run(line.label, bold), new TextRun({ text: '\t' }), run(line.value, bold)],
    });
  });
}

/**
 * Render one block.
 *
 * The `table` arm is handed the WHOLE table — Word repeats the header itself
 * through `w:tblHeader`, so unlike the PDF this renderer never sees the
 * paginator's per-page fragments.
 */
export function renderBlock(
  block: DocumentBlock,
  context: BlockRenderContext,
): DocxBlockElement[] {
  switch (block.kind) {
    case 'meta':
      return metaParagraphs(block.rows);

    case 'heading':
      return [
        new Paragraph({
          ...bodyParagraph(),
          // A heading left alone at the foot of a page is a defect Word can
          // prevent and a PDF renderer cannot.
          keepNext: true,
          children: [run(`${String(block.number)}. ${block.text}`, TYPOGRAPHY.headingBold)],
        }),
      ];

    case 'paragraph':
      return [
        new Paragraph({
          ...bodyParagraph(),
          alignment: AlignmentType.LEFT,
          children: [run(block.text, block.bold ?? false)],
        }),
      ];

    case 'table':
      return [
        buildTable(block),
        // Word tables have no space after; a following paragraph would sit on
        // the bottom border without this.
        new Paragraph({
          spacing: { after: 0, line: toTwips(TYPOGRAPHY.paragraphSpaceAfterPt), lineRule: 'exact' },
          children: [],
        }),
      ];

    case 'summaryLine':
      return [
        new Paragraph({
          ...bodyParagraph(),
          children: [run(`${block.label} ${block.value}`, true)],
        }),
      ];

    case 'totals':
      return totalsParagraphs(block.lines);

    case 'termsList':
      return buildTerms(block.items);

    case 'closing':
      return block.paragraphs.map(
        (text) =>
          new Paragraph({
            ...bodyParagraph(),
            children: [run(text, false)],
          }),
      );

    case 'signature':
      return [buildSignature(block.left, context)];

    default:
      return assertNeverBlock(block);
  }
}
