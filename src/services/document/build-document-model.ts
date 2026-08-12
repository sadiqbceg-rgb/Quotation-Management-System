/**
 * `buildDocumentModel` — the single place document structure is decided.
 *
 * See IMPLEMENTATION_PLAN.md §12.1 and §12.2.
 *
 * ---------------------------------------------------------------------------
 * PURE, BY CONSTRUCTION
 * ---------------------------------------------------------------------------
 * No `Date.now()`, no `Math.random()`, no I/O, no reads of module-level mutable
 * state. Same input, same output, forever.
 *
 * That is not stylistic. Three renderers consume this model, and a document is
 * a legal offer to a client; if the function could return two different shapes
 * for the same quotation, the PDF and the Word file could disagree about what
 * was offered and neither would be provably wrong. Purity is also what lets a
 * test assert the full structure without a browser, a font, or a network.
 *
 * Section numbers are POSITIONAL — assigned as sections are appended — so
 * omitting an optional section renumbers the rest correctly rather than leaving
 * a gap.
 */

import { ITEM_CATEGORIES, type ItemCategory, type PricingMode, type Totals } from '@shared/types';
import { isValidQuotationNumber, toFileSafe } from '@shared/numbering';
import { SECTION_TITLES } from '@/config/document-layout';
import type { DocumentBlock, DocumentModel, ImageRef, TermItem } from './document-model.types';
import {
  buildCategorySection,
  buildClosingBlock,
  buildMetaBlock,
  buildSignatureBlock,
  buildTermsList,
  buildTotalsBlock,
  type DocumentLine,
} from './section-builders';

export interface DocumentAssets {
  seal: ImageRef;
  signature: ImageRef;
}

export interface DocumentSignatory {
  name: string;
  designation: string;
  companyName: string;
  country: string;
  phone: string;
  email: string;
}

export interface BuildDocumentInput {
  quotationNumber: string;
  quotationDate: string;
  quotationFor: string;
  pricingMode: PricingMode;
  /** The "1. Scope of Work" intro paragraph (§26 UR-08). */
  scopeOfWork: string;
  client: {
    clientName: string;
    companyName: string;
    address: string;
    contactPerson: string;
  };
  lines: readonly DocumentLine[];
  totals: Totals;
  terms: readonly TermItem[];
  closingParagraph: string;
  /** Null on a draft with no signatory chosen yet. */
  signatory: DocumentSignatory | null;
  assets: DocumentAssets;
  /** §26 UR-07. The approved document has none. */
  showPageNumbers?: boolean;
}

/**
 * PRD §17: the Remarks column appears only if at least one item has a remark.
 *
 * Decided here, once, for the WHOLE quotation rather than per table — otherwise
 * two category tables on the same page would have different column counts,
 * which the approved layout never does.
 */
export function resolveShowRemarksColumn(lines: readonly DocumentLine[]): boolean {
  return lines.some((line) => line.remarks.trim().length > 0);
}

/** The categories actually used, in PRD order rather than insertion order. */
function usedCategories(lines: readonly DocumentLine[]): ItemCategory[] {
  return ITEM_CATEGORIES.filter((category) => lines.some((line) => line.category === category));
}

