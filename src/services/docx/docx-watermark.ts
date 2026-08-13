/**
 * The page watermark — the lightened logo, behind the text.
 *
 * ---------------------------------------------------------------------------
 * WHY IT LIVES IN THE HEADER
 * ---------------------------------------------------------------------------
 * Word has no "page background image". Its watermark feature IS a floating
 * image anchored inside the header, which is why every Word document with a
 * DRAFT stamp has one there. Putting it in the header is what makes it appear
 * on every page — including pages that do not exist yet, if the company edits
 * the file and it grows — without emitting anything per page.
 *
 * A floating image in the BODY would anchor to whichever paragraph it followed
 * and would appear once, on that paragraph's page.
 *
 * ---------------------------------------------------------------------------
 * PLACEMENT
 * ---------------------------------------------------------------------------
 * Positioned by OFFSET from the page corner, not by `align: CENTER`. The
 * measured rect (§2.4) is centred vertically on the page and sits 9.5 pt right
 * of the horizontal centre, and the point of this module is to reproduce the
 * company's artwork rather than an idealised version of it. The PDF draws the
 * same rect; centring here would put the two documents' watermarks in
 * different places.
 *
 * `behindDocument: true` is the branding requirement (§13 / Phase 09 error
 * handling): a watermark in FRONT of the text would obscure a client's prices.
 */

import {
  HorizontalPositionRelativeFrom,
  ImageRun,
  Paragraph,
  TextWrappingType,
  VerticalPositionRelativeFrom,
} from 'docx';

import { LETTERHEAD } from '@/config/document-layout';
import { toEmu, toPixels } from './docx-units';

/** The watermark's printed size, from the measured rect. */
export function watermarkSize(): { width: number; height: number } {
  return {
    width: toPixels(LETTERHEAD.watermarkRect.x1 - LETTERHEAD.watermarkRect.x0),
    height: toPixels(LETTERHEAD.watermarkRect.y1 - LETTERHEAD.watermarkRect.y0),
  };
}

/**
 * A paragraph carrying nothing but the floating watermark.
 *
 * Returned as a paragraph rather than a run because a floating image still
 * needs an anchor paragraph in the header; it has no text and no spacing, so it
 * adds no visible height to the header band.
 */
export function buildWatermark(image: Uint8Array): Paragraph {
  return new Paragraph({
    spacing: { before: 0, after: 0 },
    children: [
      new ImageRun({
        type: 'png',
        data: image,
        transformation: watermarkSize(),
        altText: {
          name: 'Watermark',
          title: 'Watermark',
          description: 'Speed Falcon Company logo watermark',
        },
        floating: {
          horizontalPosition: {
            relative: HorizontalPositionRelativeFrom.PAGE,
            offset: toEmu(LETTERHEAD.watermarkRect.x0),
          },
          verticalPosition: {
            relative: VerticalPositionRelativeFrom.PAGE,
            offset: toEmu(LETTERHEAD.watermarkRect.y0),
          },
          behindDocument: true,
          // The text flows straight over it; anything else would reflow the
          // body around a decoration and change where the pages break.
          wrap: { type: TextWrappingType.NONE },
          allowOverlap: true,
          lockAnchor: true,
        },
      }),
    ],
  });
}
