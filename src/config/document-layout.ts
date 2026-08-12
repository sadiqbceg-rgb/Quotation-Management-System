/**
 * Quotation document geometry.
 *
 * Every value below was MEASURED from the company's own documents, not chosen.
 * Sources are cited per constant so a future change can be checked against the
 * originals. See IMPLEMENTATION_PLAN.md §2.4.
 *
 *   reference/quotation-sample.pdf  — the approved 2-page quotation (Word 2021)
 *   reference/letterhead.pdf        — the blank A4 letterhead (Canva, vector)
 *
 * Renderers (HTML preview in Phase 07, PDF in Phase 08, DOCX in Phase 09) must
 * take all geometry from here. No magic numbers in a renderer.
 */

/** PDF points per inch. */
const POINTS_PER_INCH = 72;
/** Word measures in twentieths of a point. */
const TWIPS_PER_POINT = 20;

export const pointsToTwips = (points: number): number => Math.round(points * TWIPS_PER_POINT);
export const pointsToMillimetres = (points: number): number => (points / POINTS_PER_INCH) * 25.4;

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

/** A4. Both reference PDFs measure 595.32 × 841.92 pt; 595.28 × 841.89 is nominal A4. */
export const PAGE = {
  widthPt: 595.28,
  heightPt: 841.89,
  widthTwips: 11906,
  heightTwips: 16838,
} as const;

/**
 * Body text box, measured from the body content of reference/quotation-sample.pdf:
 * text spans x 34.0 → 582.4 and y 111.5 → 743.0 across both pages, with the
 * letterhead footer rule at y 775.6.
 */
export const BODY_BOX = {
  leftPt: 34.0,
  rightPt: 582.4,
  topPt: 111.0,
  bottomPt: 760.0,
  get widthPt(): number {
    return this.rightPt - this.leftPt;
  },
  get heightPt(): number {
    return this.bottomPt - this.topPt;
  },
} as const;

/** The same margins expressed for a Word section. */
export const PAGE_MARGINS_TWIPS = {
  top: pointsToTwips(BODY_BOX.topPt),
  bottom: pointsToTwips(PAGE.heightPt - BODY_BOX.bottomPt),
  left: pointsToTwips(BODY_BOX.leftPt),
  right: pointsToTwips(PAGE.widthPt - BODY_BOX.rightPt),
} as const;

/* -------------------------------------------------------------------------- */
/* Letterhead furniture — reference/letterhead.pdf                            */
/* -------------------------------------------------------------------------- */

export const LETTERHEAD = {
  /** SPEED-X FALCON logo, top left. */
  logoRect: { x0: 13.9, y0: 14.8, x1: 139.2, y1: 83.8 },
  /** Vision 2030 emblem, top right. */
  emblemRect: { x0: 498.3, y0: 2.9, x1: 580.9, y1: 65.9 },
  /** Red rule beneath the header block. */
  headerRule: { x0: 185.0, y0: 66.5, x1: 595.3, y1: 68.0 },
  /** Page-centred watermark (the logo, lightened). */
  watermarkRect: { x0: 148.1, y0: 333.5, x1: 466.2, y1: 508.4 },
  /** Rule above the footer block. */
  footerRule: { x0: 0, y0: 779.4, x1: 595.3, y1: 782.4 },
  /** Left x of each of the three footer columns. */
  footerColumnsX: [13.9, 185.1, 425.4],
  footerTopPt: 792.9,
} as const;

/* -------------------------------------------------------------------------- */
/* Items table — reference/quotation-sample.pdf page 1                        */
/* -------------------------------------------------------------------------- */

/**
 * The approved table spans x 70.7 → 524.6. Its centre (297.65) is the exact
 * page centre, so tables are centred on the PAGE, not on the text box.
 */
export const TABLE = {
  defaultWidthPt: 453.9,
  /** Centre on the page rather than the body box. */
  centredOnPage: true,
  borderWidthPt: 0.5,
  borderColor: '#000000',
  headerBold: true,
  minRowHeightPt: 33.9,
  cellPaddingPt: 4.0,
} as const;

/* -------------------------------------------------------------------------- */
/* Terms list — reference/quotation-sample.pdf pages 1–2                      */
/* -------------------------------------------------------------------------- */

