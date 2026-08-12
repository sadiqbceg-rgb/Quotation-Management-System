/**
 * The individual document sections.
 *
 * Each function is pure and returns blocks. `build-document-model.ts` composes
 * them in the order the approved quotation prints them (§12.2).
 *
 * Splitting them out keeps each section testable on its own and keeps the
 * composer readable as a table of contents rather than a wall of logic.
 */

import { formatBasisPoints, formatQuantity, formatSar, milli, type Halalas, type Milli } from '@shared/money';
import { ITEM_CATEGORIES, type ItemCategory, type PricingMode, type Totals } from '@shared/types';
import { META_LABELS, DRAFT_NUMBER_PLACEHOLDER } from '@/config/document-layout';
import { formatDisplayDate } from '@/utils/format-date';
import type {
  ColumnSpec,
  DocumentBlock,
  ImageRef,
  MetaRow,
  TermItem,
  TotalsLine,
} from './document-model.types';

/* -------------------------------------------------------------------------- */
/* Meta block                                                                 */
/* -------------------------------------------------------------------------- */

export interface MetaInput {
  quotationFor: string;
  quotationNumber: string;
  quotationDate: string;
  contactPerson: string;
  clientCompanyName: string;
  clientAddress: string;
}

/**
 * The meta block, in the approved document's label order.
 *
 * A row with no value is OMITTED rather than printed empty: the reference has
 * no blank labels, and `Attention:` followed by nothing looks like a mistake in
 * a document a client is reading.
 *
 * The number is the one exception — a draft prints an explicit placeholder,
 * because a missing quotation number is a fact the user needs to see rather
 * than a gap (PRD §35).
 */
export function buildMetaBlock(input: MetaInput): DocumentBlock {
  const rows: MetaRow[] = [];

  const push = (label: string, value: string): void => {
    if (value.trim().length > 0) rows.push({ label, value: value.trim() });
  };

  push(META_LABELS.quotationFor, input.quotationFor);

  rows.push({
    label: META_LABELS.quotationNumber,
    value:
      input.quotationNumber.trim().length > 0
        ? input.quotationNumber.trim()
        : DRAFT_NUMBER_PLACEHOLDER,
  });

  push(META_LABELS.date, formatDisplayDate(input.quotationDate));
  push(META_LABELS.attention, input.contactPerson);
  push(META_LABELS.client, input.clientCompanyName);
  // Not in the approved document; required by PRD §12. See §26 UR-06.
  push(META_LABELS.address, input.clientAddress);

  return { kind: 'meta', rows };
}

/* -------------------------------------------------------------------------- */
/* Item tables                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The first column heading per category, from PRD §14–§16.
 *
 * The approved quotation's manpower table heads this column "Designation", not
 * "Description" — the wording is category-specific and comes from the PRD.
 */
const DESCRIPTION_HEADERS: Readonly<Record<ItemCategory, string>> = {
  Manpower: 'Designation',
  Equipment: 'Equipment Description',
  Materials: 'Material Description',
};

/** The unit of a category's quantity, for the summary line. */
const SUMMARY_NOUNS: Readonly<Record<ItemCategory, string>> = {
  Manpower: 'Persons',
  Equipment: 'Units',
  Materials: 'Items',
};

export interface DocumentLine {
  category: ItemCategory;
  description: string;
  /** Integer thousandths, exactly as stored. Never a re-parsed decimal. */
  quantity: Milli;
  unit: string;
  unitPrice: Halalas;
  amount: Halalas;
  remarks: string;
}

/**
 * Column layout for a category table.
 *
 * `Amount` appears only in `amount` mode; `Remarks` only when some item in the
 * whole quotation carries one (PRD §17). Both decisions are made ONCE, by the
 * model, so no renderer can reach a different answer.
 *
 * Widths are ratios rather than points because the table is page-centred at a
 * fixed width (§2.4) — the renderer owns the absolute measurement.
 */
export function buildColumns(
  category: ItemCategory,
  pricingMode: PricingMode,
  showRemarksColumn: boolean,
): ColumnSpec[] {
  const columns: ColumnSpec[] = [
    { key: 'description', header: DESCRIPTION_HEADERS[category], widthRatio: 0, align: 'left' },
    { key: 'quantity', header: 'Quantity', widthRatio: 0, align: 'center' },
    { key: 'unit', header: 'Unit', widthRatio: 0, align: 'center' },
    { key: 'unitPrice', header: 'Unit Price', widthRatio: 0, align: 'right' },
  ];

  if (pricingMode === 'amount') {
    columns.push({ key: 'amount', header: 'Amount', widthRatio: 0, align: 'right' });
  }
  if (showRemarksColumn) {
    columns.push({ key: 'remarks', header: 'Remarks', widthRatio: 0, align: 'left' });
  }

  /*
   * The description column takes twice the share of any other, matching the
   * approved table where it is by far the widest (191.2 of 453.9 pt across
   * three columns). Everything else divides the remainder evenly.
   */
  const DESCRIPTION_WEIGHT = 2;
  const totalWeight = DESCRIPTION_WEIGHT + (columns.length - 1);

  return columns.map((column, index) => ({
    ...column,
    widthRatio: (index === 0 ? DESCRIPTION_WEIGHT : 1) / totalWeight,
  }));
}

