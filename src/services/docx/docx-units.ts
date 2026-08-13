/**
 * Unit conversion for Word.
 *
 * ---------------------------------------------------------------------------
 * WHY BRANDED TYPES
 * ---------------------------------------------------------------------------
 * Word measures in three units at once, and they are all plain numbers:
 *
 *   twips  1/20 pt   page size, margins, table widths, indents
 *   points           font sizes are HALF-points, which is a fourth trap
 *   pixels 1/96 in   image dimensions, because `docx` takes them that way
 *
 * `680` is a valid left margin in twips and a nonsensical one in points. The
 * brands make passing the wrong one a compile error rather than a document that
 * is silently 20× too wide.
 *
 * Every measurement enters as points from `document-layout.ts` and is converted
 * here. Nothing else in the DOCX renderer does arithmetic on a measurement.
 */

declare const twipsBrand: unique symbol;
declare const halfPointsBrand: unique symbol;
declare const pixelsBrand: unique symbol;
declare const emuBrand: unique symbol;

/** 1/20 of a point. Word's unit for page geometry. */
export type Twips = number & { readonly [twipsBrand]: 'Twips' };

/** Word states font sizes in half-points: 14 pt is `28`. */
export type HalfPoints = number & { readonly [halfPointsBrand]: 'HalfPoints' };

/** 1/96 inch. What `docx` expects for image dimensions. */
export type Pixels = number & { readonly [pixelsBrand]: 'Pixels' };

/** English Metric Units, 1/914400 inch. Used ONLY by floating-image offsets. */
export type Emu = number & { readonly [emuBrand]: 'Emu' };

const TWIPS_PER_POINT = 20;
const PIXELS_PER_INCH = 96;
const POINTS_PER_INCH = 72;
const EMU_PER_INCH = 914_400;

/** Points to twips. Rounded: Word rejects fractional twips. */
export function toTwips(points: number): Twips {
  return Math.round(points * TWIPS_PER_POINT) as Twips;
}

/** Points to half-points, for `size` on a run. */
export function toHalfPoints(points: number): HalfPoints {
  return Math.round(points * 2) as HalfPoints;
}

/** Points to CSS pixels, for image dimensions. */
export function toPixels(points: number): Pixels {
  return Math.round((points / POINTS_PER_INCH) * PIXELS_PER_INCH) as Pixels;
}

/**
 * Points to EMU, for a floating image's offset from the page corner.
 *
 * A fourth unit, and the reason the brands exist at all: `148` is a plausible
 * number in all four, and only one of them positions the watermark where the
 * letterhead puts it.
 */
export function toEmu(points: number): Emu {
  return Math.round((points / POINTS_PER_INCH) * EMU_PER_INCH) as Emu;
}

/** Twips back to points, for assertions and for reading a document back. */
export function twipsToPoints(twips: Twips): number {
  return twips / TWIPS_PER_POINT;
}

/**
 * Split a table's total width into column twips from the model's ratios.
 *
 * The remainder is folded into the LAST column so the columns always sum to the
 * table width exactly. Rounding each independently leaves a one-twip gap that
 * Word renders as a hairline seam down the table.
 */
export function columnTwips(ratios: readonly number[], totalPoints: number): Twips[] {
  const total = toTwips(totalPoints);
  const widths: number[] = [];

  let used = 0;
  ratios.forEach((ratio, index) => {
    if (index === ratios.length - 1) {
      widths.push(total - used);
      return;
    }
    const width = Math.round(total * ratio);
    widths.push(width);
    used += width;
  });

  return widths as Twips[];
}
