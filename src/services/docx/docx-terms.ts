/**
 * The Terms & Conditions list, as real Word numbering.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT LITERAL "1." TEXT
 * ---------------------------------------------------------------------------
 * The PDF draws the numbers itself, because a PDF has no list construct. Word
 * does, and the company edits these files: someone deletes term 4, and with
 * literal text the document then reads 1, 2, 3, 5, 6. With a numbering
 * definition Word renumbers on the spot.
 *
 * The hanging indent reproduces the approved document exactly — the number at
 * x 52 and the text at x 70 (§2.4) — expressed the way Word wants it: an
 * indent to the TEXT position with a hanging offset back to the number.
 *
 * The definition is registered on the Document (see `docx-generator.ts`) under
 * `TERMS_NUMBERING_REFERENCE`; this module only references it.
 */

import { Paragraph, TextRun, type ILevelsOptions, LevelFormat, AlignmentType } from 'docx';

import { BODY_BOX, COLORS, TERMS_LIST, TYPOGRAPHY } from '@/config/document-layout';
import type { TermItem } from '@/services/document/document-model.types';
import { hex, FONTS } from './docx-styles';
import { toHalfPoints, toTwips } from './docx-units';

/** The single numbering definition the terms list uses. */
export const TERMS_NUMBERING_REFERENCE = 'quotation-terms';

/**
 * `1.`, `2.`, `3.` … with the reference document's hanging indent.
 *
 * `left` is where the TEXT starts and `hanging` is how far back the number
 * sits, so both come straight from the two measured x positions.
 */
export const TERMS_NUMBERING_LEVELS: readonly ILevelsOptions[] = [
  {
    level: 0,
    format: LevelFormat.DECIMAL,
    text: '%1.',
    alignment: AlignmentType.LEFT,
    start: 1,
    style: {
      /*
       * The number takes the LEVEL's run properties, not the paragraph's. Left
       * unset it inherits the document default — 10 pt — and the list renders
       * with numbers visibly smaller than the terms they number.
       */
      run: {
        font: FONTS.body,
        size: toHalfPoints(TYPOGRAPHY.bodySizePt),
        color: hex(COLORS.text),
        bold: true,
      },
      paragraph: {
        indent: {
          left: toTwips(TERMS_LIST.textXPt - BODY_BOX.leftPt),
          hanging: toTwips(TERMS_LIST.textXPt - TERMS_LIST.numberXPt),
        },
      },
    },
  },
];

/**
 * One term: the title in bold, then the body, running on as one paragraph.
 *
 * They run on rather than stacking because that is how the approved document
 * prints them, and because the shared paginator measures them as one wrapped
 * flow (`termItemHeight`). Two paragraphs here would break pages differently
 * from the PDF.
 */
export function buildTermParagraph(item: TermItem): Paragraph {
  const children: TextRun[] = [
    new TextRun({
      text: item.title.length > 0 ? `${item.title}: ` : '',
      font: FONTS.body,
      bold: true,
      size: toHalfPoints(TYPOGRAPHY.bodySizePt),
      color: hex(COLORS.text),
    }),
  ];

  if (item.body.length > 0) {
    children.push(
      new TextRun({
        text: item.body,
        font: FONTS.body,
        size: toHalfPoints(TYPOGRAPHY.bodySizePt),
        color: hex(COLORS.text),
      }),
    );
  }

  return new Paragraph({
    numbering: { reference: TERMS_NUMBERING_REFERENCE, level: 0 },
    spacing: {
      after: toTwips(TERMS_LIST.spaceAfterPt),
      line: toTwips(TERMS_LIST.leadingPt),
      lineRule: 'exact',
    },
    // A term split across a page break is what PAGINATION.keepTermItemTogether
    // forbids in the PDF; Word expresses the same rule per paragraph.
    keepLines: true,
    children,
  });
}

/** Every term, in the model's order. Word supplies the numbers. */
export function buildTerms(items: readonly TermItem[]): Paragraph[] {
  return items.map(buildTermParagraph);
}