function cellsFor(
  line: DocumentLine,
  pricingMode: PricingMode,
  showRemarksColumn: boolean,
): string[] {
  const cells = [
    line.description,
    formatQuantity(line.quantity),
    line.unit,
    formatSar(line.unitPrice),
  ];

  if (pricingMode === 'amount') cells.push(formatSar(line.amount));
  if (showRemarksColumn) cells.push(line.remarks);

  return cells;
}

export interface CategorySection {
  table: DocumentBlock;
  summary: DocumentBlock | null;
}

/**
 * One category's table, plus its summary line.
 *
 * The summary reproduces `Total Manpower: 41 Persons` from the approved
 * document. It is omitted when the category has no whole quantity to report,
 * rather than printing "Total Manpower: 0 Persons".
 */
export function buildCategorySection(
  category: ItemCategory,
  lines: readonly DocumentLine[],
  pricingMode: PricingMode,
  showRemarksColumn: boolean,
): CategorySection {
  const table: DocumentBlock = {
    kind: 'table',
    category,
    columns: buildColumns(category, pricingMode, showRemarksColumn),
    rows: lines.map((line) => cellsFor(line, pricingMode, showRemarksColumn)),
    repeatHeader: true,
  };

  const quantityTotal = milli(lines.reduce((total, line) => total + line.quantity, 0));

  const summary: DocumentBlock | null =
    quantityTotal > 0
      ? {
          kind: 'summaryLine',
          label: `Total ${category}:`,
          value: `${formatQuantity(quantityTotal)} ${SUMMARY_NOUNS[category]}`,
        }
      : null;

  return { table, summary };
}

/* -------------------------------------------------------------------------- */
/* Totals                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The totals block.
 *
 * Returns null in `rate-only` mode: the approved quotation quotes hourly rates
 * and prints no totals block at all, stating VAT as a term instead (§26 UR-04).
 * Discount lines appear only when a discount was actually applied.
 */
export function buildTotalsBlock(totals: Totals, pricingMode: PricingMode): DocumentBlock | null {
  if (pricingMode !== 'amount') return null;

  const lines: TotalsLine[] = [];

  for (const category of ITEM_CATEGORIES) {
    const subtotal = totals.categorySubtotals[category];
    if (subtotal !== undefined) {
      lines.push({ label: `Total ${category}`, value: formatSar(subtotal) });
    }
  }

  lines.push({ label: 'Subtotal', value: formatSar(totals.subtotal) });

  if (totals.discountAmount > 0) {
    const rate =
      totals.discountRateBasisPoints === undefined
        ? ''
        : ` (${formatBasisPoints(totals.discountRateBasisPoints)})`;
    lines.push({ label: `Discount${rate}`, value: `- ${formatSar(totals.discountAmount)}` });
    lines.push({ label: 'Taxable amount', value: formatSar(totals.taxableBase) });
  }

  lines.push({
    label: `VAT ${formatBasisPoints(totals.vatRateBasisPoints)}`,
    value: formatSar(totals.vatAmount),
  });

  lines.push({
    label: 'Grand Total',
    value: formatSar(totals.grandTotal, { withCurrency: true }),
    emphasis: true,
  });

  return { kind: 'totals', lines };
}

/* -------------------------------------------------------------------------- */
/* Terms                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The numbered terms list.
 *
 * Numbering is POSITIONAL and applied by the renderer from array order, exactly
 * as the approved document does — the model carries no numbers, so a removed
 * term cannot leave a gap in the sequence.
 */
export function buildTermsList(terms: readonly TermItem[]): DocumentBlock | null {
  if (terms.length === 0) return null;

  return {
    kind: 'termsList',
    items: terms.map((term) => ({ title: term.title, body: term.body })),
  };
}

/* -------------------------------------------------------------------------- */
/* Closing                                                                    */
/* -------------------------------------------------------------------------- */

/** Split the stored closing text into paragraphs on blank lines. */
export function buildClosingBlock(closingParagraph: string): DocumentBlock | null {
  const paragraphs = closingParagraph
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

  return paragraphs.length === 0 ? null : { kind: 'closing', paragraphs };
}

/* -------------------------------------------------------------------------- */
/* Signature                                                                  */
/* -------------------------------------------------------------------------- */

export interface SignatureInput {
  name: string;
  designation: string;
  companyName: string;
  country: string;
  phone: string;
  email: string;
  sealImage: ImageRef;
  signatureImage: ImageRef;
}

/**
 * The signature block.
 *
 * Six lines on the left in the approved document's order, the seal above the
 * signature on the right (§2.4). `Mobile :` and `Email:` carry their labels
 * because the reference prints them that way — including the space before the
 * colon on `Mobile :`, which is how the original reads.
 */
export function buildSignatureBlock(input: SignatureInput): DocumentBlock {
  return {
    kind: 'signature',
    left: [
      input.name,
      input.designation,
      input.companyName,
      input.country,
      `Mobile : ${input.phone}`,
      `Email: ${input.email}`,
    ],
    sealImage: input.sealImage,
    signatureImage: input.signatureImage,
    keepTogether: true,
  };
}
