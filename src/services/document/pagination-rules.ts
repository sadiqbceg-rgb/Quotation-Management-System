/**
 * Pagination.
 *
 * See IMPLEMENTATION_PLAN.md §12.3.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS SHARED
 * ---------------------------------------------------------------------------
 * The preview, the PDF and the DOCX must break pages in the SAME place. If the
 * preview shows two pages and the PDF produces three, the user has been shown
 * something other than what the client will receive.
 *
 * Heights come from `BLOCK_METRICS`, which are measured estimates rather than
 * real text shaping. That is a deliberate trade: a shared approximation keeps
 * the three outputs consistent with one another, which matters more here than
 * any one of them being pixel-exact. The estimates are conservative — they
 * round line counts up — so a block is more likely to move to the next page
 * than to overflow off the bottom of one.
 *
 * This module is pure. No DOM, no canvas, no measurement of rendered text.
 */

import {
  BLOCK_METRICS,
  BODY_BOX,
  PAGINATION,
  SIGNATURE_BLOCK,
  TABLE,
} from '@/config/document-layout';
import {
  assertNeverBlock,
  type DocumentBlock,
  type DocumentModel,
  type TermItem,
} from './document-model.types';

/* -------------------------------------------------------------------------- */
/* Measurement                                                                */
/* -------------------------------------------------------------------------- */

/** Lines a string occupies at a given width, rounded up. Never below one. */
export function estimateLineCount(text: string, charsPerLine: number): number {
  if (charsPerLine <= 0) return 1;

  // Explicit newlines break lines regardless of length.
  return text
    .split('\n')
    .reduce((total, segment) => total + Math.max(1, Math.ceil(segment.length / charsPerLine)), 0);
}

function paragraphHeight(text: string, charsPerLine = BLOCK_METRICS.charsPerLine): number {
  return (
    estimateLineCount(text, charsPerLine) * BLOCK_METRICS.lineHeightPt +
    BLOCK_METRICS.paragraphSpaceAfterPt
  );
}

/** The height of one term item, title and body wrapped together. */
export function termItemHeight(item: { title: string; body: string }): number {
  // The title and body run on as `**Title:** body` in the approved document, so
  // they wrap as one flow, not two.
  return paragraphHeight(`${item.title}: ${item.body}`, BLOCK_METRICS.termCharsPerLine);
}

/** How tall a block is, in points. */
export function measureBlock(block: DocumentBlock): number {
  switch (block.kind) {
    case 'meta':
      return block.rows.length * BLOCK_METRICS.metaRowHeightPt + BLOCK_METRICS.paragraphSpaceAfterPt;

    case 'heading':
      return BLOCK_METRICS.headingHeightPt;

    case 'paragraph':
      return paragraphHeight(block.text);

    case 'table':
      // Header plus every body row. Splitting is handled separately.
      return (block.rows.length + 1) * BLOCK_METRICS.tableRowHeightPt;

    case 'summaryLine':
      return BLOCK_METRICS.lineHeightPt + BLOCK_METRICS.paragraphSpaceAfterPt;

    case 'totals':
      return (
        block.lines.length * BLOCK_METRICS.totalsLineHeightPt + BLOCK_METRICS.paragraphSpaceAfterPt
      );

    case 'termsList':
      return block.items.reduce((total, item) => total + termItemHeight(item), 0);

    case 'closing':
      return block.paragraphs.reduce((total, text) => total + paragraphHeight(text), 0);

    case 'signature':
      return SIGNATURE_BLOCK.reservedHeightPt;

    default:
      return assertNeverBlock(block);
  }
}

/* -------------------------------------------------------------------------- */
/* Pages                                                                      */
/* -------------------------------------------------------------------------- */

export interface PlacedBlock {
  block: DocumentBlock;
  heightPt: number;
  /**
   * True when this is a continuation of a table split across pages — the header
   * is repeated above it (PRD §27).
   */
  isContinuation: boolean;
  /** For a split terms list, the 1-based number the first item carries. */
  startNumber: number;
}

