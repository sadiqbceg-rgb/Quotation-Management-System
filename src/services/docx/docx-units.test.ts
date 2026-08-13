/**
 * Unit conversion — the four units Word mixes, and the one helper that converts.
 */

import { describe, expect, it } from 'vitest';

import { PAGE } from '@/config/document-layout';
import { columnTwips, toEmu, toHalfPoints, toPixels, toTwips, twipsToPoints } from './docx-units';

describe('points to twips', () => {
  it('converts A4 to the twip dimensions Word expects', () => {
    // The values the section properties must carry — 11906 × 16838.
    expect(toTwips(PAGE.widthPt)).toBe(PAGE.widthTwips);
    expect(toTwips(PAGE.heightPt)).toBe(PAGE.heightTwips);
  });

  it('rounds, because Word rejects a fractional twip', () => {
    expect(toTwips(1.007)).toBe(20);
    expect(Number.isInteger(toTwips(33.9))).toBe(true);
  });

  it('round-trips back to points', () => {
    expect(twipsToPoints(toTwips(34))).toBe(34);
  });
});

describe('points to half-points', () => {
  it('states 14 pt as 28', () => {
    expect(toHalfPoints(14)).toBe(28);
  });

  it('rounds a half-point size rather than emitting a fraction', () => {
    expect(toHalfPoints(10.5)).toBe(21);
    expect(toHalfPoints(10.26)).toBe(21);
  });
});

describe('points to pixels', () => {
  it('scales 72 pt to 96 px', () => {
    expect(toPixels(72)).toBe(96);
  });

  it('keeps the seal at its measured size', () => {
    // 119.0 × 108.8 pt, from the approved document.
    expect(toPixels(119)).toBe(159);
    expect(toPixels(108.8)).toBe(145);
  });
});

describe('points to EMU', () => {
  it('scales an inch to 914400', () => {
    expect(toEmu(72)).toBe(914_400);
  });

  it('is a different number from every other unit at the same size', () => {
    // The reason the brands exist: 148 is plausible in all four.
    const points = 148.1;
    const converted = [toTwips(points), toPixels(points), toEmu(points), toHalfPoints(points)];
    expect(new Set(converted).size).toBe(converted.length);
  });
});

describe('column widths', () => {
  const total = 453.9;

  it('sums to the table width exactly', () => {
    const widths = columnTwips([0.4, 0.15, 0.15, 0.15, 0.15], total);
    expect(widths.reduce((sum, width) => sum + width, 0)).toBe(toTwips(total));
  });

  it('folds the remainder into the last column, not into a gap', () => {
    // Three exact thirds cannot be represented in whole twips; the shortfall
    // has to land somewhere, and a one-twip gap renders as a hairline seam.
    const widths = columnTwips([1 / 3, 1 / 3, 1 / 3], total);

    expect(widths.reduce((sum, width) => sum + width, 0)).toBe(toTwips(total));
    expect(widths[0]).toBe(widths[1]);
    expect(Math.abs((widths[2] ?? 0) - (widths[0] ?? 0))).toBeLessThanOrEqual(2);
  });

  it('handles a single column', () => {
    expect(columnTwips([1], total)).toEqual([toTwips(total)]);
  });

  it('returns nothing for no columns', () => {
    expect(columnTwips([], total)).toEqual([]);
  });
});
