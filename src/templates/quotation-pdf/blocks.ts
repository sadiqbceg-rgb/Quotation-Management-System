/**
 * Drawing one `DocumentBlock`.
 *
 * The switch is EXHAUSTIVE with a `never` default. A block kind added to the
 * model and not handled here is a compile error — a section silently missing
 * from a client's quotation is not something to discover by eye.
 *
 * Nothing here decides structure. Section order, conditional columns and
 * pagination policy were all settled in Phase 07; this module only draws.
 */

import type { PDFImage } from 'pdf-lib';

import {
  BODY_BOX,
  COLORS,
  SIGNATURE_BLOCK,
  TABLE,
  TERMS_LIST,
  TYPOGRAPHY,
} from '@/config/document-layout';
import {
  assertNeverBlock,
  type DocumentBlock,
} from '@/services/document/document-model.types';
import type { PlacedBlock } from '@/services/document/pagination-rules';
import type { PdfLayoutEngine } from '@/services/pdf/pdf-layout-engine';
import { drawTable, tableLeft } from '@/services/pdf/pdf-table';
import { drawTerms } from '@/services/pdf/pdf-list';
import {
  placeImage,
  sealRect,
  signatureBlockTop,
  signatureRect,
} from '@/services/pdf/pdf-images';

export interface BlockRenderContext {
  seal: PDFImage;
  /** Null on a draft. The signature area is then left empty, never faked. */
  signature: PDFImage | null;
}

/** Width available to body text. */
function bodyWidth(): number {
  return BODY_BOX.widthPt;
}

/**
 * The meta block: bold label, value alongside.
 *
 * The label column is as wide as the widest label, so the values line up the
 * way they do in the approved document.
 */
function drawMeta(
  engine: PdfLayoutEngine,
  rows: ReadonlyArray<{ label: string; value: string }>,
  topY: number,
): number {
  const labelWidth =
    rows.reduce((widest, row) => Math.max(widest, engine.measure(row.label, { bold: true })), 0) +
    TYPOGRAPHY.bodySizePt * 0.5;

  let y = topY;

  for (const row of rows) {
    engine.drawLine(row.label, { x: BODY_BOX.leftPt, y, bold: true });
    engine.drawParagraph(row.value, {
      x: BODY_BOX.leftPt + labelWidth,
      y,
      maxWidth: bodyWidth() - labelWidth,
    });
    y += TYPOGRAPHY.bodyLeadingPt;
  }

  return y - topY + TYPOGRAPHY.paragraphSpaceAfterPt;
}

/**
 * The totals block: right-aligned labels and values beneath the tables.
 *
 * Aligned to the table's right edge rather than the text margin, so the column
 * of figures sits under the Amount column it totals.
 */
function drawTotals(
  engine: PdfLayoutEngine,
  lines: ReadonlyArray<{ label: string; value: string; emphasis?: boolean }>,
  topY: number,
): number {
  const right = tableLeft() + TABLE.defaultWidthPt;
  const labelX = right - TABLE.defaultWidthPt / 2;

  let y = topY;

  for (const line of lines) {
    const bold = line.emphasis === true;

    engine.drawLine(line.label, { x: labelX, y, bold });
    engine.drawLine(line.value, {
      x: right - engine.measure(line.value, { bold }),
      y,
      bold,
    });

    y += TYPOGRAPHY.bodyLeadingPt;
  }

  return y - topY + TYPOGRAPHY.paragraphSpaceAfterPt;
}

/**
 * The signature block.
 *
 * Details on the left; seal above signature on the right. The company name is
 * navy and the email is the hyperlink blue, underlined — both sampled from the
 * approved document (§2.4).
 *
 * The whole block is placed relative to `topY`, so it renders identically
 * whether it landed on page 1 or was moved whole to page 3.
 */
function drawSignature(
  engine: PdfLayoutEngine,
  block: Extract<DocumentBlock, { kind: 'signature' }>,
  topY: number,
  context: BlockRenderContext,
): number {
  const measuredTop = signatureBlockTop();
  const detailsOffset = SIGNATURE_BLOCK.detailsFirstLineYPt - measuredTop;

  let y = topY + detailsOffset;

  block.left.forEach((line, index) => {
    const isCompany = index === 2;
    const isEmail = line.startsWith('Email:');

    engine.drawLine(line, {
      x: SIGNATURE_BLOCK.detailsXPt,
      y,
      bold: true,
      color: isCompany ? COLORS.navy : isEmail ? COLORS.linkBlue : COLORS.text,
      underline: isEmail,
    });

    y += SIGNATURE_BLOCK.detailsLinePitchPt;
  });

  engine.drawImage(context.seal, placeImage(context.seal, sealRect(topY)));

  if (context.signature !== null) {
    engine.drawImage(
      context.signature,
      placeImage(context.signature, signatureRect(topY)),
    );
  }

  engine.drawLine('Signature:______________', {
    x: SIGNATURE_BLOCK.signatureLabelXPt,
    y: topY + (SIGNATURE_BLOCK.signatureLabelYPt - measuredTop),
  });

  return SIGNATURE_BLOCK.reservedHeightPt;
}

/**
 * Draw a placed block at the engine's cursor.
 *
 * Returns the height consumed, which the caller adds to the cursor.
 */
export function drawBlock(
  engine: PdfLayoutEngine,
  placed: PlacedBlock,
  context: BlockRenderContext,
): number {
  const block = placed.block;
  const y = engine.y;

  switch (block.kind) {
    case 'meta':
      return drawMeta(engine, block.rows, y);

    case 'heading':
      engine.drawLine(`${String(block.number)}. ${block.text}`, {
        x: BODY_BOX.leftPt,
        y,
        bold: true,
        size: TYPOGRAPHY.headingSizePt,
      });
      return TYPOGRAPHY.bodyLeadingPt + TYPOGRAPHY.paragraphSpaceAfterPt;

    case 'paragraph':
      return (
        engine.drawParagraph(block.text, {
          x: BODY_BOX.leftPt,
          y,
          maxWidth: bodyWidth(),
          bold: block.bold ?? false,
        }) + TYPOGRAPHY.paragraphSpaceAfterPt
      );

    case 'table':
      return (
        drawTable(engine, { columns: block.columns, rows: block.rows, topY: y }) +
        TYPOGRAPHY.paragraphSpaceAfterPt
      );

    case 'summaryLine': {
      engine.drawLine(`${block.label} ${block.value}`, {
        x: BODY_BOX.leftPt,
        y,
        bold: true,
      });
      return TYPOGRAPHY.bodyLeadingPt + TYPOGRAPHY.paragraphSpaceAfterPt;
    }

    case 'totals':
      return drawTotals(engine, block.lines, y);

    case 'termsList':
      return (
        drawTerms(engine, {
          items: block.items,
          topY: y,
          startNumber: placed.startNumber,
        }) + TERMS_LIST.spaceAfterPt
      );

    case 'closing': {
      let height = 0;
      for (const paragraph of block.paragraphs) {
        height +=
          engine.drawParagraph(paragraph, {
            x: BODY_BOX.leftPt,
            y: y + height,
            maxWidth: bodyWidth(),
          }) + TYPOGRAPHY.paragraphSpaceAfterPt;
      }
      return height;
    }

    case 'signature':
      return drawSignature(engine, block, y, context);

    default:
      return assertNeverBlock(block);
  }
}
