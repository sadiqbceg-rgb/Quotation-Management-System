/**
 * The one place top-left geometry becomes bottom-left PDF coordinates.
 *
 * ---------------------------------------------------------------------------
 * WHY EXACTLY ONE HELPER
 * ---------------------------------------------------------------------------
 * Every measurement in `document-layout.ts` is top-left, because that is how
 * the reference documents were measured. `pdf-lib`'s origin is bottom-left.
 *
 * Scattering `841.89 - y` through a renderer is how a document ends up one line
 * too low on page 3 only. There is one conversion, it is tested, and no other
 * module may do the arithmetic itself.
 *
 * Points are BRANDED. A twip (1/20 pt, used by the DOCX in Phase 09) and a CSS
 * pixel are both numbers, and both would silently produce a wrong document if
 * passed where a point belongs.
 */

import { PAGE } from '@/config/document-layout';

declare const pointsBrand: unique symbol;

/** A PDF point: 1/72 inch. */
export type Points = number & { readonly [pointsBrand]: 'Points' };

export function pt(value: number): Points {
  return value as Points;
}

/**
 * Convert a top-left y to the bottom-left y of the same point.
 *
 * `height` is the height of the thing being placed, because PDF drawing
 * operators anchor at the BOTTOM of a box while every measurement in this
 * project anchors at the top. Pass 0 for a text baseline.
 */
export function toPdfY(topLeftY: number, height = 0): Points {
  return pt(PAGE.heightPt - topLeftY - height);
}

/** Convert a bottom-left y back to top-left. The inverse of `toPdfY`. */
export function fromPdfY(pdfY: number, height = 0): Points {
  return pt(PAGE.heightPt - pdfY - height);
}

/**
 * A rectangle in the project's top-left space.
 *
 * Kept distinct from pdf-lib's own rect options so a top-left rect can never be
 * handed straight to a draw call.
 */
export interface TopLeftRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Place a top-left rect as pdf-lib draw options. */
export function toDrawRect(rect: TopLeftRect): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  return {
    x: rect.x,
    y: toPdfY(rect.y, rect.height),
    width: rect.width,
    height: rect.height,
  };
}

/**
 * Fit a box inside a target rect, preserving aspect ratio and centring it.
 *
 * Used for the seal and the signature: both have measured rects in the approved
 * document, but the uploaded image's own proportions are whatever the company
 * scanned. Stretching a signature to fill a rect makes it look forged.
 */
export function fitInside(
  intrinsicWidth: number,
  intrinsicHeight: number,
  target: TopLeftRect,
): TopLeftRect {
  if (intrinsicWidth <= 0 || intrinsicHeight <= 0) return target;

  const scale = Math.min(target.width / intrinsicWidth, target.height / intrinsicHeight);
  const width = intrinsicWidth * scale;
  const height = intrinsicHeight * scale;

  return {
    x: target.x + (target.width - width) / 2,
    y: target.y + (target.height - height) / 2,
    width,
    height,
  };
}

/** Parse `#rrggbb` into pdf-lib's 0–1 channel triple. */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const value = hex.replace('#', '');
  if (value.length !== 6) {
    throw new Error(`Expected a #rrggbb colour, received "${hex}".`);
  }

  return {
    r: Number.parseInt(value.slice(0, 2), 16) / 255,
    g: Number.parseInt(value.slice(2, 4), 16) / 255,
    b: Number.parseInt(value.slice(4, 6), 16) / 255,
  };
}