export function buildDocumentModel(input: BuildDocumentInput): DocumentModel {
  const blocks: DocumentBlock[] = [];
  const showRemarksColumn = resolveShowRemarksColumn(input.lines);

  /** Positional section numbering — see the header comment. */
  let sectionNumber = 0;
  const nextSection = (text: string): DocumentBlock => {
    sectionNumber += 1;
    return { kind: 'heading', number: sectionNumber, text };
  };

  /* 1. Meta block ---------------------------------------------------------- */

  blocks.push(
    buildMetaBlock({
      quotationFor: input.quotationFor,
      quotationNumber: input.quotationNumber,
      quotationDate: input.quotationDate,
      contactPerson: input.client.contactPerson,
      clientCompanyName: input.client.companyName,
      clientAddress: input.client.address,
    }),
  );

  /* 2. Scope of Work ------------------------------------------------------- */

  const categories = usedCategories(input.lines);

  if (categories.length > 0) {
    blocks.push(nextSection(SECTION_TITLES.scopeOfWork));

    const intro = input.scopeOfWork.trim();
    if (intro.length > 0) blocks.push({ kind: 'paragraph', text: intro });

    for (const category of categories) {
      const section = buildCategorySection(
        category,
        input.lines.filter((line) => line.category === category),
        input.pricingMode,
        showRemarksColumn,
      );

      blocks.push(section.table);
      if (section.summary !== null) blocks.push(section.summary);
    }

    /* 3. Totals — amount mode only ---------------------------------------- */

    const totals = buildTotalsBlock(input.totals, input.pricingMode);
    if (totals !== null) blocks.push(totals);
  }

  /* 4. Terms & Conditions -------------------------------------------------- */

  const terms = buildTermsList(input.terms);
  if (terms !== null) {
    blocks.push(nextSection(SECTION_TITLES.termsAndConditions));
    blocks.push(terms);
  }

  /* 5. Closing ------------------------------------------------------------- */

  const closing = buildClosingBlock(input.closingParagraph);
  if (closing !== null) blocks.push(closing);

  /* 6. Signature ----------------------------------------------------------- */

  if (input.signatory !== null) {
    blocks.push(
      buildSignatureBlock({
        ...input.signatory,
        sealImage: input.assets.seal,
        signatureImage: input.assets.signature,
      }),
    );
  }

  const trimmedNumber = input.quotationNumber.trim();

  return {
    pageSize: 'A4',
    quotationNumber: trimmedNumber,
    /*
     * Empty for a draft, and empty for anything that is not a valid quotation
     * number. This string names Drive folders and files (§7.4), so deriving one
     * from malformed input would create a folder nothing can ever find again —
     * better to have none than a wrong one.
     */
    fileSafeNumber: isValidQuotationNumber(trimmedNumber) ? toFileSafe(trimmedNumber) : '',
    blocks,
    showRemarksColumn,
    pricingMode: input.pricingMode,
    showPageNumbers: input.showPageNumbers ?? false,
  };
}

/* -------------------------------------------------------------------------- */
/* Structural assertions                                                      */
/* -------------------------------------------------------------------------- */

export interface ModelStructureProblem {
  code:
    | 'META_NOT_FIRST'
    | 'META_COUNT'
    | 'TABLE_WITHOUT_HEADER'
    | 'SIGNATURE_COUNT'
    | 'SIGNATURE_NOT_LAST'
    | 'HEADING_NUMBERING'
    | 'EMPTY';
  message: string;
}

/**
 * Check that a model is well-formed.
 *
 * Cheap, and it catches a class of bug that is otherwise only visible in a
 * finished PDF: a missing table header, two signature blocks, headings numbered
 * 1 then 3. A renderer would happily draw all three.
 */
export function checkModelStructure(model: DocumentModel): ModelStructureProblem[] {
  const problems: ModelStructureProblem[] = [];

  if (model.blocks.length === 0) {
    return [{ code: 'EMPTY', message: 'The document has no content.' }];
  }

  const metaBlocks = model.blocks.filter((block) => block.kind === 'meta');
  if (metaBlocks.length !== 1) {
    problems.push({
      code: 'META_COUNT',
      message: `Expected exactly one meta block, found ${String(metaBlocks.length)}.`,
    });
  }
  if (model.blocks[0]?.kind !== 'meta') {
    problems.push({
      code: 'META_NOT_FIRST',
      message: 'The meta block must be the first block in the document.',
    });
  }

  for (const block of model.blocks) {
    if (block.kind === 'table' && block.columns.length === 0) {
      problems.push({
        code: 'TABLE_WITHOUT_HEADER',
        message: `The ${block.category} table has no columns.`,
      });
    }
  }

  const signatureIndexes = model.blocks
    .map((block, index) => (block.kind === 'signature' ? index : -1))
    .filter((index) => index !== -1);

  if (signatureIndexes.length > 1) {
    problems.push({
      code: 'SIGNATURE_COUNT',
      message: `Expected at most one signature block, found ${String(signatureIndexes.length)}.`,
    });
  }
  if (signatureIndexes.length === 1 && signatureIndexes[0] !== model.blocks.length - 1) {
    problems.push({
      code: 'SIGNATURE_NOT_LAST',
      message: 'The signature block must be the last block in the document.',
    });
  }

  const headingNumbers = model.blocks
    .filter((block) => block.kind === 'heading')
    .map((block) => block.number);

  const expected = headingNumbers.map((_value, index) => index + 1);
  if (headingNumbers.join(',') !== expected.join(',')) {
    problems.push({
      code: 'HEADING_NUMBERING',
      message: `Section numbers must be consecutive from 1; found ${headingNumbers.join(', ')}.`,
    });
  }

  return problems;
}
