/**
 * The signature block.
 *
 * A two-column borderless table with `cantSplit: true`, which is Word's way of
 * saying what `PAGINATION.signatureBlockAtomic` says to the PDF: this block
 * moves whole or not at all. A signature stranded on its own page above an
 * orphaned seal is not a document anyone should send a client.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE APPROVED DOCUMENT ACTUALLY DOES
 * ---------------------------------------------------------------------------
 * Details down the left from x 34; the seal on the right at x 373.7–492.7,
 * y 550.9–659.7; `Signature:______________` at x 323.9–480.9, y 717.5; and the
 * signature image at x 392.8–463.0, y 676.1–733.6 — which BRACKETS the label's
 * span in both directions. The person signs ON the line, so the image sits over
 * it rather than beside it, and it is floated here to reproduce that.
 *
 * The column splits at the label's left edge, which is still well right of the
 * longest detail line (x 210.5 in the approved document), so the details can
 * never run under the seal (PRD §25). Same guarantee the PDF gets from
 * `signatureRects`, by a different mechanism.
 *
 * Every line is bold, matching what the PDF draws. PDF/DOCX parity is a hard
 * requirement and the PDF is the benchmark; a weight that differs between the
 * two files is a drift, however small.
 */

import {
  HorizontalPositionRelativeFrom,
  ImageRun,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  TextWrappingType,
  VerticalPositionRelativeFrom,
  WidthType,
} from 'docx';

import { BODY_BOX, COLORS, SIGNATURE_BLOCK, TYPOGRAPHY } from '@/config/document-layout';
import { BAND_CELL_MARGINS } from './docx-band';
import { hex, FONTS, NO_BORDERS } from './docx-styles';
import { columnTwips, toEmu, toHalfPoints, toPixels, toTwips } from './docx-units';

/** The label printed beside the signature image, as in the approved document. */
export const SIGNATURE_LABEL = 'Signature:______________';

/** Where the two columns meet: the signature line's left edge. */
export const SIGNATURE_COLUMN_SPLIT_PT = SIGNATURE_BLOCK.signatureLabelXPt;

/** Left column ends where the signature line begins; the seal is further right. */
export function signatureColumnRatios(): number[] {
  const left = SIGNATURE_COLUMN_SPLIT_PT - BODY_BOX.leftPt;
  const right = BODY_BOX.rightPt - SIGNATURE_COLUMN_SPLIT_PT;
  const total = left + right;

  return total === 0 ? [0.5, 0.5] : [left / total, right / total];
}

function sealSize(): { width: number; height: number } {
  return {
    width: toPixels(SIGNATURE_BLOCK.sealRect.x1 - SIGNATURE_BLOCK.sealRect.x0),
    height: toPixels(SIGNATURE_BLOCK.sealRect.y1 - SIGNATURE_BLOCK.sealRect.y0),
  };
}

function signatureSize(): { width: number; height: number } {
  return {
    width: toPixels(SIGNATURE_BLOCK.signatureRect.x1 - SIGNATURE_BLOCK.signatureRect.x0),
    height: toPixels(SIGNATURE_BLOCK.signatureRect.y1 - SIGNATURE_BLOCK.signatureRect.y0),
  };
}

/** One detail line, coloured the way the approved document colours it. */
function detailLine(line: string, index: number): Paragraph {
  const isCompany = index === 2;
  const isEmail = line.startsWith('Email:');

  return new Paragraph({
    spacing: {
      after: 0,
      line: toTwips(SIGNATURE_BLOCK.detailsLinePitchPt),
      lineRule: 'exact',
    },
    children: [
      new TextRun({
        text: line,
        font: FONTS.body,
        bold: true,
        size: toHalfPoints(TYPOGRAPHY.bodySizePt),
        color: hex(isCompany ? COLORS.navy : isEmail ? COLORS.linkBlue : COLORS.text),
        // `exactOptionalPropertyTypes`: the key is absent, not undefined.
        ...(isEmail ? { underline: {} } : {}),
      }),
    ],
  });
}

