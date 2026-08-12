/**
 * The quotation document model.
 *
 * See IMPLEMENTATION_PLAN.md §12.1.
 *
 * ---------------------------------------------------------------------------
 * ONE MODEL, THREE RENDERERS
 * ---------------------------------------------------------------------------
 * The HTML preview (Phase 07), the PDF (08) and the DOCX (09) all render THIS.
 * None of them re-derives structure, section order, or which columns appear.
 * Three renderers each deciding for themselves is how the PDF and the Word file
 * end up disagreeing about a document that has already gone to a client.
 *
 * The model is layout-AGNOSTIC: it describes blocks and constraints, never
 * coordinates. Coordinates live in `src/config/document-layout.ts` and are
 * applied at render time, so a measurement is declared exactly once.
 *
 * Every text field is PLAIN TEXT. Nothing here is HTML, and no renderer may
 * treat it as such.
 */

import type { ItemCategory, PricingMode } from '@shared/types';

/* -------------------------------------------------------------------------- */
/* Leaf types                                                                 */
/* -------------------------------------------------------------------------- */

export type CellAlign = 'left' | 'right' | 'center';

export interface ColumnSpec {
  key: string;
  header: string;
  /** Share of the table width. The three shares always sum to 1. */
  widthRatio: number;
  align: CellAlign;
}

/**
 * A reference to a generated asset.
 *
 * A `src` the renderer resolves, plus the intrinsic size, so a renderer can
 * preserve the aspect ratio inside its target rect without loading the image
 * first. `alt` exists because the preview is a web page and the image needs an
 * accessible name.
 */
export interface ImageRef {
  src: string;
  alt: string;
  intrinsicWidth: number;
  intrinsicHeight: number;
}

export interface MetaRow {
  label: string;
  value: string;
}

export interface TotalsLine {
  label: string;
  value: string;
  /** The grand total. Rendered heavier than the lines above it. */
  emphasis?: boolean;
}

export interface TermItem {
  title: string;
  body: string;
}

/* -------------------------------------------------------------------------- */
/* Blocks                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A block of the document, in reading order.
 *
 * A discriminated union on `kind`, so a renderer that forgets a variant is a
 * compile error rather than a silently missing section. Every renderer switches
 * exhaustively with a `never` default.
 */
export type DocumentBlock =
  | { kind: 'meta'; rows: MetaRow[] }
  | { kind: 'heading'; number: number; text: string }
  | { kind: 'paragraph'; text: string; bold?: boolean }
  | {
      kind: 'table';
      category: ItemCategory;
      columns: ColumnSpec[];
      rows: string[][];
      /** PRD §27: the header repeats when a table crosses a page. */
      repeatHeader: true;
    }
  | { kind: 'summaryLine'; label: string; value: string }
  | { kind: 'totals'; lines: TotalsLine[] }
  | { kind: 'termsList'; items: TermItem[] }
  | { kind: 'closing'; paragraphs: string[] }
  | {
      kind: 'signature';
      /** The six printed lines, top to bottom, exactly as measured (§2.4). */
      left: string[];
      sealImage: ImageRef;
      signatureImage: ImageRef;
      /** Never split across a page — it moves whole (§12.3). */
      keepTogether: true;
    };

export type BlockKind = DocumentBlock['kind'];

export interface DocumentModel {
  pageSize: 'A4';
  /** Canonical `SFC/RUH/QTN/YYYY/###`, or empty while the quotation is a draft. */
  quotationNumber: string;
  /** `SFC-RUH-QTN-YYYY-###`, for Drive folders and filenames. Empty for a draft. */
  fileSafeNumber: string;
  blocks: DocumentBlock[];
  /** PRD §17. Resolved ONCE here; never re-evaluated per renderer. */
  showRemarksColumn: boolean;
  pricingMode: PricingMode;
  /** §26 UR-07: the approved document has none. Off unless a setting enables it. */
  showPageNumbers: boolean;
}

/* -------------------------------------------------------------------------- */
/* Exhaustiveness                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Fail on an unhandled block kind.
 *
 * Called from the `default` arm of a renderer's switch. If a block kind is
 * added later and a renderer is not updated, this stops compiling — which is
 * the entire point of the union.
 */
export function assertNeverBlock(block: never): never {
  throw new Error(
    `Unhandled document block: ${JSON.stringify(block satisfies never)}. Every renderer must handle every block kind.`,
  );
}