export const TERMS_LIST = {
  numberXPt: 52.0,
  textXPt: 70.0,
  leadingPt: 18.0,
  spaceAfterPt: 7.7,
} as const;

/* -------------------------------------------------------------------------- */
/* Signature block — reference/quotation-sample.pdf page 2                    */
/* -------------------------------------------------------------------------- */

/**
 * The approved layout puts the person's details on the LEFT and both the seal
 * (upper) and the signature image (lower) on the RIGHT. PRD §25 describes it
 * differently; the approved document is authoritative, and PRD §25's binding
 * requirement — the seal on the right — is satisfied. See §26 UR-05.
 */
export const SIGNATURE_BLOCK = {
  detailsXPt: 34.0,
  detailsFirstLineYPt: 578.8,
  detailsLinePitchPt: 25.6,
  sealRect: { x0: 373.7, y0: 550.9, x1: 492.7, y1: 659.7 },
  signatureRect: { x0: 392.8, y0: 676.1, x1: 463.0, y1: 733.6 },
  signatureLabelXPt: 495.0,
  signatureLabelYPt: 716.0,
  /** Total height reserved so the block is never split across pages. */
  get reservedHeightPt(): number {
    return this.signatureRect.y1 - this.sealRect.y0;
  },
} as const;

/* -------------------------------------------------------------------------- */
/* Typography — reference/quotation-sample.pdf                                */
/* -------------------------------------------------------------------------- */

/**
 * The approved document is set in Calibri. Calibri is not redistributable, so
 * the PDF embeds Carlito (SIL OFL), which is metric-compatible — line breaks and
 * column fits match, so the PDF and the DOCX paginate identically. The DOCX
 * requests Calibri by name and falls back to Carlito. See §13.3 and §14.3.
 */
export const TYPOGRAPHY = {
  bodyFamily: 'Calibri',
  bodyFallbackFamily: 'Carlito',
  bodySizePt: 14,
  bodyLeadingPt: 18.0,
  paragraphSpaceAfterPt: 7.7,
  headingSizePt: 14,
  headingBold: true,
  companyNameSizePt: 20,
  crLineSizePt: 12,
  footerLabelSizePt: 11,
  footerBodySizePt: 10,
} as const;

/* -------------------------------------------------------------------------- */
/* Brand colours — sampled from the reference documents                       */
/* -------------------------------------------------------------------------- */

export const COLORS = {
  /** "SPEED FALCON COMPANY" and the header rule. */
  brandRed: '#d4292e',
  /** Company name in the signature block. */
  navy: '#002060',
  /** Hyperlinked email in the signature block. */
  linkBlue: '#0563c1',
  /** Footer rule. */
  footerAmber: '#ffbd59',
  text: '#000000',
} as const;

/* -------------------------------------------------------------------------- */
/* Pagination policy (§12.3) — consumed identically by every renderer         */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* Letterhead source geometry — measured from reference/letterhead.pdf         */
/* -------------------------------------------------------------------------- */

/**
 * The letterhead PDF's own page box, reported by the asset pipeline.
 *
 * It does NOT match the quotation. The letterhead's MediaBox is
 * `0 7.83 595.5 850.08` — 595.5 × 842.25 pt with a y origin of 7.83 — while
 * `quotation-sample.pdf` is `0 0 595.32 841.92`.
 *
 * Anything embedding the letterhead as a background has to normalise that
 * offset, or every piece of furniture lands 7.8 pt from where the measurements
 * in §2.4 say it is. Recorded here so Phase 08 cannot miss it.
 */
export const LETTERHEAD_SOURCE = {
  mediaBox: { x0: 0, y0: 7.8299813, x1: 595.5, y1: 850.07996 },
  get widthPt(): number {
    return this.mediaBox.x1 - this.mediaBox.x0;
  },
  get heightPt(): number {
    return this.mediaBox.y1 - this.mediaBox.y0;
  },
  /** Subtract this from a letterhead y to reach quotation coordinates. */
  get yOffsetPt(): number {
    return this.mediaBox.y0;
  },
  pageCount: 1,
  previewDpi: 150,
} as const;

/* -------------------------------------------------------------------------- */
/* Meta block — reference/quotation-sample.pdf page 1                         */
/* -------------------------------------------------------------------------- */

