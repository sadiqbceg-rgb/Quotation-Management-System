/**
 * One quotation, walked from reservation to archive, asserting that the number
 * the backend issued is the number that appears everywhere.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * Every module in the chain has its own tests, and every one of them passes
 * while using its own quotation number. That is exactly the gap this closes:
 * IMPLEMENTATION_PLAN.md §7.8 and §20.2 require that ONE issued number reaches
 * the PDF body, the DOCX body, the Sheets `Quotation No.` cell, the Drive
 * folder name and both filenames — and no per-module test can see more than one
 * of those at a time.
 *
 * Nothing here is hand-written. The number comes from the real reserver, the
 * PDF and the DOCX are really generated and really re-parsed, and the Drive and
 * Sheets writes go through the real Apps Script handlers against the in-memory
 * fakes. If any link in that chain starts formatting the number differently,
 * this fails.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';

import { DEFAULT_QUOTATION_CODES, toFileSafe } from '@shared/numbering';
import { documentFileName, quotationFolderSegments } from '@shared/drive-paths';
import {
  installGasFakes,
  type GasEnvironment,
} from '../../../google-apps-script/src/__fixtures__/gas-fakes';
import { TEST_ONLY_documentBase64 } from '../../../google-apps-script/src/__fixtures__/document-fixtures';
import { reserveQuotationNumber } from '../../../google-apps-script/src/quotation-number/reserve';
import { storeQuotationDocuments } from '../../../google-apps-script/src/drive/quotation-storage';
import { validateDocumentUpload } from '../../../google-apps-script/src/validation/document-validator';
import { recordQuotationTracking } from '../../../google-apps-script/src/quotation/tracking';
import {
  QUOTATION_HEADERS,
  QUOTATIONS_SHEET_NAME,
} from '../../../google-apps-script/src/sheets/quotations-sheet';

import { TEST_ONLY_model } from '@/services/pdf/__fixtures__/pdf-test-model';
import { TEST_ONLY_pdfAssets } from '@/services/pdf/__fixtures__/pdf-test-assets';
import { TEST_ONLY_docxAssets } from '@/services/docx/__fixtures__/docx-test-assets';
import { TEST_ONLY_parsePdf } from '@/services/pdf/__fixtures__/pdf-inspect';
import { TEST_ONLY_openDocx, TEST_ONLY_part } from '@/services/docx/__fixtures__/docx-inspect';
import { generateQuotationPdf } from '@/services/pdf/pdf-generator';
import { generateQuotationDocx } from '@/services/docx/docx-generator';

/** The date decides the year counter and the Year/Month archive folders. */
const QUOTATION_DATE = '2026-08-11';
const DRAFT_ID = 'TEST_ONLY_draft-propagation';

interface Walked {
  canonical: string;
  fileSafe: string;
  pdfText: string;
  docxXml: string;
  pdfFilename: string;
  docxFilename: string;
  driveFolderPath: string;
  driveFileNames: string[];
  sheetRow: unknown[];
}

/**
 * Reserve → generate → file → track, once.
 *
 * Run in `beforeAll` because the PDF and the DOCX are genuinely produced —
 * fonts embedded, letterhead embedded, package zipped — and doing that per
 * assertion would put this file over the suite's time budget for no gain.
 */
async function walkOneQuotation(): Promise<Walked> {
  const env: GasEnvironment = installGasFakes(vi.stubGlobal);

  try {
    /* 1. The backend issues the number. Nothing else in this test invents one. */
    const issued = reserveQuotationNumber({
      draftId: DRAFT_ID,
      quotationDate: QUOTATION_DATE,
    });

    /* 2. Both documents are generated from a model carrying that number. */
    const model = TEST_ONLY_model({
      quotationNumber: issued.canonical,
      quotationDate: QUOTATION_DATE,
    });

    const pdf = await generateQuotationPdf(model, TEST_ONLY_pdfAssets(), {
      createdAt: new Date('2026-08-11T06:40:06.000Z'),
    });
    const docx = await generateQuotationDocx(model, TEST_ONLY_docxAssets());

    const pages = await TEST_ONLY_parsePdf(pdf.bytes);
    const pkg = await TEST_ONLY_openDocx(docx.bytes);

    /* 3. The documents are filed in Drive under the same number. */
    const stored = storeQuotationDocuments({
      quotationNumber: issued.canonical,
      quotationDate: QUOTATION_DATE,
      codes: DEFAULT_QUOTATION_CODES,
      documents: {
        pdf: validateDocumentUpload('pdf', TEST_ONLY_documentBase64('pdf')),
        docx: validateDocumentUpload('docx', TEST_ONLY_documentBase64('docx')),
      },
    });

    if (stored.outcome !== 'success') {
      throw new Error(`Filing failed: ${stored.outcome}, missing ${stored.missing.join(', ')}`);
    }

    /* 4. The register row is written from the same number. */
    recordQuotationTracking({
      quotationNumber: issued.canonical,
      quotationDate: QUOTATION_DATE,
      clientName: 'TEST_ONLY Contact Person',
      companyName: 'TEST_ONLY Client Company',
      quotationFor: 'TEST_ONLY Manpower Supply',
      authorizedPerson: 'TEST_ONLY_Signatory',
      money: { subtotal: 800, vatAmount: 120, grandTotal: 920 },
      driveFolderUrl: stored.folder.url,
      pdfUrl: stored.files.pdf.url,
      docxUrl: stored.files.docx.url,
      createdBy: 'test-only@example.invalid',
      draftId: DRAFT_ID,
      codes: DEFAULT_QUOTATION_CODES,
    });

    const rows = env.spreadsheet.dataRows(QUOTATIONS_SHEET_NAME);
    const sheetRow = rows[0];
    if (sheetRow === undefined) throw new Error('The register has no row after tracking.');

    const folderPath = stored.path.join('/');

    return {
      canonical: issued.canonical,
      fileSafe: issued.fileSafe,
      pdfText: pages.map((page) => page.text).join('\n'),
      docxXml: TEST_ONLY_part(pkg, 'word/document.xml'),
      pdfFilename: pdf.filename,
      docxFilename: docx.filename,
      driveFolderPath: folderPath,
      driveFileNames: env.drive
        .filesIn(folderPath)
        .map((file) => file.name)
        .sort(),
      sheetRow,
    };
  } finally {
    vi.unstubAllGlobals();
  }
}