export interface DocumentPage {
  /** 1-based. */
  pageNumber: number;
  blocks: PlacedBlock[];
}

/**
 * How the paginator measures.
 *
 * Injectable because the preview and the PDF measure differently and MUST NOT
 * decide differently. The POLICY — what may split, what is atomic, when a
 * header repeats — lives in `paginate()` and has exactly one implementation.
 * Only the ruler changes: the preview has no font, so it estimates; the PDF has
 * the embedded font's real advance widths and uses them, because it is drawing
 * the actual glyphs and must not overflow the page.
 *
 * The estimator rounds line counts up, so it errs towards breaking early rather
 * than overflowing. The two agree except on borderline documents.
 */
export interface PaginationMeasurer {
  block: (block: DocumentBlock) => number;
  termItem: (item: TermItem) => number;
  /**
   * Height of ONE row of this table — header and body rows alike.
   *
   * Uniform per table so the row-splitting arithmetic stays simple. A measurer
   * with real metrics returns the tallest row, which is conservative: a page
   * fits at most as many rows as it would have, never more.
   */
  tableRow: (block: Extract<DocumentBlock, { kind: 'table' }>) => number;
}

/** The default ruler: measured estimates, no font required. */
export const ESTIMATED_MEASURER: PaginationMeasurer = {
  block: measureBlock,
  termItem: termItemHeight,
  tableRow: () => BLOCK_METRICS.tableRowHeightPt,
};

export class PaginationError extends Error {
  public override readonly name = 'PaginationError';
  public readonly blockKind: string;

  constructor(message: string, blockKind: string) {
    super(message);
    this.blockKind = blockKind;
  }
}

const USABLE_HEIGHT = BODY_BOX.heightPt;

/**
 * How many table body rows fit in the space left, given the header must come
 * with them. Returns 0 when not even the header plus one row fits.
 */
function rowsThatFit(available: number, rowHeight: number): number {
  const withHeader = available - rowHeight;

  if (withHeader < rowHeight) return 0;
  return Math.floor(withHeader / rowHeight);
}

/**
 * Lay the model out into pages.
 *
 * Rules, all from §12.3:
 * - a table header is never the last thing on a page;
 * - a table's body rows may split, and the header repeats;
 * - the terms list may split BETWEEN items, never within one;
 * - the signature block is atomic and moves whole.
 */