/**
 * The meta-block labels, in the order the approved document prints them.
 *
 * `Address:` is not in the approved document, but PRD §12 makes the client
 * address a required field. It is emitted last so the reference's own order is
 * preserved above it. See §26 UR-06 — the company has not yet said whether it
 * should print at all.
 */
export const META_LABELS = {
  quotationFor: 'Quotation For:',
  quotationNumber: 'Quotation No.:',
  date: 'Date:',
  attention: 'Attention:',
  client: 'Client:',
  address: 'Address:',
} as const;

/** Shown in place of a number until the backend issues one (PRD §35). */
export const DRAFT_NUMBER_PLACEHOLDER = 'Will be assigned on save';

/* -------------------------------------------------------------------------- */
/* Section headings — reference/quotation-sample.pdf                          */
/* -------------------------------------------------------------------------- */

/**
 * Heading text. The NUMBERS are positional, assigned while building the model,
 * so omitting an optional section renumbers the rest correctly.
 */
export const SECTION_TITLES = {
  scopeOfWork: 'Scope of Work',
  termsAndConditions: 'General Terms & Conditions',
} as const;

/* -------------------------------------------------------------------------- */
/* Generated assets — produced by scripts/prepare-assets.ts                   */
/* -------------------------------------------------------------------------- */

export const GENERATED_ASSETS = {
  letterheadPdf: 'letterhead.pdf',
  letterheadPreview: `letterhead-preview@${String(LETTERHEAD_SOURCE.previewDpi)}dpi.png`,
  logo: 'logo.jpg',
  logoWatermark: 'logo-watermark.png',
  seal: 'seal-transparent.png',
  manifest: 'manifest.json',
} as const;

export const PAGINATION = {
  /** A table header must never be the last thing on a page. */
  keepTableHeaderWithFirstRow: true,
  /** Table headers repeat on continuation pages (PRD §27). */
  repeatTableHeaders: true,
  /** The signature block moves whole rather than splitting. */
  signatureBlockAtomic: true,
  /** A single term item is never split across pages. */
  keepTermItemTogether: true,
  /** The approved document has no page numbers; a setting can enable them (§26 UR-07). */
  showPageNumbersByDefault: false,
  /** Guard against a malformed model producing a runaway document (§13). */
  maxPages: 200,
} as const;

/* -------------------------------------------------------------------------- */
/* Block heights, for pagination                                              */
/* -------------------------------------------------------------------------- */

/**
 * How tall each block is, in points.
 *
 * These are ESTIMATES from the measured typography, not a text-shaping engine.
 * The preview, the PDF and the DOCX share them so all three break pages in the
 * same place — a shared approximation keeps the three outputs consistent with
 * each other, which matters more here than any one of them being exact.
 *
 * `charsPerLine` is derived from the measured body width and Calibri's average
 * advance at 14 pt (≈ 6.4 pt), so wrapping is estimated rather than guessed.
 */
export const BLOCK_METRICS = {
  averageCharWidthPt: 6.4,
  get charsPerLine(): number {
    return Math.floor(BODY_BOX.widthPt / this.averageCharWidthPt);
  },
  /** One line of body text plus its share of paragraph spacing. */
  lineHeightPt: TYPOGRAPHY.bodyLeadingPt,
  paragraphSpaceAfterPt: TYPOGRAPHY.paragraphSpaceAfterPt,
  /** A numbered section heading, including the space beneath it. */
  headingHeightPt: TYPOGRAPHY.bodyLeadingPt + TYPOGRAPHY.paragraphSpaceAfterPt,
  /** One meta row. */
  metaRowHeightPt: TYPOGRAPHY.bodyLeadingPt,
  /** A table header row and a body row, both measured at 33.9 pt (§2.4). */
  tableRowHeightPt: TABLE.minRowHeightPt,
  /** One totals line. */
  totalsLineHeightPt: TYPOGRAPHY.bodyLeadingPt,
  /** Term list item pitch, before wrapping is added. */
  termItemBaseHeightPt: TERMS_LIST.leadingPt + TERMS_LIST.spaceAfterPt,
  /** Chars per line inside a term item, which is indented to x 70 (§2.4). */
  get termCharsPerLine(): number {
    return Math.floor((BODY_BOX.rightPt - TERMS_LIST.textXPt) / this.averageCharWidthPt);
  },
} as const;