let walked: Walked;

beforeAll(async () => {
  walked = await walkOneQuotation();
}, 90_000);

/* -------------------------------------------------------------------------- */
/* The number that was issued                                                  */
/* -------------------------------------------------------------------------- */

describe('the issued number', () => {
  it('is the first of its year, in the canonical format', () => {
    expect(walked.canonical).toBe('SFC/RUH/QTN/2026/001');
  });

  it('has a file-safe form that is the canonical with slashes replaced', () => {
    expect(walked.fileSafe).toBe(toFileSafe(walked.canonical));
    expect(walked.fileSafe).toBe('SFC-RUH-QTN-2026-001');
  });
});

/* -------------------------------------------------------------------------- */
/* Propagation (§7.8, §20.2)                                                   */
/* -------------------------------------------------------------------------- */

describe('the same number propagates into', () => {
  it('the body of the generated PDF', () => {
    // Extracted from the finished file by pdfjs, not read off the model.
    expect(walked.pdfText).toContain(walked.canonical);
  });

  it('the body of the generated DOCX', () => {
    // Read out of word/document.xml after unzipping the package.
    expect(walked.docxXml).toContain(walked.canonical);
  });

  it('the Quotation No. cell of the register', () => {
    const column = QUOTATION_HEADERS.indexOf('Quotation No.');
    expect(column).toBeGreaterThanOrEqual(0);
    expect(walked.sheetRow[column]).toBe(walked.canonical);
  });

  it('the Drive folder name, in its file-safe form', () => {
    expect(walked.driveFolderPath).toBe(`2026/August/${walked.fileSafe}`);
  });

  it('the PDF filename, in its file-safe form', () => {
    expect(walked.pdfFilename).toBe(`${walked.fileSafe}.pdf`);
  });

  it('the DOCX filename, in its file-safe form', () => {
    expect(walked.docxFilename).toBe(`${walked.fileSafe}.docx`);
  });

  it('the names of the files that actually reached Drive', () => {
    expect(walked.driveFileNames).toEqual([`${walked.fileSafe}.docx`, `${walked.fileSafe}.pdf`]);
  });

  it('every one of those six places, with no other number anywhere', () => {
    /*
     * The assertion that would have caught a renderer quietly formatting its
     * own: collect the number from each of the six sinks and require the set to
     * have exactly one member.
     */
    const canonicalSinks = [
      extractCanonical(walked.pdfText),
      extractCanonical(walked.docxXml),
      String(walked.sheetRow[QUOTATION_HEADERS.indexOf('Quotation No.')]),
    ];
    const fileSafeSinks = [
      walked.driveFolderPath.split('/').at(-1) ?? '',
      walked.pdfFilename.replace(/\.pdf$/, ''),
      walked.docxFilename.replace(/\.docx$/, ''),
    ];

    expect(new Set(canonicalSinks)).toEqual(new Set([walked.canonical]));
    expect(new Set(fileSafeSinks)).toEqual(new Set([walked.fileSafe]));
  });
});

/** Every `SFC/…/…/YYYY/NNN` in a blob of text, deduplicated. */
function extractCanonical(text: string): string {
  const matches = text.match(/[A-Z]{2,8}\/[A-Z]{2,8}\/[A-Z]{2,8}\/\d{4}\/\d{3,}/g) ?? [];
  const unique = [...new Set(matches)];

  if (unique.length !== 1) {
    throw new Error(
      `Expected exactly one quotation number in the text, found ${String(unique.length)}: ${unique.join(', ')}`,
    );
  }
  return unique[0] ?? '';
}

/* -------------------------------------------------------------------------- */
/* The archive path is derived, never assembled by hand                       */
/* -------------------------------------------------------------------------- */

describe('the archive path', () => {
  it('is the one the shared path module derives from the same inputs', () => {
    const segments = quotationFolderSegments(
      QUOTATION_DATE,
      walked.canonical,
      DEFAULT_QUOTATION_CODES,
    );
    expect(walked.driveFolderPath).toBe(segments.join('/'));
  });

  it('names both files the way the shared naming module does', () => {
    expect(walked.pdfFilename).toBe(
      documentFileName(walked.canonical, 'pdf', DEFAULT_QUOTATION_CODES),
    );
    expect(walked.docxFilename).toBe(
      documentFileName(walked.canonical, 'docx', DEFAULT_QUOTATION_CODES),
    );
  });

  it('uses the quotation date for the month folder, not the day it was filed', () => {
    // Generated on any day; filed under August because the quotation is dated
    // in August. A clock-derived month would silently misfile every backdated
    // quotation (§16.1).
    expect(walked.driveFolderPath.split('/')[1]).toBe('August');
  });
});
