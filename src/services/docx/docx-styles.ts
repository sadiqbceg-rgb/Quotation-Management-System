/**
 * Shared Word formatting.
 *
 * ---------------------------------------------------------------------------
 * FONTS ARE NOT EMBEDDED
 * ---------------------------------------------------------------------------
 * The DOCX asks for **Calibri by name** (§14.3). It is present on the company's
 * Word installations, and it is what the approved document is set in. The PDF
 * embeds Carlito, which is metric-compatible with Calibri, so both documents
 * break lines in the same places despite carrying different fonts.
 *
 * Nothing is embedded: a DOCX with a font inside it is larger, and Calibri is
 * not redistributable anyway. Carlito is the documented fallback for a machine
 * without Calibri — it is metrically identical, so pagination survives.
 *
 * Every measurement comes from `document-layout.ts` through `docx-units.ts`.
 * There are no numbers in this file that were not measured somewhere else.
 */

import { AlignmentType, BorderStyle, type IRunOptions, type IParagraphOptions } from 'docx';

import { COLORS, TABLE, TYPOGRAPHY } from '@/config/document-layout';
import { toHalfPoints, toTwips } from './docx-units';

/** Word wants a colour as six hex digits with no `#`. */
export function hex(color: string): string {
  return color.replace('#', '').toUpperCase();
}

export const FONTS = {
  body: TYPOGRAPHY.bodyFamily,
  /** Documented fallback; metric-compatible, so pagination is unchanged. */
  fallback: TYPOGRAPHY.bodyFallbackFamily,
} as const;

/** The default run: 14 pt Calibri, black. */
export function bodyRun(text: string, overrides: Partial<IRunOptions> = {}): IRunOptions {
  return {
    text,
    font: FONTS.body,
    size: toHalfPoints(TYPOGRAPHY.bodySizePt),
    color: hex(COLORS.text),
    ...overrides,
  };
}

/**
 * Paragraph spacing that reproduces the approved document's rhythm.
 *
 * `line` is in twips at "exact" rule so Word does not apply its own leading —
 * the measured 18 pt is what the PDF uses, and a document that paginates
 * differently in Word would defeat the point of a metric-compatible font.
 */
export function bodyParagraph(overrides: Partial<IParagraphOptions> = {}): IParagraphOptions {
  return {
    spacing: {
      after: toTwips(TYPOGRAPHY.paragraphSpaceAfterPt),
      line: toTwips(TYPOGRAPHY.bodyLeadingPt),
      lineRule: 'exact',
    },
    ...overrides,
  };
}

/** A 0.5 pt solid black cell border — `size` is in eighths of a point. */
export const CELL_BORDER = {
  style: BorderStyle.SINGLE,
  size: Math.round(TABLE.borderWidthPt * 8),
  color: hex(TABLE.borderColor),
} as const;

export const TABLE_BORDERS = {
  top: CELL_BORDER,
  bottom: CELL_BORDER,
  left: CELL_BORDER,
  right: CELL_BORDER,
  insideHorizontal: CELL_BORDER,
  insideVertical: CELL_BORDER,
} as const;

/** No borders at all — the footer and signature layout tables. */
export const NO_BORDERS = {
  top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
} as const;

/** The model's cell alignment, as Word's. */
export function alignmentFor(align: 'left' | 'right' | 'center'): (typeof AlignmentType)[keyof typeof AlignmentType] {
  switch (align) {
    case 'right':
      return AlignmentType.RIGHT;
    case 'center':
      return AlignmentType.CENTER;
    default:
      return AlignmentType.LEFT;
  }
}
