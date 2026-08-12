/**
 * The drawing surface.
 *
 * Owns the current page, the cursor, and the letterhead background. Block
 * renderers ask it to draw; they never touch `pdf-lib` page state or do
 * coordinate arithmetic themselves.
 *
 * ---------------------------------------------------------------------------
 * THE LETTERHEAD
 * ---------------------------------------------------------------------------
 * `reference/letterhead.pdf` is embedded ONCE and drawn on every page. Embedding
 * per page would multiply the file size by the page count for no benefit.
 *
 * Its placement is not (0, 0). The letterhead's MediaBox is
 * `0 7.83 595.5 850.08` — 595.5 × 842.25 pt with a NON-ZERO y origin — while an
 * A4 page is `0 0 595.28 841.89`. Drawing it at the origin scaled to A4, which
 * is the obvious thing to do, puts the red header rule at y 36.0 instead of the
 * y 44.0 it occupies in the company's own file: eight points, about 2.8 mm, and
 * every measurement in §2.4 wrong by that much.
 *
 * So it is drawn at NATURAL SIZE with its top edge on the page's top edge:
 *
 *     y = PAGE.heightPt - mediaBox.y1        // 841.89 - 850.08 = -8.19
 *
 * Verified by rasterising both files and locating the red rule in each; they
 * agree to a tenth of a point. `pdf-generator.test.ts` asserts it.
 */

import { rgb, type PDFDocument, type PDFEmbeddedPage, type PDFImage, type PDFPage } from 'pdf-lib';

import { BODY_BOX, COLORS, LETTERHEAD_SOURCE, PAGE, TYPOGRAPHY } from '@/config/document-layout';
import { PdfGenerationError } from './pdf-errors';
import { faceFor, type EmbeddedFonts } from './pdf-fonts';
import { hexToRgb, toPdfY, type TopLeftRect, toDrawRect } from './pdf-coordinates';
import { measureText, wrapText, type TextRun } from './pdf-text';

export interface DrawTextOptions {
  x: number;
  /** Top-left y of the text's LINE BOX, not its baseline. */
  y: number;
  size?: number;
  bold?: boolean;
  color?: string;
  /** Draw an underline beneath the run, as the reference does for the email. */
  underline?: boolean;
}

/**
 * Where the baseline sits inside a line box.
 *
 * Callers position by LINE BOX top, in the same top-left space as every
 * measurement in the project, rather than half of them reasoning about
 * ascenders. This converts.
 *
 * The line box is `bodyLeadingPt` tall and the em box is `size` tall, so the
 * difference is split above and below — standard half-leading, and what Word
 * does. Without the half-leading the em box starts ABOVE the line box top, and
 * the first line of the document pokes 3 pt above the y-111 body margin.
 *
 * `ascentRatio` is Carlito's ascent as a fraction of em; it and Calibri agree,
 * which is the whole point of using a metric-compatible face.
 */
const ASCENT_RATIO = 0.78;

function baselineOffset(size: number, leading: number): number {
  return (leading - size) / 2 + size * ASCENT_RATIO;
}

export class PdfLayoutEngine {
  private readonly document: PDFDocument;
  private readonly fonts: EmbeddedFonts;
  private readonly background: PDFEmbeddedPage;

  private page: PDFPage;
  private pages: PDFPage[] = [];

  /** Top-left y of the next thing to be drawn. */
  private cursorY: number = BODY_BOX.topPt;

  constructor(document: PDFDocument, fonts: EmbeddedFonts, background: PDFEmbeddedPage) {
    this.document = document;
    this.fonts = fonts;
    this.background = background;
    this.page = this.startPage();
  }

  /* ------------------------------------------------------------------ */
  /* Pages                                                               */
  /* ------------------------------------------------------------------ */

  private startPage(): PDFPage {
    const page = this.document.addPage([PAGE.widthPt, PAGE.heightPt]);

    // Natural size, top-aligned. See the module comment for why not (0, 0).
    page.drawPage(this.background, {
      x: -LETTERHEAD_SOURCE.mediaBox.x0,
      y: PAGE.heightPt - LETTERHEAD_SOURCE.mediaBox.y1,
      width: this.background.width,
      height: this.background.height,
    });

    this.pages.push(page);
    this.cursorY = BODY_BOX.topPt;
    return page;
  }

  /** Begin a new page and reset the cursor to the top of the body box. */
  newPage(): void {
    this.page = this.startPage();
  }

  get pageCount(): number {
    return this.pages.length;
  }

  get currentPage(): PDFPage {
    return this.page;
  }

  get y(): number {
    return this.cursorY;
  }

  /** Space left in the body box, in points. */
  get remaining(): number {
    return BODY_BOX.bottomPt - this.cursorY;
  }

  advance(points: number): void {
    this.cursorY += points;
  }

  setY(topLeftY: number): void {
    this.cursorY = topLeftY;
  }

