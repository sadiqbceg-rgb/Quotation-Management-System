/**
 * The DOCX layout arithmetic, without building a document.
 *
 * These are the functions that decide WHERE things go. They are pure and cheap,
 * so they are asserted directly against the §2.4 measurements rather than by
 * unzipping a package and reading positions back out of XML.
 */

import { describe, expect, it } from 'vitest';

import { BODY_BOX, LETTERHEAD, PAGE, SIGNATURE_BLOCK, TABLE } from '@/config/document-layout';
import { BAND_LEFT_PT, BAND_RIGHT_PT, BAND_WIDTH_PT, BAND_INDENT_PT } from './docx-band';
import { footerColumnRatios } from './docx-footer';
import { headerColumnRatios } from './docx-header';
import { signatureColumnRatios, SIGNATURE_COLUMN_SPLIT_PT } from './docx-signature';
import { tableIndentPt } from './docx-table';
import { watermarkSize } from './docx-watermark';
import { columnTwips, toPixels, twipsToPoints, type Twips } from './docx-units';

/** Where a band's column starts, in page points. */
function columnLefts(ratios: number[]): number[] {
  const widths = columnTwips(ratios, BAND_WIDTH_PT);

  const lefts: number[] = [];
  let x = BAND_LEFT_PT;

  for (const width of widths) {
    lefts.push(x);
    x += twipsToPoints(width);
  }
  return lefts;
}

describe('the letterhead bands', () => {
  it('start at the logo, outside the text margin', () => {
    expect(BAND_LEFT_PT).toBe(LETTERHEAD.logoRect.x0);
    // Negative: the band reaches into the left margin, where the artwork is.
    expect(BAND_INDENT_PT).toBeLessThan(0);
    expect(BAND_INDENT_PT).toBeCloseTo(LETTERHEAD.logoRect.x0 - BODY_BOX.leftPt, 5);
  });

  it('run to the page edge, never past it', () => {
    expect(BAND_RIGHT_PT).toBeLessThanOrEqual(PAGE.widthPt);
    expect(BAND_RIGHT_PT).toBeGreaterThan(BODY_BOX.rightPt);
  });
});

describe('the header band', () => {
  it('splits at the red rule, where the letterhead puts the name block', () => {
    const [logoColumn, nameColumn] = columnLefts(headerColumnRatios());

    expect(logoColumn).toBeCloseTo(LETTERHEAD.logoRect.x0, 1);
    expect(nameColumn).toBeCloseTo(LETTERHEAD.headerRule.x0, 1);
  });

  it('leaves the name column wide enough for the company name', () => {
    const widths = columnTwips(headerColumnRatios(), BAND_WIDTH_PT);
    const nameColumnPt = twipsToPoints((widths[1] ?? 0) as Twips);

    // `SPEED FALCON COMPANY` measures 231.8 pt on the letterhead. A column
    // narrower than that wraps it onto two lines.
    expect(nameColumnPt).toBeGreaterThan(231.8);
  });
});

describe('the footer band', () => {
  it('places all three columns where the letterhead does', () => {
    const lefts = columnLefts(footerColumnRatios());

    expect(lefts).toHaveLength(LETTERHEAD.footerColumnsX.length);
    lefts.forEach((left, index) => {
      expect(left).toBeCloseTo(LETTERHEAD.footerColumnsX[index] ?? 0, 1);
    });
  });

  it('sums to the whole band', () => {
    const total = footerColumnRatios().reduce((sum, ratio) => sum + ratio, 0);
    expect(total).toBeCloseTo(1, 10);
  });
});

describe('the watermark', () => {
  it('is the measured 318.1 × 174.9 pt', () => {
    const size = watermarkSize();

    expect(size.width).toBe(toPixels(LETTERHEAD.watermarkRect.x1 - LETTERHEAD.watermarkRect.x0));
    expect(size.height).toBe(toPixels(LETTERHEAD.watermarkRect.y1 - LETTERHEAD.watermarkRect.y0));
    expect(twipsToPoints((size.width * 15) as Twips)).toBeCloseTo(318.1, 0);
  });
});

describe('the items table', () => {
  it('is centred on the page, not between the margins', () => {
    const left = BODY_BOX.leftPt + tableIndentPt();
    const right = left + TABLE.defaultWidthPt;

    // §2.4: the approved table's centre is the page centre, 297.65.
    expect((left + right) / 2).toBeCloseTo(PAGE.widthPt / 2, 5);
    // Which is NOT the centre of the text box — that is the whole point.
    expect((left + right) / 2).not.toBeCloseTo((BODY_BOX.leftPt + BODY_BOX.rightPt) / 2, 1);
  });
});

describe('the signature block', () => {
  it('splits the columns at the signature line', () => {
    expect(SIGNATURE_COLUMN_SPLIT_PT).toBe(SIGNATURE_BLOCK.signatureLabelXPt);
  });

  it('keeps the details clear of the seal (PRD §25)', () => {
    const widths = columnTwips(signatureColumnRatios(), BODY_BOX.widthPt);
    const detailsRight = BODY_BOX.leftPt + twipsToPoints((widths[0] ?? 0) as Twips);

    // Structural, not incidental: however long a job title is, it is cut off by
    // the column before it can reach the seal.
    expect(detailsRight).toBeLessThan(SIGNATURE_BLOCK.sealRect.x0);
  });

  it('puts the signature over the line rather than beside it', () => {
    // The label brackets the image horizontally and the image brackets the
    // label vertically — the person signs ON the line.
    expect(SIGNATURE_BLOCK.signatureLabelXPt).toBeLessThan(SIGNATURE_BLOCK.signatureRect.x0);
    expect(SIGNATURE_BLOCK.signatureRect.y0).toBeLessThan(SIGNATURE_BLOCK.signatureLabelYPt);
    expect(SIGNATURE_BLOCK.signatureRect.y1).toBeGreaterThan(SIGNATURE_BLOCK.signatureLabelYPt);
  });

  it('keeps the label inside the page', () => {
    // It ran off the right edge until Phase 09 corrected the measurement.
    expect(SIGNATURE_BLOCK.signatureLabelXPt).toBeLessThan(BODY_BOX.rightPt);
  });
});
