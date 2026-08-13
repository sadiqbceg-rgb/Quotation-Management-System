/**
 * The letterhead's text, for reproducing it as a Word header and footer.
 *
 * ---------------------------------------------------------------------------
 * PROVENANCE
 * ---------------------------------------------------------------------------
 * Every string here is TRANSCRIBED from `reference/letterhead.pdf` — the
 * company's own artwork — by extracting its text content. None of it is
 * invented, and PRD §34's no-dummy-data rule does not apply to it.
 *
 * The PDF renderer never needs any of this: it embeds the artwork itself. The
 * DOCX cannot embed a PDF page, so Word's header and footer have to be rebuilt
 * from the same content. This module is that content, in one place, so the two
 * outputs describe the same company.
 *
 * ---------------------------------------------------------------------------
 * THE ARABIC
 * ---------------------------------------------------------------------------
 * `companyNameArabic` and `crLineArabic` are the ONLY Arabic this system emits.
 * They are fixed strings, never user content, written in LOGICAL order — Word
 * performs the bidirectional reordering and the glyph shaping, which is exactly
 * why the PDF renderer avoids Arabic altogether (§13.2) and this one can afford
 * not to.
 *
 * They are transcribed from the letterhead's extracted text. The extraction
 * yields presentation forms in visual order, so the logical strings below were
 * reconstructed from them. **They have not been visually verified in Microsoft
 * Word** — see the Phase 09 report. Verify before go-live; a wrong company name
 * in Arabic on a client's quotation is not a cosmetic defect.
 */

/** Latin company name, as printed in `#d4292e` at 20 pt bold. */
export const LETTERHEAD_COMPANY_NAME = 'SPEED FALCON COMPANY';

/** Arabic company name. Logical order; Word shapes and reorders it. */
export const LETTERHEAD_COMPANY_NAME_ARABIC = 'شركة سبيد فالكون';

/** Commercial registration, Latin. */
export const LETTERHEAD_CR_LINE = 'C.R. 7050577670';

/** Commercial registration, Arabic. Logical order. */
export const LETTERHEAD_CR_LINE_ARABIC = 'س.ت.: ٧٠٥٠٥٧٧٦٧٠';

/**
 * The footer's three columns, exactly as the letterhead prints them.
 *
 * First line of each is a bold label; the rest is the body.
 */
export const LETTERHEAD_FOOTER_COLUMNS: ReadonlyArray<{
  label: string;
  lines: readonly string[];
}> = [
  { label: 'Head Office', lines: ['Makkah Street', 'Al Jubail', 'Kingdom of Saudi Arabia'] },
  {
    label: 'Branch Office',
    lines: ['Al Murabba District', 'Riyadh', 'Kingdom of Saudi Arabia'],
  },
  {
    label: '',
    lines: ['Mob.: +966 57 853 2985', 'Email: info@speedxksa.com', 'Website: www.speedxksa.com'],
  },
];

/**
 * An Arabic-capable font stack for the two Arabic runs.
 *
 * The letterhead sets its Arabic in Tajawal-Bold. Tajawal is not installed by
 * default on Windows, so Word falls back — naming a stack lets it pick the
 * first available rather than substituting something arbitrary. Nothing is
 * embedded; the DOCX carries no fonts (§14.3).
 */
export const ARABIC_FONT = 'Tajawal';
export const ARABIC_FONT_FALLBACK = 'Arial';