  /* ------------------------------------------------------------------ */
  /* Drawing                                                             */
  /* ------------------------------------------------------------------ */

  private colorOf(hex: string) {
    const { r, g, b } = hexToRgb(hex);
    return rgb(r, g, b);
  }

  /** Draw one line of text. Returns the height consumed. */
  drawLine(text: string, options: DrawTextOptions): number {
    const size = options.size ?? TYPOGRAPHY.bodySizePt;
    const font = faceFor(this.fonts, options.bold ?? false);
    const leading = TYPOGRAPHY.bodyLeadingPt;

    const baseline = options.y + baselineOffset(size, leading);

    if (text.length > 0) {
      this.page.drawText(text, {
        x: options.x,
        y: toPdfY(baseline),
        size,
        font,
        color: this.colorOf(options.color ?? COLORS.text),
      });

      if (options.underline === true) {
        const width = measureText(text, font, size);
        const underlineY = baseline + size * 0.09;

        this.page.drawLine({
          start: { x: options.x, y: toPdfY(underlineY) },
          end: { x: options.x + width, y: toPdfY(underlineY) },
          thickness: 0.5,
          color: this.colorOf(options.color ?? COLORS.text),
        });
      }
    }

    return leading;
  }

  /** Draw a sequence of runs on one line, each in its own face. */
  drawRuns(runs: readonly TextRun[], options: DrawTextOptions): number {
    const size = options.size ?? TYPOGRAPHY.bodySizePt;
    let x = options.x;

    for (const run of runs) {
      this.drawLine(run.text, { ...options, x, size, bold: run.bold });
      x += measureText(run.text, faceFor(this.fonts, run.bold), size);
    }

    return TYPOGRAPHY.bodyLeadingPt;
  }

  /** Wrap and draw a paragraph. Returns the height consumed. */
  drawParagraph(
    text: string,
    options: DrawTextOptions & { maxWidth: number },
  ): number {
    const size = options.size ?? TYPOGRAPHY.bodySizePt;
    const font = faceFor(this.fonts, options.bold ?? false);
    const lines = wrapText(text, font, size, options.maxWidth);

    let y = options.y;
    for (const line of lines) {
      this.drawLine(line, { ...options, y });
      y += TYPOGRAPHY.bodyLeadingPt;
    }

    return y - options.y;
  }

  drawRect(rect: TopLeftRect, options: { borderColor?: string; borderWidth?: number }): void {
    this.page.drawRectangle({
      ...toDrawRect(rect),
      borderColor: this.colorOf(options.borderColor ?? COLORS.text),
      borderWidth: options.borderWidth ?? 0.5,
    });
  }

  drawImage(image: PDFImage, rect: TopLeftRect): void {
    this.page.drawImage(image, toDrawRect(rect));
  }

  /* ------------------------------------------------------------------ */
  /* Measurement, so renderers use the same metrics the drawing will     */
  /* ------------------------------------------------------------------ */

  measure(text: string, options: { size?: number; bold?: boolean } = {}): number {
    return measureText(
      text,
      faceFor(this.fonts, options.bold ?? false),
      options.size ?? TYPOGRAPHY.bodySizePt,
    );
  }

  wrap(text: string, maxWidth: number, options: { size?: number; bold?: boolean } = {}): string[] {
    return wrapText(
      text,
      faceFor(this.fonts, options.bold ?? false),
      options.size ?? TYPOGRAPHY.bodySizePt,
      maxWidth,
    );
  }

  get embeddedFonts(): EmbeddedFonts {
    return this.fonts;
  }

  /* ------------------------------------------------------------------ */
  /* Page numbers — off unless a setting enables them (§26 UR-07)        */
  /* ------------------------------------------------------------------ */

  /**
   * Stamp `Page X of Y` in the footer band of every page.
   *
   * Deferred to the end because Y is unknown until the last block is drawn.
   */
  stampPageNumbers(): void {
    const total = this.pages.length;

    this.pages.forEach((page, index) => {
      const label = `Page ${String(index + 1)} of ${String(total)}`;
      const size = TYPOGRAPHY.footerBodySizePt;
      const width = measureText(label, this.fonts.regular, size);

      page.drawText(label, {
        x: (PAGE.widthPt - width) / 2,
        y: toPdfY(BODY_BOX.bottomPt + size),
        size,
        font: this.fonts.regular,
        color: this.colorOf(COLORS.text),
      });
    });
  }

  /**
   * Every page's body content stayed inside the body box.
   *
   * A cheap invariant with an expensive failure mode: content past the bottom
   * margin lands on the letterhead's footer and is unreadable in print.
   */
  assertWithinBodyBox(): void {
    if (this.cursorY > BODY_BOX.bottomPt) {
      throw new PdfGenerationError(
        'LAYOUT_FAILED',
        'The quotation content overflowed the page. Try shortening the terms or splitting the quotation.',
      );
    }
  }
}