export interface SignatureImages {
  /** `seal-transparent.png` — the alpha-keyed one, never the opaque original. */
  seal: Uint8Array;
  /** Null on a draft. The area is then left empty; nothing is fabricated. */
  signature: Uint8Array | null;
}

export function buildSignature(lines: readonly string[], images: SignatureImages): Table {
  const widths = columnTwips(signatureColumnRatios(), BODY_BOX.widthPt);

  const details = lines.map((line, index) => detailLine(line, index));

  /*
   * The signature image is floated from the SEAL's paragraph, not from the
   * signature line's.
   *
   * It has to overlap the line it is written on — the approved document puts
   * the image at y 676.1–733.6 across a label whose text sits at 703.4 — and a
   * float anchored to the line's own paragraph would have to reach UPWARDS out
   * of it, which LibreOffice clamps to the paragraph's top edge. Anchoring to
   * the paragraph above and reaching down is the same geometry stated in a
   * direction both Word and LibreOffice honour, and every offset stays a
   * measured, positive distance from the seal.
   */
  const floatingSignature =
    images.signature === null
      ? null
      : new ImageRun({
          type: 'png',
          data: images.signature,
          transformation: signatureSize(),
          altText: {
            name: 'Signature',
            title: 'Signature',
            description: 'Authorized signature',
          },
          floating: {
            horizontalPosition: {
              relative: HorizontalPositionRelativeFrom.COLUMN,
              offset: toEmu(SIGNATURE_BLOCK.signatureRect.x0 - SIGNATURE_COLUMN_SPLIT_PT),
            },
            verticalPosition: {
              relative: VerticalPositionRelativeFrom.PARAGRAPH,
              offset: toEmu(SIGNATURE_BLOCK.signatureRect.y0 - SIGNATURE_BLOCK.sealRect.y0),
            },
            // In FRONT of the line, never behind it: a signature the underscores
            // are drawn over would look like a strike-through.
            behindDocument: false,
            wrap: { type: TextWrappingType.NONE },
            allowOverlap: true,
            lockAnchor: true,
          },
        });

  const seal = new ImageRun({
    type: 'png',
    data: images.seal,
    transformation: sealSize(),
    altText: {
      name: 'Company seal',
      title: 'Company seal',
      description: 'Speed Falcon Company seal',
    },
  });

  const sealParagraph = new Paragraph({
    spacing: { before: 0, after: 0 },
    // The seal sits further right than the column starts.
    indent: { left: toTwips(SIGNATURE_BLOCK.sealRect.x0 - SIGNATURE_COLUMN_SPLIT_PT) },
    children: floatingSignature === null ? [seal] : [seal, floatingSignature],
  });

  const signatureParagraph = new Paragraph({
    /*
     * The measured gap from the seal's bottom edge down to the signature line,
     * so the line lands under the floated signature rather than beside it.
     */
    spacing: {
      before: toTwips(SIGNATURE_BLOCK.signatureLabelYPt - SIGNATURE_BLOCK.sealRect.y1),
      after: 0,
    },
    children: [
      new TextRun({
        text: SIGNATURE_LABEL,
        font: FONTS.body,
        size: toHalfPoints(TYPOGRAPHY.bodySizePt),
        color: hex(COLORS.text),
      }),
    ],
  });

  return new Table({
    width: { size: toTwips(BODY_BOX.widthPt), type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    columnWidths: widths,
    borders: NO_BORDERS,
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            borders: NO_BORDERS,
            // Zeroed, so a column's text starts exactly at its measured x.
            margins: BAND_CELL_MARGINS,
            width: { size: widths[0] ?? 0, type: WidthType.DXA },
            children: details.length > 0 ? details : [new Paragraph({ children: [] })],
          }),
          new TableCell({
            borders: NO_BORDERS,
            // Zeroed, so a column's text starts exactly at its measured x.
            margins: BAND_CELL_MARGINS,
            width: { size: widths[1] ?? 0, type: WidthType.DXA },
            children: [sealParagraph, signatureParagraph],
          }),
        ],
      }),
    ],
  });
}