export function paginate(
  model: DocumentModel,
  measurer: PaginationMeasurer = ESTIMATED_MEASURER,
): DocumentPage[] {
  const pages: DocumentPage[] = [];

  let current: PlacedBlock[] = [];
  let used = 0;

  const flush = (): void => {
    if (current.length > 0) {
      pages.push({ pageNumber: pages.length + 1, blocks: current });
      current = [];
      used = 0;
    }
    if (pages.length > PAGINATION.maxPages) {
      throw new PaginationError(
        `The document exceeded ${String(PAGINATION.maxPages)} pages. This usually means a malformed quotation rather than a genuinely long one.`,
        'document',
      );
    }
  };

  const place = (block: DocumentBlock, height: number, options: Partial<PlacedBlock> = {}): void => {
    current.push({
      block,
      heightPt: height,
      isContinuation: options.isContinuation ?? false,
      startNumber: options.startNumber ?? 1,
    });
    used += height;
  };

  const remaining = (): number => USABLE_HEIGHT - used;

  for (const block of model.blocks) {
    const height = measurer.block(block);

    /* Atomic blocks ------------------------------------------------------- */

    const isAtomic =
      block.kind === 'signature' ||
      block.kind === 'meta' ||
      block.kind === 'heading' ||
      block.kind === 'summaryLine' ||
      block.kind === 'totals';

    if (isAtomic) {
      if (height > USABLE_HEIGHT) {
        // A single block taller than a page can never be placed. Say which one,
        // rather than emitting a clipped document.
        throw new PaginationError(
          `A "${block.kind}" block is ${Math.round(height)} pt tall and cannot fit on a page (${Math.round(USABLE_HEIGHT)} pt). The quotation cannot be laid out.`,
          block.kind,
        );
      }
      if (height > remaining()) flush();
      place(block, height);
      continue;
    }

    /* Tables — split body rows, repeat the header ------------------------- */

    if (block.kind === 'table') {
      let offset = 0;
      const rowHeight = measurer.tableRow(block);

      while (offset < block.rows.length) {
        let capacity = rowsThatFit(remaining(), rowHeight);

        if (capacity === 0) {
          flush();
          capacity = rowsThatFit(remaining(), rowHeight);

          if (capacity === 0) {
            throw new PaginationError(
              `The ${block.category} table cannot fit a header and one row on a page.`,
              'table',
            );
          }
        }

        const slice = block.rows.slice(offset, offset + capacity);
        const partial: DocumentBlock = { ...block, rows: slice };

        place(partial, (slice.length + 1) * rowHeight, {
          isContinuation: offset > 0,
        });

        offset += slice.length;
      }
      continue;
    }

    /* Terms — split between items, never within one ----------------------- */

    if (block.kind === 'termsList') {
      let offset = 0;

      while (offset < block.items.length) {
        const slice: TermItem[] = [];
        let sliceHeight = 0;

        while (offset + slice.length < block.items.length) {
          const item = block.items[offset + slice.length];
          if (item === undefined) break;

          const itemHeight = measurer.termItem(item);

          if (itemHeight > USABLE_HEIGHT) {
            throw new PaginationError(
              `The term "${item.title}" is too long to fit on a page.`,
              'termsList',
            );
          }
          if (sliceHeight + itemHeight > remaining()) break;

          slice.push(item);
          sliceHeight += itemHeight;
        }

        if (slice.length === 0) {
          flush();
          continue;
        }

        place({ ...block, items: slice }, sliceHeight, {
          isContinuation: offset > 0,
          startNumber: offset + 1,
        });
        offset += slice.length;
      }
      continue;
    }

    /* Paragraphs and the closing — may split, but keep it simple ---------- */

    if (height > remaining() && height <= USABLE_HEIGHT) flush();

    if (height > USABLE_HEIGHT) {
      throw new PaginationError(
        `A "${block.kind}" block is too long to fit on a page.`,
        block.kind,
      );
    }

    place(block, height);
  }

  flush();

  return pages.length > 0 ? pages : [{ pageNumber: 1, blocks: [] }];
}

/* -------------------------------------------------------------------------- */
/* Seal / text overlap (PRD §25)                                              */
/* -------------------------------------------------------------------------- */

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

/**
 * The rect the seal occupies, and the rect the signature details occupy.
 *
 * PRD §25 requires the seal not to overlap text. In the approved layout the
 * details run down the left from x 34 and the seal sits at x 373.7, so they do
 * not — but that is a property of the measured constants, and a future edit to
 * either could silently break it. A test asserts non-overlap numerically.
 */
export function signatureRects(lineCount: number): { seal: Rect; details: Rect; signature: Rect } {
  const detailsHeight = Math.max(1, lineCount) * SIGNATURE_BLOCK.detailsLinePitchPt;

  return {
    seal: { ...SIGNATURE_BLOCK.sealRect },
    signature: { ...SIGNATURE_BLOCK.signatureRect },
    details: {
      x0: SIGNATURE_BLOCK.detailsXPt,
      y0: SIGNATURE_BLOCK.detailsFirstLineYPt - BLOCK_METRICS.lineHeightPt,
      // The widest of the six lines, bounded by where the seal begins. Using the
      // seal's left edge as the limit is what makes the guarantee structural
      // rather than dependent on how long someone's job title is.
      x1: SIGNATURE_BLOCK.sealRect.x0 - TABLE.cellPaddingPt,
      y1: SIGNATURE_BLOCK.detailsFirstLineYPt + detailsHeight,
    },
  };
}
